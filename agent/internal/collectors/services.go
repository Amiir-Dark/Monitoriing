package collectors

import (
	"bufio"
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ServiceStatus represents monitored systemd service status.
type ServiceStatus struct {
	Name          string  `json:"name"`
	Status        string  `json:"status"` // RUNNING, STOPPED, FAILED, UNKNOWN
	PID           int     `json:"pid,omitempty"`
	CPUPercent    float64 `json:"cpu_percent,omitempty"`
	MemoryBytes   int64   `json:"memory_bytes,omitempty"`
	UptimeSeconds int64   `json:"uptime_seconds,omitempty"`
	RestartCount  int     `json:"restart_count,omitempty"`
	LastRestart   string  `json:"last_restart,omitempty"`
}

type ServicesCollector struct {
	servicesToMonitor []string
}

func NewServicesCollector(services []string) *ServicesCollector {
	if len(services) == 0 {
		services = []string{
			"nginx", "docker", "ssh", "sshd", "xray", "marzban",
			"mysql", "mariadb", "postgresql", "redis", "systemd-journald", "cron",
		}
	}
	return &ServicesCollector{
		servicesToMonitor: services,
	}
}

func (s *ServicesCollector) Name() string {
	return "services"
}

func (s *ServicesCollector) Collect(p *Payload) (CollectorReport, error) {
	// Attempt systemctl inspection first
	results, ok := s.collectViaSystemctl()
	if ok && len(results) > 0 {
		p.Services = results
		return CollectorReport{Status: "ok"}, nil
	}

	// Fallback to /proc examination
	p.Services = s.collectViaProc()
	return CollectorReport{Status: "ok"}, nil
}

func (s *ServicesCollector) collectViaSystemctl() ([]ServiceStatus, bool) {
	// Build systemd service unit names
	var unitArgs []string
	for _, svc := range s.servicesToMonitor {
		name := svc
		if !strings.HasSuffix(name, ".service") {
			name += ".service"
		}
		unitArgs = append(unitArgs, name)
	}

	// Run single batched systemctl show command
	args := append([]string{"show"}, unitArgs...)
	args = append(args, "--property=Id,ActiveState,SubState,MainPID,NRestarts,ActiveEnterTimestamp,MemoryCurrent")
	cmd := exec.Command("systemctl", args...)
	output, err := cmd.Output()
	if err != nil || len(output) == 0 {
		return nil, false
	}

	scanner := bufio.NewScanner(bytes.NewReader(output))
	var results []ServiceStatus
	current := make(map[string]string)

	flushCurrent := func() {
		idVal := current["Id"]
		if idVal == "" {
			return
		}
		baseName := strings.TrimSuffix(idVal, ".service")
		activeState := current["ActiveState"]
		subState := current["SubState"]

		status := "STOPPED"
		if activeState == "active" {
			status = "RUNNING"
		} else if activeState == "failed" || subState == "failed" {
			status = "FAILED"
		}

		pid, _ := strconv.Atoi(current["MainPID"])
		restarts, _ := strconv.Atoi(current["NRestarts"])
		var memBytes int64
		if uMem, err := strconv.ParseUint(current["MemoryCurrent"], 10, 64); err == nil && uMem < ^uint64(0) {
			memBytes = int64(uMem)
		}

		var uptimeSec int64
		lastRestart := current["ActiveEnterTimestamp"]
		if lastRestart != "" && activeState == "active" {
			// systemd timestamp formats typically "Mon 2026-10-07 12:00:00 UTC"
			if t, err := time.Parse("Mon 2006-01-02 15:04:05 MST", lastRestart); err == nil {
				uptimeSec = int64(time.Since(t).Seconds())
				if uptimeSec < 0 {
					uptimeSec = 0
				}
			}
		}

		results = append(results, ServiceStatus{
			Name:          baseName,
			Status:        status,
			PID:           pid,
			MemoryBytes:   memBytes,
			UptimeSeconds: uptimeSec,
			RestartCount:  restarts,
			LastRestart:   lastRestart,
		})
		current = make(map[string]string)
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			flushCurrent()
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			current[parts[0]] = parts[1]
		}
	}
	flushCurrent()

	if len(results) > 0 {
		return results, true
	}
	return nil, false
}

func (s *ServicesCollector) collectViaProc() []ServiceStatus {
	runningNames := make(map[string]int)
	entries, err := os.ReadDir("/proc")
	if err != nil {
		results := make([]ServiceStatus, 0, len(s.servicesToMonitor))
		for _, svc := range s.servicesToMonitor {
			results = append(results, ServiceStatus{Name: svc, Status: "UNKNOWN"})
		}
		return results
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
		status := "STOPPED"
		var foundPID int

		if pid, ok := runningNames[svcLower]; ok {
			status = "RUNNING"
			foundPID = pid
		} else {
			for proc, pid := range runningNames {
				if strings.Contains(proc, svcLower) || strings.Contains(svcLower, proc) {
					status = "RUNNING"
					foundPID = pid
					break
				}
			}
		}

		var memBytes int64
		if foundPID > 0 {
			if data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(foundPID), "status")); err == nil {
				for _, line := range strings.Split(string(data), "\n") {
					if strings.HasPrefix(line, "VmRSS:") {
						f := strings.Fields(line)
						if len(f) >= 2 {
							if kb, err := strconv.ParseInt(f[1], 10, 64); err == nil {
								memBytes = kb * 1024
							}
						}
						break
					}
				}
			}
		}

		results = append(results, ServiceStatus{
			Name:        svc,
			Status:      status,
			PID:         foundPID,
			MemoryBytes: memBytes,
		})
	}
	return results
}
