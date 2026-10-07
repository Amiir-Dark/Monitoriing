package collectors

import (
	"testing"
)

func TestCollectorsExecution(t *testing.T) {
	mgr := NewManager()
	if len(mgr.collectors) == 0 {
		t.Fatalf("expected registered collectors")
	}

	payload := mgr.CollectAll([]string{"nginx", "docker"})

	if payload.CPUCount <= 0 {
		t.Errorf("expected CPU count > 0, got %d", payload.CPUCount)
	}

	if payload.Timestamp <= 0 {
		t.Errorf("expected Timestamp > 0, got %d", payload.Timestamp)
	}

	if len(payload.Collectors) == 0 {
		t.Errorf("expected non-empty collectors reports")
	}

	if len(payload.Services) != 2 {
		t.Errorf("expected 2 services monitored, got %d", len(payload.Services))
	}
}

func TestCPUCollector(t *testing.T) {
	c := NewCPUCollector()
	p := &Payload{}
	report, err := c.Collect(p)
	if err != nil {
		t.Fatalf("cpu collection returned error: %v", err)
	}
	if report.Status == "" {
		t.Errorf("expected collector status to be populated")
	}
	if p.CPU < 0 || p.CPU > 100 {
		t.Errorf("invalid CPU usage percentage: %.2f", p.CPU)
	}
}

func TestMemoryCollector(t *testing.T) {
	m := NewMemoryCollector()
	p := &Payload{}
	report, err := m.Collect(p)
	if err != nil {
		t.Fatalf("memory collection returned error: %v", err)
	}
	if report.Status == "" {
		t.Errorf("expected collector status to be populated")
	}
}

func TestLoadCollector(t *testing.T) {
	l := NewLoadCollector()
	p := &Payload{}
	report, err := l.Collect(p)
	if err != nil {
		t.Fatalf("load collection returned error: %v", err)
	}
	if report.Status == "" {
		t.Errorf("expected collector status to be populated")
	}
}
