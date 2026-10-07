package alerts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/models"
	"nodewatch/backend/internal/telegram"
	"nodewatch/backend/internal/websocket"
)

var (
	ErrAlertNotFound = errors.New("alert not found")
	ErrRuleNotFound  = errors.New("alert rule not found")
)

type Engine struct {
	db       *database.DB
	hub      *websocket.Hub
	telegram *telegram.Client

	mu               sync.Mutex
	breachStartTimes map[string]time.Time // key: nodeID + ":" + ruleID -> first breach time
}

func NewEngine(db *database.DB, hub *websocket.Hub, tg *telegram.Client) *Engine {
	return &Engine{
		db:               db,
		hub:              hub,
		telegram:         tg,
		breachStartTimes: make(map[string]time.Time),
	}
}

// EvaluateMetrics evaluates a node's incoming metrics against active alert rules.
func (e *Engine) EvaluateMetrics(nodeID, nodeName string, p *models.AgentPayload) {
	rules, err := e.ListRules()
	if err != nil {
		return
	}

	cpuCount := p.CPUCount
	if cpuCount <= 0 {
		cpuCount = 1
	}

	for _, rule := range rules {
		if !rule.Enabled || rule.MetricType == "offline" {
			continue
		}

		var currentVal float64
		var hasVal = true

		switch rule.MetricType {
		case "cpu":
			currentVal = p.CPU
		case "memory":
			currentVal = p.Memory
		case "disk":
			currentVal = p.Disk
		case "swap":
			currentVal = p.Swap
		case "load1":
			if !p.Load.Available {
				hasVal = false
			} else {
				currentVal = p.Load1
			}
		case "load_core":
			if !p.Load.Available {
				hasVal = false
			} else {
				currentVal = p.Load1 / float64(cpuCount)
			}
		case "network_drops":
			currentVal = p.NetworkRXDropsSec + p.NetworkTXDropsSec
		case "network_errors":
			currentVal = p.NetworkRXErrorsSec + p.NetworkTXErrorsSec
		case "tcp_retrans":
			currentVal = p.TCP.RetransRate
		case "temperature":
			if p.Temperature == nil {
				hasVal = false
			} else {
				currentVal = *p.Temperature
			}
		case "service_failed":
			var failedCount float64
			for _, s := range p.Services {
				if s.Status == "FAILED" {
					failedCount++
				}
			}
			currentVal = failedCount
		case "docker_stopped":
			var stoppedCount float64
			for _, c := range p.Docker.Containers {
				if c.State == "exited" {
					stoppedCount++
				}
			}
			currentVal = stoppedCount
		default:
			hasVal = false
		}

		if !hasVal {
			continue
		}

		breached := e.checkCondition(currentVal, rule.Operator, rule.Threshold)
		key := fmt.Sprintf("%s:%s", nodeID, rule.ID)

		e.mu.Lock()
		if breached {
			firstBreach, exists := e.breachStartTimes[key]
			if !exists {
				e.breachStartTimes[key] = time.Now()
				firstBreach = time.Now()
			}
			e.mu.Unlock()

			// Check duration requirement
			if time.Since(firstBreach).Seconds() >= float64(rule.DurationSeconds) {
				msg := fmt.Sprintf("%s on %s: value is %.1f (threshold %.1f)", rule.Name, nodeName, currentVal, rule.Threshold)
				e.triggerAlertWithDetails(nodeID, nodeName, rule.ID, rule.Name, rule.MetricType, rule.Severity, msg, currentVal, rule.Threshold, firstBreach)
			}
		} else {
			delete(e.breachStartTimes, key)
			e.mu.Unlock()

			// Auto-resolve any active alerts for this rule on this node
			e.autoResolve(nodeID, rule.ID)
		}
	}
}

// EvaluateOffline is called when a node fails heartbeats.
func (e *Engine) EvaluateOffline(n models.Node) {
	lastSeenStr := "Never"
	if n.LastSeen != nil {
		lastSeenStr = n.LastSeen.Format("2006-01-02 15:04:05")
	}

	msg := fmt.Sprintf("🔴 Node Offline\n\nNode: %s\nHostname: %s\nIP: %s\nLast Seen: %s",
		n.Name, n.Hostname, n.IPAddress, lastSeenStr)

	e.triggerAlertWithDetails(n.ID, n.Name, "", "Node Offline", "offline", "critical", fmt.Sprintf("Node %s has stopped sending heartbeats", n.Name), 1.0, 1.0, time.Now())
	e.telegram.SendAlertNotification("offline:"+n.ID, msg, 5*time.Minute)
}

// EvaluateOnline is called when a previously offline node comes back online.
func (e *Engine) EvaluateOnline(n models.Node) {
	msg := fmt.Sprintf("🟢 Node Online\n\nNode: %s\nHostname: %s\nIP: %s\nStatus: Reconnected",
		n.Name, n.Hostname, n.IPAddress)

	// Resolve offline alerts
	now := time.Now().Unix()
	_, _ = e.db.Exec(`
		UPDATE alerts
		SET status = 'resolved', resolved_at = ?
		WHERE node_id = ? AND rule_id IS NULL AND status != 'resolved'
	`, now, n.ID)

	e.telegram.SendAlertNotification("online:"+n.ID, msg, 2*time.Minute)
	e.hub.BroadcastJSON("alert_resolved", map[string]interface{}{
		"node_id":   n.ID,
		"node_name": n.Name,
		"rule_name": "Node Offline",
	})
}

func (e *Engine) checkCondition(val float64, op string, threshold float64) bool {
	switch op {
	case ">":
		return val > threshold
	case ">=":
		return val >= threshold
	case "<":
		return val < threshold
	case "<=":
		return val <= threshold
	case "==":
		return val == threshold
	default:
		return false
	}
}

func (e *Engine) triggerAlertWithDetails(nodeID, nodeName, ruleID, ruleName, metric, severity, message string, val, threshold float64, startedAt time.Time) {
	now := time.Now()
	nowUnix := now.Unix()

	// Check if already active
	var existingID string
	var err error
	if ruleID != "" {
		err = e.db.QueryRow(`
			SELECT id FROM alerts
			WHERE node_id = ? AND rule_id = ? AND status != 'resolved'
			LIMIT 1
		`, nodeID, ruleID).Scan(&existingID)
	} else {
		err = e.db.QueryRow(`
			SELECT id FROM alerts
			WHERE node_id = ? AND rule_id IS NULL AND status != 'resolved'
			LIMIT 1
		`, nodeID).Scan(&existingID)
	}

	if err == nil && existingID != "" {
		// Update current value and last_update timestamp on existing active alert
		_, _ = e.db.Exec(`
			UPDATE alerts
			SET value = ?, last_update = ?, message = ?
			WHERE id = ?
		`, val, nowUnix, message, existingID)
		return
	}

	alertID := uuid.New().String()
	var ruleIDArg *string
	if ruleID != "" {
		ruleIDArg = &ruleID
	}

	_, err = e.db.Exec(`
		INSERT INTO alerts (id, node_id, rule_id, rule_name, metric, status, severity, message, value, threshold, triggered_at, last_update)
		VALUES (?, ?, ?, ?, ?, 'triggered', ?, ?, ?, ?, ?, ?)
	`, alertID, nodeID, ruleIDArg, ruleName, metric, severity, message, val, threshold, startedAt.Unix(), nowUnix)
	if err != nil {
		return
	}

	durSec := int64(now.Sub(startedAt).Seconds())
	durStr := formatAlertDuration(durSec)

	alert := models.Alert{
		ID:          alertID,
		NodeID:      nodeID,
		NodeName:    nodeName,
		RuleID:      ruleIDArg,
		RuleName:    ruleName,
		Metric:      metric,
		Status:      "triggered",
		Severity:    severity,
		Message:     message,
		Value:       val,
		Threshold:   threshold,
		Duration:    durStr,
		TriggeredAt: startedAt,
		LastUpdate:  now,
	}

	// Real-time broadcast
	e.hub.BroadcastJSON("alert_triggered", alert)

	// Send telegram alert notification
	tgMsg := fmt.Sprintf("⚠️ *Alert Triggered: %s*\n\nNode: %s\nSeverity: %s\nValue: %.1f\nThreshold: %.1f\nMessage: %s",
		ruleName, nodeName, severity, val, threshold, message)
	e.telegram.SendAlertNotification("alert:"+alertID, tgMsg, 15*time.Minute)
}

func formatAlertDuration(sec int64) string {
	if sec < 60 {
		return fmt.Sprintf("%ds", sec)
	}
	m := sec / 60
	s := sec % 60
	if m < 60 {
		return fmt.Sprintf("%dm %ds", m, s)
	}
	h := m / 60
	m = m % 60
	return fmt.Sprintf("%dh %dm", h, m)
}

func (e *Engine) autoResolve(nodeID, ruleID string) {
	now := time.Now().Unix()
	res, err := e.db.Exec(`
		UPDATE alerts
		SET status = 'resolved', resolved_at = ?
		WHERE node_id = ? AND rule_id = ? AND status != 'resolved'
	`, now, nodeID, ruleID)
	if err == nil {
		if rows, _ := res.RowsAffected(); rows > 0 {
			e.hub.BroadcastJSON("alert_resolved", map[string]interface{}{
				"node_id": nodeID,
				"rule_id": ruleID,
			})
		}
	}
}

// ListAlerts fetches alerts filtered by status and nodeID.
func (e *Engine) ListAlerts(status, nodeID string, limit int) ([]models.Alert, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT a.id, a.node_id, COALESCE(n.name, 'Unknown'), a.rule_id,
		       COALESCE(a.rule_name, COALESCE(r.name, 'System Alert')),
		       COALESCE(a.metric, ''), a.status, a.severity,
		       a.message, a.value, COALESCE(a.threshold, 0),
		       a.triggered_at, COALESCE(a.last_update, a.triggered_at),
		       a.acknowledged_at, a.resolved_at
		FROM alerts a
		LEFT JOIN nodes n ON a.node_id = n.id
		LEFT JOIN alert_rules r ON a.rule_id = r.id
		WHERE 1=1
	`
	var args []interface{}

	if status != "" {
		query += " AND a.status = ?"
		args = append(args, status)
	}
	if nodeID != "" {
		query += " AND a.node_id = ?"
		args = append(args, nodeID)
	}

	query += " ORDER BY a.triggered_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := e.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	now := time.Now()
	alerts := []models.Alert{}
	for rows.Next() {
		var a models.Alert
		var ruleID sql.NullString
		var triggeredAt, lastUpdate int64
		var ackAt, resAt sql.NullInt64

		err := rows.Scan(
			&a.ID, &a.NodeID, &a.NodeName, &ruleID,
			&a.RuleName, &a.Metric, &a.Status, &a.Severity,
			&a.Message, &a.Value, &a.Threshold,
			&triggeredAt, &lastUpdate, &ackAt, &resAt,
		)
		if err != nil {
			return nil, err
		}

		if ruleID.Valid {
			a.RuleID = &ruleID.String
		}
		a.TriggeredAt = time.Unix(triggeredAt, 0)
		a.LastUpdate = time.Unix(lastUpdate, 0)

		durSec := int64(now.Sub(a.TriggeredAt).Seconds())
		a.Duration = formatAlertDuration(durSec)

		if ackAt.Valid {
			t := time.Unix(ackAt.Int64, 0)
			a.AcknowledgedAt = &t
		}
		if resAt.Valid {
			t := time.Unix(resAt.Int64, 0)
			a.ResolvedAt = &t
		}

		alerts = append(alerts, a)
	}

	return alerts, nil
}

// AcknowledgeAlert updates an alert's status to acknowledged.
func (e *Engine) AcknowledgeAlert(alertID string) error {
	now := time.Now().Unix()
	res, err := e.db.Exec(`
		UPDATE alerts
		SET status = 'acknowledged', acknowledged_at = ?
		WHERE id = ? AND status = 'triggered'
	`, now, alertID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrAlertNotFound
	}

	e.hub.BroadcastJSON("alert_acknowledged", map[string]interface{}{"id": alertID})
	return nil
}

// ResolveAlert marks an alert as resolved.
func (e *Engine) ResolveAlert(alertID string) error {
	now := time.Now().Unix()
	res, err := e.db.Exec(`
		UPDATE alerts
		SET status = 'resolved', resolved_at = ?
		WHERE id = ? AND status != 'resolved'
	`, now, alertID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrAlertNotFound
	}

	e.hub.BroadcastJSON("alert_resolved", map[string]interface{}{"id": alertID})
	return nil
}

// ListRules returns all configured alert rules.
func (e *Engine) ListRules() ([]models.AlertRule, error) {
	rows, err := e.db.Query(`
		SELECT id, name, metric_type, operator, threshold, duration_seconds, severity, enabled, created_at
		FROM alert_rules
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rules := []models.AlertRule{}
	for rows.Next() {
		var r models.AlertRule
		var enabledInt int
		var createdAt int64

		err := rows.Scan(
			&r.ID, &r.Name, &r.MetricType, &r.Operator, &r.Threshold,
			&r.DurationSeconds, &r.Severity, &enabledInt, &createdAt,
		)
		if err != nil {
			return nil, err
		}

		r.Enabled = enabledInt == 1
		r.CreatedAt = time.Unix(createdAt, 0)
		rules = append(rules, r)
	}

	return rules, nil
}

// SaveRule inserts or updates an alert rule.
func (e *Engine) SaveRule(r *models.AlertRule) error {
	now := time.Now().Unix()
	enabledInt := 0
	if r.Enabled {
		enabledInt = 1
	}

	if r.ID == "" {
		r.ID = uuid.New().String()
		_, err := e.db.Exec(`
			INSERT INTO alert_rules (id, name, metric_type, operator, threshold, duration_seconds, severity, enabled, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, r.ID, r.Name, r.MetricType, r.Operator, r.Threshold, r.DurationSeconds, r.Severity, enabledInt, now)
		return err
	}

	_, err := e.db.Exec(`
		UPDATE alert_rules
		SET name = ?, metric_type = ?, operator = ?, threshold = ?, duration_seconds = ?, severity = ?, enabled = ?
		WHERE id = ?
	`, r.Name, r.MetricType, r.Operator, r.Threshold, r.DurationSeconds, r.Severity, enabledInt, r.ID)
	return err
}

// DeleteRule removes an alert rule.
func (e *Engine) DeleteRule(id string) error {
	_, err := e.db.Exec("DELETE FROM alert_rules WHERE id = ?", id)
	return err
}

// StartOfflineChecker periodically inspects nodes for missed heartbeats.
func (e *Engine) StartOfflineChecker(ctx context.Context, repoRepo interface {
	CheckOfflineNodes(timeoutSeconds int) ([]models.Node, error)
}) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Check offline threshold (default 30s)
			offlineNodes, err := repoRepo.CheckOfflineNodes(30)
			if err == nil {
				for _, n := range offlineNodes {
					e.EvaluateOffline(n)
					e.hub.BroadcastJSON("node_status", map[string]interface{}{
						"id":     n.ID,
						"name":   n.Name,
						"status": "offline",
					})
				}
			}
		}
	}
}
