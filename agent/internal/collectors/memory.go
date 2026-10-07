package collectors

import (
	"bufio"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MemoryPressure represents Linux PSI (Pressure Stall Information).
type MemoryPressure struct {
	Available bool    `json:"available"`
	Some10    float64 `json:"some_10"`
	Some60    float64 `json:"some_60"`
	Some300   float64 `json:"some_300"`
	Full10    float64 `json:"full_10"`
	Full60    float64 `json:"full_60"`
	Full300   float64 `json:"full_300"`
}

// SwapActivity represents page in/out rates.
type SwapActivity struct {
	Available   bool    `json:"available"`
	PagesInSec  float64 `json:"pages_in_sec"`
	PagesOutSec float64 `json:"pages_out_sec"`
}

type MemoryCollector struct {
	mu           sync.Mutex
	lastPswpIn   uint64
	lastPswpOut  uint64
	lastSampleAt time.Time
}

func NewMemoryCollector() *MemoryCollector {
	return &MemoryCollector{}
}

func (m *MemoryCollector) Name() string {
	return "memory"
}

func (m *MemoryCollector) Collect(p *Payload) (CollectorReport, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc/meminfo: " + err.Error(),
		}, nil
	}
	defer f.Close()

	var (
		memTotalBytes    uint64
		memFreeBytes     uint64
		memAvailBytes    uint64
		memBuffersBytes  uint64
		memCachedBytes   uint64
		memActiveBytes   uint64
		memInactiveBytes uint64
		memDirtyBytes    uint64
		memSlabBytes     uint64
		swapTotalBytes   uint64
		swapFreeBytes    uint64
	)

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Split(line, ":")
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		fields := strings.Fields(parts[1])
		if len(fields) == 0 {
			continue
		}

		valKb, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		valBytes := valKb * 1024

		switch key {
		case "MemTotal":
			memTotalBytes = valBytes
		case "MemFree":
			memFreeBytes = valBytes
		case "MemAvailable":
			memAvailBytes = valBytes
		case "Buffers":
			memBuffersBytes = valBytes
		case "Cached":
			memCachedBytes = valBytes
		case "Active":
			memActiveBytes = valBytes
		case "Inactive":
			memInactiveBytes = valBytes
		case "Dirty":
			memDirtyBytes = valBytes
		case "Slab":
			memSlabBytes = valBytes
		case "SwapTotal":
			swapTotalBytes = valBytes
		case "SwapFree":
			swapFreeBytes = valBytes
		}
	}

	p.MemTotalBytes = memTotalBytes
	p.MemFreeBytes = memFreeBytes
	p.MemAvailBytes = memAvailBytes
	p.MemBuffersBytes = memBuffersBytes
	p.MemCachedBytes = memCachedBytes
	p.MemActiveBytes = memActiveBytes
	p.MemInactiveBytes = memInactiveBytes
	p.MemDirtyBytes = memDirtyBytes
	p.MemSlabBytes = memSlabBytes

	// Accurate calculation of used memory
	if memAvailBytes > 0 && memTotalBytes >= memAvailBytes {
		p.MemUsedBytes = memTotalBytes - memAvailBytes
	} else if memTotalBytes >= (memFreeBytes + memBuffersBytes + memCachedBytes) {
		p.MemUsedBytes = memTotalBytes - memFreeBytes - memBuffersBytes - memCachedBytes
	} else {
		p.MemUsedBytes = 0
	}

	if p.MemTotalBytes > 0 {
		pct := (float64(p.MemUsedBytes) / float64(p.MemTotalBytes)) * 100.0
		p.Memory = math.Round(pct*10) / 10
	}

	p.SwapTotalBytes = swapTotalBytes
	p.SwapFreeBytes = swapFreeBytes
	if swapTotalBytes >= swapFreeBytes {
		p.SwapUsedBytes = swapTotalBytes - swapFreeBytes
	}
	if p.SwapTotalBytes > 0 {
		swapPct := (float64(p.SwapUsedBytes) / float64(p.SwapTotalBytes)) * 100.0
		p.Swap = math.Round(swapPct*10) / 10
	}

	// Read PSI Memory Pressure from /proc/pressure/memory
	p.MemoryPressure = readMemoryPressure()

	// Read Swap Activity from /proc/vmstat
	m.collectSwapActivity(p)

	return CollectorReport{Status: "ok"}, nil
}

func readMemoryPressure() MemoryPressure {
	data, err := os.ReadFile("/proc/pressure/memory")
	if err != nil {
		return MemoryPressure{Available: false}
	}

	mp := MemoryPressure{Available: true}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		prefix := fields[0]

		parseAvg := func(raw string) float64 {
			parts := strings.Split(raw, "=")
			if len(parts) == 2 {
				if v, err := strconv.ParseFloat(parts[1], 64); err == nil {
					return v
				}
			}
			return 0
		}

		if prefix == "some" {
			mp.Some10 = parseAvg(fields[1])
			mp.Some60 = parseAvg(fields[2])
			mp.Some300 = parseAvg(fields[3])
		} else if prefix == "full" {
			mp.Full10 = parseAvg(fields[1])
			mp.Full60 = parseAvg(fields[2])
			mp.Full300 = parseAvg(fields[3])
		}
	}
	return mp
}

func (m *MemoryCollector) collectSwapActivity(p *Payload) {
	data, err := os.ReadFile("/proc/vmstat")
	if err != nil {
		p.SwapActivity = SwapActivity{Available: false}
		return
	}

	var pswpIn, pswpOut uint64
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) == 2 {
			if fields[0] == "pswpin" {
				pswpIn, _ = strconv.ParseUint(fields[1], 10, 64)
			} else if fields[0] == "pswpout" {
				pswpOut, _ = strconv.ParseUint(fields[1], 10, 64)
			}
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	var inRate, outRate float64
	if !m.lastSampleAt.IsZero() {
		elapsedSec := now.Sub(m.lastSampleAt).Seconds()
		if elapsedSec > 0.05 {
			if pswpIn >= m.lastPswpIn {
				inRate = math.Round((float64(pswpIn-m.lastPswpIn)/elapsedSec)*10) / 10
			}
			if pswpOut >= m.lastPswpOut {
				outRate = math.Round((float64(pswpOut-m.lastPswpOut)/elapsedSec)*10) / 10
			}
		}
	}

	m.lastPswpIn = pswpIn
	m.lastPswpOut = pswpOut
	m.lastSampleAt = now

	p.SwapActivity = SwapActivity{
		Available:   true,
		PagesInSec:  inRate,
		PagesOutSec: outRate,
	}
}
