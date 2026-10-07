package metrics

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/models"
)

func TestMetricsIngestionAndQuery(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "nodewatch_metric_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	db, err := database.Open(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	repo := NewRepository(db)

	// Create node first to satisfy foreign key
	_, err = db.Exec("INSERT INTO nodes (id, name, created_at, updated_at) VALUES ('node-test-1', 'Test Node', 100, 100)")
	if err != nil {
		t.Fatalf("failed to insert test node: %v", err)
	}

	// Ingest metrics
	tempVal := 51.5
	payload := &models.AgentPayload{
		Timestamp:         time.Now().Unix(),
		CPU:               45.2,
		Memory:            62.1,
		Disk:              55.0,
		Load1:             1.25,
		NetworkRXBytesSec: 10240,
		NetworkTXBytesSec: 20480,
		Temperature:       &tempVal,
		Processes:         models.ProcessStateBreakdown{Total: 120, Running: 2},
		TCP:               models.TCPStateBreakdown{Total: 15, Established: 5},
		Services: []models.ServiceStatus{
			{Name: "nginx", Status: "running"},
			{Name: "docker", Status: "running"},
		},
	}

	err = repo.Ingest("node-test-1", payload)
	if err != nil {
		t.Fatalf("failed to ingest: %v", err)
	}

	// Query series
	points, err := repo.GetMetricsSeries("node-test-1", "cpu", "1h")
	if err != nil {
		t.Fatalf("failed to query series: %v", err)
	}
	if len(points) != 1 {
		t.Fatalf("expected 1 point, got %d", len(points))
	}
	if points[0].Value != 45.2 {
		t.Errorf("expected CPU 45.2, got %.2f", points[0].Value)
	}

	// Query services
	svcs, err := repo.GetServices("node-test-1")
	if err != nil {
		t.Fatalf("failed to query services: %v", err)
	}
	if len(svcs) != 2 {
		t.Fatalf("expected 2 services, got %d", len(svcs))
	}
}
