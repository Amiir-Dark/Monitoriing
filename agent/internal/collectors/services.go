package collectors

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type ServicesCollector struct {
	servicesToMonitor []string
}

func NewServicesCollector(services []string) *ServicesCollector {
	if len(services) == 0 {
		services = []string{"nginx", "docker", "xray", "marzban", "mysql", "postgresql", "redis", "sshd"}
	}
	return &ServicesCollector{
		servicesToMonitor: services,
	}
}

func (s *ServicesCollector) Name() string {
	return "services"
}

func (s *ServicesCollector) Collect(p *Payload) (CollectorReport, error) {
	// Gather running process names and PIDs from /proc/[pid]/comm
	runningNames := make(map[string]int)

	entries, err := os.ReadDir("/proc")
	if err != nil {
		results := make([]ServiceStatus, 0, len(s.servicesToMonitor))
		for _, svc := range s.servicesToMonitor {
			results = append(results, ServiceStatus{
				Name:   svc,
				Status: "unknown",
			})
		}
		p.Services = results
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc to inspect services: " + err.Error(),
		}, nil
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		commPath := filepath.Join("/proc", entry.Name(), "comm")
		if data, err := os.ReadFile(commPath); err == nil {
			name := strings.TrimSpace(string(data))
			runningNames[strings.ToLower(name)] = pid
		}
	}

	results := make([]ServiceStatus, 0, len(s.servicesToMonitor))
	for _, svc := range s.servicesToMonitor {
		svcLower := strings.ToLower(svc)
		status := "stopped"
		var foundPID int

		if pid, ok := runningNames[svcLower]; ok {
			status = "running"
			foundPID = pid
		} else {
			// Check exact or daemon variations (e.g. dockerd -> docker, redis-server -> redis)
			for proc, pid := range runningNames {
				if strings.Contains(proc, svcLower) || strings.Contains(svcLower, proc) {
					status = "running"
					foundPID = pid
					break
				}
			}
		}

		results = append(results, ServiceStatus{
			Name:   svc,
			Status: status,
			PID:    foundPID,
		})
	}

	p.Services = results
	return CollectorReport{Status: "ok"}, nil
}
