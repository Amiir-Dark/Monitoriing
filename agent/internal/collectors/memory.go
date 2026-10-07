package collectors

import (
	"bufio"
	"math"
	"os"
	"strconv"
	"strings"
)

type MemoryCollector struct{}

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

	return CollectorReport{Status: "ok"}, nil
}
