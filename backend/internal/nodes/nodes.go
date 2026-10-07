package nodes

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"nodewatch/backend/internal/auth"
	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/models"
)

var (
	ErrNodeNotFound     = errors.New("node not found")
	ErrNodeDisabled     = errors.New("node is disabled")
	ErrInvalidNodeToken = errors.New("invalid or revoked node token")
)

type Repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db}
}

// CreateNode creates a new node, generates an agent token, and associates tags.
func (r *Repository) CreateNode(name string, groupID *string, tags []string) (*models.Node, string, error) {
	now := time.Now()
	nodeID := uuid.New().String()

	rawToken, tokenHash, err := auth.GenerateNodeToken()
	if err != nil {
		return nil, "", fmt.Errorf("generate token: %w", err)
	}

	tx, err := r.db.Begin()
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO nodes (id, name, status, created_at, updated_at, group_id, disabled)
		VALUES (?, ?, 'unknown', ?, ?, ?, 0)
	`, nodeID, name, now.Unix(), now.Unix(), groupID)
	if err != nil {
		return nil, "", fmt.Errorf("insert node: %w", err)
	}

	tokenID := uuid.New().String()
	_, err = tx.Exec(`
		INSERT INTO node_tokens (id, node_id, token_hash, created_at)
		VALUES (?, ?, ?, ?)
	`, tokenID, nodeID, tokenHash, now.Unix())
	if err != nil {
		return nil, "", fmt.Errorf("insert token: %w", err)
	}

	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		tagID := uuid.New().String()
		_, err = tx.Exec(`
			INSERT OR IGNORE INTO node_tags (id, node_id, tag)
			VALUES (?, ?, ?)
		`, tagID, nodeID, tag)
		if err != nil {
			return nil, "", fmt.Errorf("insert tag: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, "", err
	}

	node, err := r.GetNode(nodeID)
	if err != nil {
		return nil, "", err
	}

	return node, rawToken, nil
}

// GetNode fetches a single node by ID.
func (r *Repository) GetNode(id string) (*models.Node, error) {
	query := `
		SELECT n.id, n.name, COALESCE(n.hostname, ''), COALESCE(n.ip_address, ''),
		       COALESCE(n.operating_system, ''), COALESCE(n.architecture, ''),
		       COALESCE(n.kernel, ''), COALESCE(n.agent_version, ''),
		       n.status, n.last_seen, n.created_at, n.updated_at,
		       n.group_id, g.name, n.disabled, COALESCE(n.latest_payload, '')
		FROM nodes n
		LEFT JOIN node_groups g ON n.group_id = g.id
		WHERE n.id = ?
	`

	var n models.Node
	var lastSeen sql.NullInt64
	var createdAt, updatedAt int64
	var groupID, groupName sql.NullString
	var disabledInt int
	var latestPayloadStr string

	err := r.db.QueryRow(query, id).Scan(
		&n.ID, &n.Name, &n.Hostname, &n.IPAddress,
		&n.OperatingSystem, &n.Architecture,
		&n.Kernel, &n.AgentVersion,
		&n.Status, &lastSeen, &createdAt, &updatedAt,
		&groupID, &groupName, &disabledInt, &latestPayloadStr,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNodeNotFound
		}
		return nil, err
	}

	n.CreatedAt = time.Unix(createdAt, 0)
	n.UpdatedAt = time.Unix(updatedAt, 0)
	if lastSeen.Valid {
		t := time.Unix(lastSeen.Int64, 0)
		n.LastSeen = &t
	}
	if groupID.Valid {
		n.GroupID = &groupID.String
	}
	if groupName.Valid {
		n.GroupName = &groupName.String
	}
	n.Disabled = disabledInt == 1

	if latestPayloadStr != "" {
		var payload models.AgentPayload
		if err := json.Unmarshal([]byte(latestPayloadStr), &payload); err == nil {
			n.LatestPayload = &payload
		}
	}

	// Fetch tags
	tags, err := r.GetNodeTags(n.ID)
	if err == nil {
		n.Tags = tags
	}

	// Fetch latest metrics snapshot
	stats, err := r.GetLatestNodeStats(n.ID)
	if err == nil {
		n.LatestMetrics = stats
	}

	return &n, nil
}

// ListNodes returns all nodes matching optional query filters.
func (r *Repository) ListNodes(search, status, groupID, tag string) ([]*models.Node, error) {
	query := `
		SELECT DISTINCT n.id, n.name, COALESCE(n.hostname, ''), COALESCE(n.ip_address, ''),
		       COALESCE(n.operating_system, ''), COALESCE(n.architecture, ''),
		       COALESCE(n.kernel, ''), COALESCE(n.agent_version, ''),
		       n.status, n.last_seen, n.created_at, n.updated_at,
		       n.group_id, g.name, n.disabled, COALESCE(n.latest_payload, '')
		FROM nodes n
		LEFT JOIN node_groups g ON n.group_id = g.id
		LEFT JOIN node_tags t ON n.id = t.node_id
		WHERE 1=1
	`
	var args []interface{}

	if search != "" {
		query += " AND (n.name LIKE ? OR n.hostname LIKE ? OR n.ip_address LIKE ?)"
		pattern := "%" + search + "%"
		args = append(args, pattern, pattern, pattern)
	}

	if status != "" {
		query += " AND n.status = ?"
		args = append(args, status)
	}

	if groupID != "" {
		query += " AND n.group_id = ?"
		args = append(args, groupID)
	}

	if tag != "" {
		query += " AND t.tag = ?"
		args = append(args, tag)
	}

	query += " ORDER BY n.created_at DESC"

	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*models.Node{}
	for rows.Next() {
		var n models.Node
		var lastSeen sql.NullInt64
		var createdAt, updatedAt int64
		var gID, gName sql.NullString
		var disabledInt int
		var latestPayloadStr string

		err := rows.Scan(
			&n.ID, &n.Name, &n.Hostname, &n.IPAddress,
			&n.OperatingSystem, &n.Architecture,
			&n.Kernel, &n.AgentVersion,
			&n.Status, &lastSeen, &createdAt, &updatedAt,
			&gID, &gName, &disabledInt, &latestPayloadStr,
		)
		if err != nil {
			return nil, err
		}

		n.CreatedAt = time.Unix(createdAt, 0)
		n.UpdatedAt = time.Unix(updatedAt, 0)
		if lastSeen.Valid {
			t := time.Unix(lastSeen.Int64, 0)
			n.LastSeen = &t
		}
		if gID.Valid {
			n.GroupID = &gID.String
		}
		if gName.Valid {
			n.GroupName = &gName.String
		}
		n.Disabled = disabledInt == 1

		if latestPayloadStr != "" {
			var payload models.AgentPayload
			if err := json.Unmarshal([]byte(latestPayloadStr), &payload); err == nil {
				n.LatestPayload = &payload
			}
		}

		// Fetch tags
		if tags, err := r.GetNodeTags(n.ID); err == nil {
			n.Tags = tags
		}

		// Fetch latest stats
		if stats, err := r.GetLatestNodeStats(n.ID); err == nil {
			n.LatestMetrics = stats
		}

		list = append(list, &n)
	}

	return list, nil
}

// UpdateNode updates node information.
func (r *Repository) UpdateNode(id, name string, groupID *string, tags []string, disabled bool) error {
	now := time.Now().Unix()
	disabledInt := 0
	if disabled {
		disabledInt = 1
	}

	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		UPDATE nodes
		SET name = ?, group_id = ?, disabled = ?, updated_at = ?
		WHERE id = ?
	`, name, groupID, disabledInt, now, id)
	if err != nil {
		return err
	}
	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		return ErrNodeNotFound
	}

	// Update tags
	if tags != nil {
		_, _ = tx.Exec("DELETE FROM node_tags WHERE node_id = ?", id)
		for _, tag := range tags {
			tag = strings.TrimSpace(tag)
			if tag == "" {
				continue
			}
			tagID := uuid.New().String()
			_, err = tx.Exec(`
				INSERT OR IGNORE INTO node_tags (id, node_id, tag)
				VALUES (?, ?, ?)
			`, tagID, id, tag)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

// DeleteNode removes a node and all associated data.
func (r *Repository) DeleteNode(id string) error {
	res, err := r.db.Exec("DELETE FROM nodes WHERE id = ?", id)
	if err != nil {
		return err
	}
	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		return ErrNodeNotFound
	}
	return nil
}

// RotateToken revokes all existing active tokens for this node and generates a fresh one.
func (r *Repository) RotateToken(nodeID string) (string, error) {
	now := time.Now().Unix()
	rawToken, tokenHash, err := auth.GenerateNodeToken()
	if err != nil {
		return "", err
	}

	tx, err := r.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	// Revoke prior tokens
	_, err = tx.Exec(`
		UPDATE node_tokens
		SET revoked_at = ?
		WHERE node_id = ? AND revoked_at IS NULL
	`, now, nodeID)
	if err != nil {
		return "", err
	}

	// Insert new token
	tokenID := uuid.New().String()
	_, err = tx.Exec(`
		INSERT INTO node_tokens (id, node_id, token_hash, created_at)
		VALUES (?, ?, ?, ?)
	`, tokenID, nodeID, tokenHash, now)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(); err != nil {
		return "", err
	}

	return rawToken, nil
}

// ValidateAgentToken verifies an incoming raw token, returning the node ID.
func (r *Repository) ValidateAgentToken(rawToken string) (string, error) {
	if rawToken == "" {
		return "", ErrInvalidNodeToken
	}

	tokenHash := auth.HashToken(rawToken)
	var nodeID string
	var disabledInt int

	err := r.db.QueryRow(`
		SELECT nt.node_id, n.disabled
		FROM node_tokens nt
		JOIN nodes n ON nt.node_id = n.id
		WHERE nt.token_hash = ? AND nt.revoked_at IS NULL
		  AND (nt.expires_at IS NULL OR nt.expires_at > ?)
	`, tokenHash, time.Now().Unix()).Scan(&nodeID, &disabledInt)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrInvalidNodeToken
		}
		return "", err
	}

	if disabledInt == 1 {
		return "", ErrNodeDisabled
	}

	// Update last_used_at in background or non-blocking
	go func() {
		_, _ = r.db.Exec(`
			UPDATE node_tokens SET last_used_at = ? WHERE token_hash = ?
		`, time.Now().Unix(), tokenHash)
	}()

	return nodeID, nil
}

// UpdateNodeSystemInfo updates registration or heartbeat hardware & OS metadata.
func (r *Repository) UpdateNodeSystemInfo(nodeID string, info *models.SystemInfo) error {
	now := time.Now().Unix()
	ipStr := ""
	if len(info.IPAddresses) > 0 {
		ipStr = strings.Join(info.IPAddresses, ", ")
	}

	_, err := r.db.Exec(`
		UPDATE nodes
		SET hostname = ?, ip_address = ?, operating_system = ?,
		    architecture = ?, kernel = ?, agent_version = ?,
		    status = 'online', last_seen = ?, updated_at = ?
		WHERE id = ?
	`, info.Hostname, ipStr, info.OperatingSystem, info.Architecture,
		info.Kernel, info.AgentVersion, now, now, nodeID)
	return err
}

// UpdateNodeSeen updates the last_seen timestamp and sets status to online.
func (r *Repository) UpdateNodeSeen(nodeID string) error {
	now := time.Now().Unix()
	_, err := r.db.Exec(`
		UPDATE nodes
		SET status = 'online', last_seen = ?, updated_at = ?
		WHERE id = ? AND disabled = 0
	`, now, now, nodeID)
	return err
}

// GetNodeTags returns all tags attached to a node.
func (r *Repository) GetNodeTags(nodeID string) ([]string, error) {
	rows, err := r.db.Query("SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag ASC", nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err == nil {
			tags = append(tags, tag)
		}
	}
	return tags, nil
}

// GetLatestNodeStats fetches the most recent metric values for a node.
func (r *Repository) GetLatestNodeStats(nodeID string) (*models.NodeStats, error) {
	query := `
		SELECT metric_type, value, timestamp
		FROM metrics
		WHERE node_id = ? AND id IN (
			SELECT MAX(id) FROM metrics WHERE node_id = ? GROUP BY metric_type
		)
	`
	rows, err := r.db.Query(query, nodeID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := &models.NodeStats{}
	for rows.Next() {
		var mType string
		var val float64
		var ts int64
		if err := rows.Scan(&mType, &val, &ts); err != nil {
			continue
		}
		if ts > stats.Timestamp {
			stats.Timestamp = ts
		}
		switch mType {
		case "cpu":
			stats.CPU = val
		case "memory":
			stats.Memory = val
		case "disk":
			stats.Disk = val
		case "load1":
			stats.Load1 = val
			stats.IsLoadAvailable = true
		case "network_rx":
			stats.NetworkRXBytesSec = val
		case "network_tx":
			stats.NetworkTXBytesSec = val
		case "temperature":
			tVal := val
			stats.Temperature = &tVal
			stats.IsThermalAvailable = true
		}
	}

	return stats, nil
}

// SaveNodePayload serializes and updates the full latest agent payload and last_seen.
func (r *Repository) SaveNodePayload(nodeID string, p *models.AgentPayload) error {
	now := time.Now().Unix()
	payloadJSON, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`
		UPDATE nodes
		SET latest_payload = ?, status = 'online', last_seen = ?, updated_at = ?
		WHERE id = ? AND disabled = 0
	`, string(payloadJSON), now, now, nodeID)
	return err
}

// CheckOfflineNodes marks nodes as offline if they have exceeded the heartbeat timeout.
func (r *Repository) CheckOfflineNodes(timeoutSeconds int) ([]models.Node, error) {
	now := time.Now().Unix()
	cutoff := now - int64(timeoutSeconds)

	// Find nodes transitioning to offline
	rows, err := r.db.Query(`
		SELECT id, name, COALESCE(hostname, ''), COALESCE(ip_address, ''), last_seen
		FROM nodes
		WHERE status != 'offline' AND disabled = 0 AND (last_seen IS NULL OR last_seen < ?)
	`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var offlineNodes []models.Node
	for rows.Next() {
		var n models.Node
		var lastSeen sql.NullInt64
		if err := rows.Scan(&n.ID, &n.Name, &n.Hostname, &n.IPAddress, &lastSeen); err == nil {
			if lastSeen.Valid {
				t := time.Unix(lastSeen.Int64, 0)
				n.LastSeen = &t
			}
			offlineNodes = append(offlineNodes, n)
		}
	}

	if len(offlineNodes) > 0 {
		_, err = r.db.Exec(`
			UPDATE nodes
			SET status = 'offline', updated_at = ?
			WHERE status != 'offline' AND disabled = 0 AND (last_seen IS NULL OR last_seen < ?)
		`, now, cutoff)
	}

	return offlineNodes, err
}
