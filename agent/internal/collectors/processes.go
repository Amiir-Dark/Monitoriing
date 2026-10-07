package collectors

import (
	"os"
	"strconv"
	"strings"
)

type ProcessesCollector struct{}

func NewProcessesCollector() *ProcessesCollector {
	return &ProcessesCollector{}
}

func (pr *ProcessesCollector) Name() string {
	return "processes"
}

func (pr *ProcessesCollector) Collect(p *Payload) (CollectorReport, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc: " + err.Error(),
		}, nil
	}

	var breakdown ProcessStateBreakdown

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		// Process directories in /proc are numeric PIDs
		if _, err := strconv.Atoi(entry.Name()); err != nil {
			continue
		}
		breakdown.Total++

		// Inspect /proc/[pid]/stat for state
		statPath := "/proc/" + entry.Name() + "/stat"
		if data, err := os.ReadFile(statPath); err == nil {
			statStr := string(data)
			lastParen := strings.LastIndex(statStr, ")")
			if lastParen != -1 && len(statStr) > lastParen+2 {
				state := statStr[lastParen+2 : lastParen+3]
				switch state {
				case "R":
					breakdown.Running++
				case "S", "I":
					breakdown.Sleeping++
				case "D":
					breakdown.DiskSleep++
				case "Z":
					breakdown.Zombie++
				case "T", "t":
					breakdown.Stopped++
				}
			}
		}
	}

	p.Processes = breakdown
	return CollectorReport{Status: "ok"}, nil
}
