package collectors

import (
	"bytes"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ProcessItem represents real Linux running process telemetry.
type ProcessItem struct {
	PID           int     `json:"pid"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryBytes   uint64  `json:"memory_bytes"`
	MemoryPercent float64 `json:"memory_percent"`
	Threads       int     `json:"threads"`
	ReadBytesSec  float64 `json:"read_bytes_sec"`
	WriteBytesSec float64 `json:"write_bytes_sec"`
	UptimeSeconds int64   `json:"uptime_seconds"`
	Command       string  `json:"command"`
}

type procSample struct {
	ticks      uint64
	readBytes  uint64
	writeBytes uint64
}

type ProcessesCollector struct {
	mu           sync.Mutex
	lastSamples  map[int]procSample
	lastSampleAt time.Time
}

func NewProcessesCollector() *ProcessesCollector {
	return &ProcessesCollector{
		lastSamples: make(map[int]procSample),
	}
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

	pr.mu.Lock()
	defer pr.mu.Unlock()

	now := time.Now()
	var elapsedSec float64
	if !pr.lastSampleAt.IsZero() {
		elapsedSec = now.Sub(pr.lastSampleAt).Seconds()
	}

	currentSamples := make(map[int]procSample)
	var breakdown ProcessStateBreakdown
	var allProcesses []ProcessItem

	totalMem := p.MemTotalBytes
	if totalMem == 0 {
		totalMem = 1 // avoid div by zero
	}

	bootTime := p.BootTime
	if bootTime == 0 {
		bootTime = time.Now().Unix() - p.UptimeSeconds
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		breakdown.Total++

		pidStr := entry.Name()
		statPath := "/proc/" + pidStr + "/stat"
		statData, err := os.ReadFile(statPath)
		if err != nil {
			continue
		}

		statStr := string(statData)
		lastParen := strings.LastIndex(statStr, ")")
		firstParen := strings.Index(statStr, "(")
		if lastParen == -1 || firstParen == -1 || len(statStr) <= lastParen+2 {
			continue
		}

		comm := statStr[firstParen+1 : lastParen]
		fields := strings.Fields(statStr[lastParen+2:])
		if len(fields) < 20 {
			continue
		}

		// State is the first field after the closing paren
		state := fields[0]
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

		// Parse utime (field 11), stime (field 12), threads (field 17), starttime (field 19)
		utime, _ := strconv.ParseUint(fields[11], 10, 64)
		stime, _ := strconv.ParseUint(fields[12], 10, 64)
		threads, _ := strconv.Atoi(fields[17])
		starttime, _ := strconv.ParseUint(fields[19], 10, 64)
		totalTicks := utime + stime

		// Read VmRSS from /proc/[pid]/status
		var memBytes uint64
		if statusData, err := os.ReadFile("/proc/" + pidStr + "/status"); err == nil {
			lines := strings.Split(string(statusData), "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "VmRSS:") {
					f := strings.Fields(line)
					if len(f) >= 2 {
						if kb, err := strconv.ParseUint(f[1], 10, 64); err == nil {
							memBytes = kb * 1024
						}
					}
					break
				}
			}
		}

		// Read /proc/[pid]/io if available (requires permissions)
		var readBytes, writeBytes uint64
		if ioData, err := os.ReadFile("/proc/" + pidStr + "/io"); err == nil {
			lines := strings.Split(string(ioData), "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "read_bytes:") {
					f := strings.Fields(line)
					if len(f) >= 2 {
						readBytes, _ = strconv.ParseUint(f[1], 10, 64)
					}
				} else if strings.HasPrefix(line, "write_bytes:") {
					f := strings.Fields(line)
					if len(f) >= 2 {
						writeBytes, _ = strconv.ParseUint(f[1], 10, 64)
					}
				}
			}
		}

		curSample := procSample{
			ticks:      totalTicks,
			readBytes:  readBytes,
			writeBytes: writeBytes,
		}
		currentSamples[pid] = curSample

		// Calculate rates
		var cpuPct, readRate, writeRate float64
		if prev, ok := pr.lastSamples[pid]; ok && elapsedSec > 0.05 {
			if curSample.ticks >= prev.ticks {
				deltaTicks := curSample.ticks - prev.ticks
				// 100 clock ticks per second on standard Linux
				rawCPU := (float64(deltaTicks) / 100.0) / elapsedSec * 100.0
				cpuPct = math.Round(rawCPU*10) / 10
			}
			if curSample.readBytes >= prev.readBytes {
				readRate = math.Round((float64(curSample.readBytes-prev.readBytes)/elapsedSec)*10) / 10
			}
			if curSample.writeBytes >= prev.writeBytes {
				writeRate = math.Round((float64(curSample.writeBytes-prev.writeBytes)/elapsedSec)*10) / 10
			}
		}

		// Read command line from /proc/[pid]/cmdline
		cmdline := comm
		if cmdData, err := os.ReadFile("/proc/" + pidStr + "/cmdline"); err == nil && len(cmdData) > 0 {
			cleaned := bytes.ReplaceAll(cmdData, []byte{0}, []byte{' '})
			cmdline = strings.TrimSpace(string(cleaned))
			if len(cmdline) > 160 {
				cmdline = cmdline[:160] + "..."
			}
		}
		if cmdline == "" {
			cmdline = comm
		}

		// Calculate process uptime
		var procUptime int64
		if starttime > 0 && bootTime > 0 {
			startSec := int64(starttime / 100)
			procUptime = now.Unix() - (bootTime + startSec)
			if procUptime < 0 {
				procUptime = 0
			}
		}

		memPct := math.Round((float64(memBytes)/float64(totalMem))*1000.0) / 10.0

		allProcesses = append(allProcesses, ProcessItem{
			PID:           pid,
			Name:          comm,
			CPUPercent:    cpuPct,
			MemoryBytes:   memBytes,
			MemoryPercent: memPct,
			Threads:       threads,
			ReadBytesSec:  readRate,
			WriteBytesSec: writeRate,
			UptimeSeconds: procUptime,
			Command:       cmdline,
		})
	}

	pr.lastSamples = currentSamples
	pr.lastSampleAt = now
	p.Processes = breakdown

	// Sort and keep top processes:
	// Prioritize processes by CPU first, then Memory
	sort.Slice(allProcesses, func(i, j int) bool {
		if allProcesses[i].CPUPercent != allProcesses[j].CPUPercent {
			return allProcesses[i].CPUPercent > allProcesses[j].CPUPercent
		}
		return allProcesses[i].MemoryBytes > allProcesses[j].MemoryBytes
	})

	limit := 50
	if len(allProcesses) > limit {
		allProcesses = allProcesses[:limit]
	}

	p.TopProcesses = allProcesses
	return CollectorReport{Status: "ok"}, nil
}
