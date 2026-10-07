package collectors

import (
	"os"
	"strconv"
	"strings"
)

type LoadCollector struct{}

func NewLoadCollector() *LoadCollector {
	return &LoadCollector{}
}

func (l *LoadCollector) Name() string {
	return "load"
}

func (l *LoadCollector) Collect(p *Payload) (CollectorReport, error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		p.Load.Available = false
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc/loadavg: " + err.Error(),
		}, nil
	}

	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		p.Load.Available = false
		return CollectorReport{
			Status:  "error",
			Message: "Malformed /proc/loadavg output",
		}, nil
	}

	p.Load1, _ = strconv.ParseFloat(fields[0], 64)
	p.Load5, _ = strconv.ParseFloat(fields[1], 64)
	p.Load15, _ = strconv.ParseFloat(fields[2], 64)

	p.Load.Load1 = p.Load1
	p.Load.Load5 = p.Load5
	p.Load.Load15 = p.Load15
	p.Load.Available = true

	// Parse running threads and total threads from fields[3], e.g. "2/180"
	if len(fields) >= 4 {
		threads := strings.Split(fields[3], "/")
		if len(threads) == 2 {
			p.Load.RunningThreads, _ = strconv.Atoi(threads[0])
			p.Load.TotalThreads, _ = strconv.Atoi(threads[1])
		}
	}

	// Parse last created PID
	if len(fields) >= 5 {
		p.Load.LastPID, _ = strconv.Atoi(fields[4])
	}

	return CollectorReport{Status: "ok"}, nil
}
