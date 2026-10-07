package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
	Path string
}

// Open initializes the SQLite database with WAL mode and runs migrations.
func Open(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	dsn := dbPath
	if !strings.Contains(dsn, "?") {
		dsn = dsn + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// SQLite WAL mode supports multiple readers and serialized writers.
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(1 * time.Hour)

	d := &DB{DB: db, Path: dbPath}
	if err := d.configurePragmas(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to configure pragmas: %w", err)
	}

	if err := d.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	if err := d.seedDefaults(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to seed defaults: %w", err)
	}

	return d, nil
}

func (d *DB) configurePragmas() error {
	pragmas := []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA busy_timeout=5000;",
		"PRAGMA foreign_keys=ON;",
		"PRAGMA synchronous=NORMAL;",
	}
	for _, p := range pragmas {
		if _, err := d.Exec(p); err != nil {
			return fmt.Errorf("exec pragma %q: %w", p, err)
		}
	}
	return nil
}

func (d *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'admin',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		last_login_at INTEGER
	);

	CREATE TABLE IF NOT EXISTS node_groups (
		id TEXT PRIMARY KEY,
		name TEXT UNIQUE NOT NULL,
		description TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS nodes (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		hostname TEXT,
		ip_address TEXT,
		operating_system TEXT,
		architecture TEXT,
		kernel TEXT,
		agent_version TEXT,
		status TEXT NOT NULL DEFAULT 'unknown',
		last_seen INTEGER,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		group_id TEXT REFERENCES node_groups(id) ON DELETE SET NULL,
		disabled INTEGER NOT NULL DEFAULT 0,
		latest_payload TEXT
	);

	CREATE TABLE IF NOT EXISTS node_tokens (
		id TEXT PRIMARY KEY,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		token_hash TEXT UNIQUE NOT NULL,
		created_at INTEGER NOT NULL,
		expires_at INTEGER,
		revoked_at INTEGER,
		last_used_at INTEGER
	);

	CREATE TABLE IF NOT EXISTS node_tags (
		id TEXT PRIMARY KEY,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		tag TEXT NOT NULL,
		UNIQUE(node_id, tag)
	);

	CREATE TABLE IF NOT EXISTS metrics (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		timestamp INTEGER NOT NULL,
		metric_type TEXT NOT NULL,
		value REAL NOT NULL
	);

	CREATE TABLE IF NOT EXISTS metric_hourly (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		timestamp INTEGER NOT NULL,
		metric_type TEXT NOT NULL,
		min_value REAL NOT NULL,
		max_value REAL NOT NULL,
		avg_value REAL NOT NULL,
		sample_count INTEGER NOT NULL,
		UNIQUE(node_id, metric_type, timestamp)
	);

	CREATE TABLE IF NOT EXISTS metric_daily (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		timestamp INTEGER NOT NULL,
		metric_type TEXT NOT NULL,
		min_value REAL NOT NULL,
		max_value REAL NOT NULL,
		avg_value REAL NOT NULL,
		sample_count INTEGER NOT NULL,
		UNIQUE(node_id, metric_type, timestamp)
	);

	CREATE TABLE IF NOT EXISTS services (
		id TEXT PRIMARY KEY,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		status TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		UNIQUE(node_id, name)
	);

	CREATE TABLE IF NOT EXISTS alert_rules (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		metric_type TEXT NOT NULL,
		operator TEXT NOT NULL,
		threshold REAL NOT NULL,
		duration_seconds INTEGER NOT NULL DEFAULT 0,
		severity TEXT NOT NULL DEFAULT 'warning',
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS alerts (
		id TEXT PRIMARY KEY,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
		status TEXT NOT NULL DEFAULT 'triggered',
		severity TEXT NOT NULL DEFAULT 'warning',
		message TEXT NOT NULL,
		value REAL NOT NULL,
		triggered_at INTEGER NOT NULL,
		acknowledged_at INTEGER,
		resolved_at INTEGER
	);

	CREATE TABLE IF NOT EXISTS telegram_integrations (
		id TEXT PRIMARY KEY,
		bot_token TEXT NOT NULL,
		chat_id TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT,
		action TEXT NOT NULL,
		details TEXT,
		ip_address TEXT,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS heartbeats (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		timestamp INTEGER NOT NULL,
		latency_ms REAL NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS node_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		timestamp INTEGER NOT NULL,
		unit TEXT,
		level TEXT,
		message TEXT
	);

	CREATE TABLE IF NOT EXISTS alert_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		alert_id TEXT NOT NULL,
		node_id TEXT NOT NULL,
		event_type TEXT NOT NULL,
		value REAL,
		message TEXT,
		timestamp INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at INTEGER NOT NULL
	);

	-- Indexes for optimal lookup performance
	CREATE INDEX IF NOT EXISTS idx_metrics_node_type_time ON metrics(node_id, metric_type, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(timestamp);
	CREATE INDEX IF NOT EXISTS idx_metric_hourly_lookup ON metric_hourly(node_id, metric_type, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_metric_daily_lookup ON metric_daily(node_id, metric_type, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_alerts_node_status ON alerts(node_id, status);
	CREATE INDEX IF NOT EXISTS idx_alerts_status_time ON alerts(status, triggered_at DESC);
	CREATE INDEX IF NOT EXISTS idx_tokens_hash ON node_tokens(token_hash);
	CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
	CREATE INDEX IF NOT EXISTS idx_heartbeats_node_time ON heartbeats(node_id, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_logs_node_time ON node_logs(node_id, timestamp DESC);
	`

	if _, err := d.Exec(schema); err != nil {
		return err
	}
	_, _ = d.Exec("ALTER TABLE nodes ADD COLUMN latest_payload TEXT;")
	_, _ = d.Exec("ALTER TABLE nodes ADD COLUMN connection_state TEXT DEFAULT 'unknown';")
	_, _ = d.Exec("ALTER TABLE nodes ADD COLUMN heartbeat_interval INTEGER DEFAULT 5;")
	_, _ = d.Exec("ALTER TABLE nodes ADD COLUMN latency_ms REAL DEFAULT 0;")
	_, _ = d.Exec("ALTER TABLE nodes ADD COLUMN last_heartbeat INTEGER;")
	_, _ = d.Exec("ALTER TABLE nodes ADD COLUMN last_telemetry_at INTEGER;")
	_, _ = d.Exec("ALTER TABLE alerts ADD COLUMN rule_name TEXT;")
	_, _ = d.Exec("ALTER TABLE alerts ADD COLUMN metric TEXT;")
	_, _ = d.Exec("ALTER TABLE alerts ADD COLUMN threshold REAL DEFAULT 0;")
	_, _ = d.Exec("ALTER TABLE alerts ADD COLUMN last_update INTEGER;")
	return nil
}

func (d *DB) seedDefaults() error {
	now := time.Now().Unix()

	// 1. Seed admin user if not exists
	var count int
	err := d.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		hash, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		adminID := uuid.New().String()
		_, err = d.Exec(`
			INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
			VALUES (?, ?, ?, 'admin', ?, ?)
		`, adminID, "admin", string(hash), now, now)
		if err != nil {
			return err
		}
	}

	// 2. Seed default alert rules if not exists
	err = d.QueryRow("SELECT COUNT(*) FROM alert_rules").Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		rules := []struct {
			name     string
			mType    string
			op       string
			thresh   float64
			dur      int
			severity string
		}{
			{"CPU High Usage (Warning)", "cpu", ">", 90.0, 60, "warning"},
			{"CPU Critical Usage", "cpu", ">", 95.0, 30, "critical"},
			{"RAM High Usage", "memory", ">", 90.0, 60, "critical"},
			{"Disk High Usage (Warning)", "disk", ">", 85.0, 0, "warning"},
			{"Disk Critical Usage", "disk", ">", 95.0, 0, "critical"},
			{"Swap High Usage", "swap", ">", 80.0, 60, "warning"},
			{"High System Load", "load1", ">", 8.0, 120, "warning"},
			{"Load Exceeds CPU Capacity", "load_core", ">", 1.0, 60, "warning"},
			{"Network Drops Detected", "network_drops", ">", 0.0, 30, "warning"},
			{"Network Errors Detected", "network_errors", ">", 0.0, 30, "warning"},
			{"High TCP Retransmission", "tcp_retrans", ">", 5.0, 60, "warning"},
			{"Node Offline", "offline", "==", 1.0, 30, "critical"},
			{"System Service Failed", "service_failed", "==", 1.0, 0, "critical"},
			{"Docker Container Stopped", "docker_stopped", "==", 1.0, 0, "warning"},
			{"High Temperature", "temperature", ">", 85.0, 60, "warning"},
		}

		for _, r := range rules {
			id := uuid.New().String()
			_, err := d.Exec(`
				INSERT INTO alert_rules (id, name, metric_type, operator, threshold, duration_seconds, severity, enabled, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
			`, id, r.name, r.mType, r.op, r.thresh, r.dur, r.severity, now)
			if err != nil {
				return err
			}
		}
	}

	// 3. Seed default retention settings
	settings := map[string]string{
		"raw_retention_days":      "2",
		"hourly_retention_days":   "90",
		"daily_retention_days":    "365",
		"offline_timeout_seconds": "30",
	}

	for k, v := range settings {
		_, err := d.Exec(`
			INSERT OR IGNORE INTO settings (key, value, updated_at)
			VALUES (?, ?, ?)
		`, k, v, now)
		if err != nil {
			return err
		}
	}

	return nil
}

// Backup creates a clean atomic SQLite backup file.
func (d *DB) Backup(backupPath string) error {
	dir := filepath.Dir(backupPath)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return fmt.Errorf("failed to create backup dir: %w", err)
	}

	// Remove old backup file at target location if it exists
	_ = os.Remove(backupPath)

	// In SQLite 3.27+, VACUUM INTO creates a safe, consistent snapshot while WAL is active.
	query := fmt.Sprintf("VACUUM INTO '%s';", backupPath)
	if _, err := d.Exec(query); err != nil {
		return fmt.Errorf("backup failed via VACUUM INTO: %w", err)
	}
	return nil
}

// LogAudit records an administrative action for security.
func (d *DB) LogAudit(userID, action, details, ip string) error {
	now := time.Now().Unix()
	_, err := d.Exec(`
		INSERT INTO audit_logs (user_id, action, details, ip_address, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, userID, action, details, ip, now)
	return err
}

// GetSetting retrieves a configuration value from settings.
func (d *DB) GetSetting(key, defaultValue string) string {
	var val string
	err := d.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&val)
	if err != nil || val == "" {
		return defaultValue
	}
	return val
}

// SetSetting saves or updates a configuration value.
func (d *DB) SetSetting(key, value string) error {
	now := time.Now().Unix()
	_, err := d.Exec(`
		INSERT INTO settings (key, value, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
	`, key, value, now)
	return err
}
