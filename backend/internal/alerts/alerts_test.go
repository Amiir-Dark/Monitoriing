package alerts

import (
	"os"
	"path/filepath"
	"testing"

	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/models"
	"nodewatch/backend/internal/telegram"
	"nodewatch/backend/internal/websocket"
)

func TestAlertEvaluationAndLifecycle(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "nodewatch_alert_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	db, err := database.Open(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	hub := websocket.NewHub()
	tg := telegram.NewClient(db)
	engine := NewEngine(db, hub, tg)

	// Create test node first to satisfy foreign key
	_, err = db.Exec("INSERT INTO nodes (id, name, created_at, updated_at) VALUES ('node-1', 'Server-Alpha', 100, 100)")
	if err != nil {
		t.Fatalf("failed to insert test node: %v", err)
	}

	// Create test rule with 0 duration so it fires immediately
	rule := models.AlertRule{
		Name:            "High CPU Test",
		MetricType:      "cpu",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 0,
		Severity:        "critical",
		Enabled:         true,
	}
	err = engine.SaveRule(&rule)
	if err != nil {
		t.Fatalf("failed to save rule: %v", err)
	}

	// Payload with CPU 95.0%
	p := &models.AgentPayload{
		CPU: 95.0,
	}

	engine.EvaluateMetrics("node-1", "Server-Alpha", p)

	// Check that alert was triggered
	activeAlerts, err := engine.ListAlerts("triggered", "node-1", 10)
	if err != nil {
		t.Fatalf("failed to list alerts: %v", err)
	}
	if len(activeAlerts) != 1 {
		t.Fatalf("expected 1 active alert, got %d", len(activeAlerts))
	}
	alertID := activeAlerts[0].ID

	// Acknowledge alert
	err = engine.AcknowledgeAlert(alertID)
	if err != nil {
		t.Fatalf("failed to acknowledge: %v", err)
	}

	// Resolve alert
	err = engine.ResolveAlert(alertID)
	if err != nil {
		t.Fatalf("failed to resolve: %v", err)
	}

	remaining, _ := engine.ListAlerts("triggered", "node-1", 10)
	if len(remaining) != 0 {
		t.Errorf("expected 0 active alerts after resolution")
	}
}
