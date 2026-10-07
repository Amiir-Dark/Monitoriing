package metrics

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/google/uuid"

	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/models"
)

type Repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) *Repository {
	return &Repository{db: db}
}

// Ingest stores a compact batch metrics payload into SQLite.
func (r *Repository) Ingest(nodeID string, p *models.AgentPayload) error {
	ts := p.Timestamp
	if ts <= 0 {
		ts = time.Now().Unix()
	}

	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO metrics (node_id, timestamp, metric_type, value)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	items := []struct {
		mType string
		val   float64
	}{
		{"cpu", p.CPU},
		{"memory", p.Memory},
		{"swap", p.Swap},
		{"disk", p.Disk},
		{"disk_read", p.DiskReadBytesSec},
		{"disk_write", p.DiskWriteBytesSec},
		{"network_rx", p.NetworkRXBytesSec},
		{"network_tx", p.NetworkTXBytesSec},
		{"processes", float64(p.Processes.Total)},
		{"tcp_connections", float64(p.TCP.Total)},
	}

	if p.Load.Available {
		items = append(items,
			struct {
				mType string
				val   float64
			}{"load_1", p.Load1},
			struct {
				mType string
				val   float64
			}{"load_5", p.Load5},
			struct {
				mType string
				val   float64
			}{"load_15", p.Load15},
		)
	}

	if p.Temperature != nil {
		items = append(items, struct {
			mType string
			val   float64
		}{"temperature", *p.Temperature})
	}

	for _, item := range items {
		if _, err := stmt.Exec(nodeID, ts, item.mType, item.val); err != nil {
			return err
		}
	}

	// Update services state
	if len(p.Services) > 0 {
		svcStmt, err := tx.Prepare(`
			INSERT INTO services (id, node_id, name, status, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(node_id, name) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
		`)
		if err != nil {
			return err
		}
		defer svcStmt.Close()

		for _, svc := range p.Services {
			svcID := uuid.New().String()
			if _, err := svcStmt.Exec(svcID, nodeID, svc.Name, svc.Status, ts); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

type MetricPoint struct {
	Timestamp int64   `json:"timestamp"`
	Value     float64 `json:"value"`
	Min       float64 `json:"min,omitempty"`
	Max       float64 `json:"max,omitempty"`
}

// GetMetricsSeries queries metric series for a node and time window.
// Time windows: "1h", "6h", "24h", "7d", "30d"
func (r *Repository) GetMetricsSeries(nodeID, metricType, window string) ([]MetricPoint, error) {
	now := time.Now().Unix()
	var startTime int64
	useHourly := false
	useDaily := false

	switch window {
	case "1h":
		startTime = now - 3600
	case "6h":
		startTime = now - (6 * 3600)
	case "24h":
		startTime = now - (24 * 3600)
	case "7d":
		startTime = now - (7 * 86400)
		useHourly = true
	case "30d":
		startTime = now - (30 * 86400)
		useDaily = true
	default:
		startTime = now - 3600
	}

	points := []MetricPoint{}

	if useDaily {
		// Read from metric_daily
		query := `
			SELECT timestamp, avg_value, min_value, max_value
			FROM metric_daily
			WHERE node_id = ? AND metric_type = ? AND timestamp >= ?
			ORDER BY timestamp ASC
		`
		rows, err := r.db.Query(query, nodeID, metricType, startTime)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		for rows.Next() {
			var p MetricPoint
			if err := rows.Scan(&p.Timestamp, &p.Value, &p.Min, &p.Max); err == nil {
				points = append(points, p)
			}
		}
		return points, nil
	}

	if useHourly {
		// Read from metric_hourly
		query := `
			SELECT timestamp, avg_value, min_value, max_value
			FROM metric_hourly
			WHERE node_id = ? AND metric_type = ? AND timestamp >= ?
			ORDER BY timestamp ASC
		`
		rows, err := r.db.Query(query, nodeID, metricType, startTime)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		for rows.Next() {
			var p MetricPoint
			if err := rows.Scan(&p.Timestamp, &p.Value, &p.Min, &p.Max); err == nil {
				points = append(points, p)
			}
		}
		return points, nil
	}

	// For 1h, 6h, 24h: Read raw metrics, bucket downsample if points > 150
	query := `
		SELECT timestamp, value
		FROM metrics
		WHERE node_id = ? AND metric_type = ? AND timestamp >= ?
		ORDER BY timestamp ASC
	`
	rows, err := r.db.Query(query, nodeID, metricType, startTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rawPoints := []MetricPoint{}
	for rows.Next() {
		var p MetricPoint
		if err := rows.Scan(&p.Timestamp, &p.Value); err == nil {
			rawPoints = append(rawPoints, p)
		}
	}

	// Downsample to max 120 points for smooth charts
	if len(rawPoints) <= 120 {
		return rawPoints, nil
	}

	step := len(rawPoints) / 120
	for i := 0; i < len(rawPoints); i += step {
		points = append(points, rawPoints[i])
	}

	return points, nil
}

// GetServices returns the list of monitored services for a node.
func (r *Repository) GetServices(nodeID string) ([]models.Service, error) {
	rows, err := r.db.Query(`
		SELECT id, node_id, name, status, updated_at
		FROM services
		WHERE node_id = ?
		ORDER BY name ASC
	`, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	svcs := []models.Service{}
	for rows.Next() {
		var s models.Service
		var updatedAt int64
		if err := rows.Scan(&s.ID, &s.NodeID, &s.Name, &s.Status, &updatedAt); err == nil {
			s.UpdatedAt = time.Unix(updatedAt, 0)
			svcs = append(svcs, s)
		}
	}
	return svcs, nil
}

// StartRetentionWorker begins background hourly aggregation and cleanup routines.
func (r *Repository) StartRetentionWorker(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	// Run initial aggregation
	r.aggregateHourly()
	r.aggregateDaily()
	r.cleanupRetention()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.aggregateHourly()
			r.aggregateDaily()
			r.cleanupRetention()
		}
	}
}

func (r *Repository) aggregateHourly() {
	now := time.Now().Unix()
	// Hourly bucket: metrics older than 1 hour, grouped by (node_id, metric_type, hour_start)
	cutoff := now - 3600

	query := `
		INSERT INTO metric_hourly (node_id, metric_type, timestamp, min_value, max_value, avg_value, sample_count)
		SELECT node_id, metric_type, (timestamp / 3600) * 3600 AS hour_start,
		       MIN(value), MAX(value), AVG(value), COUNT(*)
		FROM metrics
		WHERE timestamp < ?
		GROUP BY node_id, metric_type, hour_start
		ON CONFLICT(node_id, metric_type, timestamp) DO UPDATE SET
		  min_value = excluded.min_value,
		  max_value = excluded.max_value,
		  avg_value = excluded.avg_value,
		  sample_count = excluded.sample_count;
	`
	if _, err := r.db.Exec(query, cutoff); err != nil {
		log.Printf("[METRICS] Error aggregating hourly: %v", err)
	}
}

func (r *Repository) aggregateDaily() {
	now := time.Now().Unix()
	cutoff := now - 86400

	query := `
		INSERT INTO metric_daily (node_id, metric_type, timestamp, min_value, max_value, avg_value, sample_count)
		SELECT node_id, metric_type, (timestamp / 86400) * 86400 AS day_start,
		       MIN(min_value), MAX(max_value), AVG(avg_value), SUM(sample_count)
		FROM metric_hourly
		WHERE timestamp < ?
		GROUP BY node_id, metric_type, day_start
		ON CONFLICT(node_id, metric_type, timestamp) DO UPDATE SET
		  min_value = excluded.min_value,
		  max_value = excluded.max_value,
		  avg_value = excluded.avg_value,
		  sample_count = excluded.sample_count;
	`
	if _, err := r.db.Exec(query, cutoff); err != nil {
		log.Printf("[METRICS] Error aggregating daily: %v", err)
	}
}

func (r *Repository) cleanupRetention() {
	now := time.Now().Unix()

	rawDays, _ := strconv.Atoi(r.db.GetSetting("raw_retention_days", "7"))
	hourlyDays, _ := strconv.Atoi(r.db.GetSetting("hourly_retention_days", "90"))
	dailyDays, _ := strconv.Atoi(r.db.GetSetting("daily_retention_days", "365"))

	rawCutoff := now - int64(rawDays*86400)
	hourlyCutoff := now - int64(hourlyDays*86400)
	dailyCutoff := now - int64(dailyDays*86400)

	// Clean raw metrics in batches to avoid locking database
	_, err := r.db.Exec("DELETE FROM metrics WHERE timestamp < ?", rawCutoff)
	if err != nil {
		log.Printf("[RETENTION] Error cleaning raw metrics: %v", err)
	}

	_, err = r.db.Exec("DELETE FROM metric_hourly WHERE timestamp < ?", hourlyCutoff)
	if err != nil {
		log.Printf("[RETENTION] Error cleaning hourly metrics: %v", err)
	}

	_, err = r.db.Exec("DELETE FROM metric_daily WHERE timestamp < ?", dailyCutoff)
	if err != nil {
		log.Printf("[RETENTION] Error cleaning daily metrics: %v", err)
	}
}
