package collectors

import (
	"bufio"
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

type cpuTime struct {
	user    uint64
	nice    uint64
	system  uint64
	idle    uint64
	iowait  uint64
	irq     uint64
	softirq uint64
	steal   uint64
}

func (c cpuTime) total() uint64 {
	return c.user + c.nice + c.system + c.idle + c.iowait + c.irq + c.softirq + c.steal
}

func (c cpuTime) active() uint64 {
	return c.total() - (c.idle + c.iowait)
}

type CPUCollector struct {
	mu          sync.Mutex
	lastOverall cpuTime
	lastCores   map[int]cpuTime
}

func NewCPUCollector() *CPUCollector {
	return &CPUCollector{
		lastCores: make(map[int]cpuTime),
	}
}

func (c *CPUCollector) Name() string {
	return "cpu"
}

func (c *CPUCollector) Collect(p *Payload) (CollectorReport, error) {
	p.CPUCount = runtime.NumCPU()
	p.CPUModel = readModelName()
	p.CPUFreqMHz = readCPUFreq()

	f, err := os.Open("/proc/stat")
	if err != nil {
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc/stat: " + err.Error(),
		}, nil
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	var currentOverall cpuTime
	currentCores := make(map[int]cpuTime)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) >= 8 {
				currentOverall = parseCPULine(fields[1:])
			}
		} else if strings.HasPrefix(line, "cpu") {
			fields := strings.Fields(line)
			if len(fields) >= 8 {
				coreName := fields[0]
				if coreIdx, err := strconv.Atoi(strings.TrimPrefix(coreName, "cpu")); err == nil {
					currentCores[coreIdx] = parseCPULine(fields[1:])
				}
			}
		} else if !strings.HasPrefix(line, "cpu") {
			break
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Calculate overall CPU metrics
	totDelta := int64(currentOverall.total()) - int64(c.lastOverall.total())
	if c.lastOverall.total() > 0 && totDelta > 0 {
		userDelta := float64(currentOverall.user+currentOverall.nice) - float64(c.lastOverall.user+c.lastOverall.nice)
		sysDelta := float64(currentOverall.system+currentOverall.irq+currentOverall.softirq) - float64(c.lastOverall.system+c.lastOverall.irq+c.lastOverall.softirq)
		idleDelta := float64(currentOverall.idle) - float64(c.lastOverall.idle)
		iowaitDelta := float64(currentOverall.iowait) - float64(c.lastOverall.iowait)
		stealDelta := float64(currentOverall.steal) - float64(c.lastOverall.steal)

		fTot := float64(totDelta)
		p.CPU = math.Round(((fTot-idleDelta-iowaitDelta)/fTot)*1000.0) / 10.0
		if p.CPU < 0 {
			p.CPU = 0
		}
		if p.CPU > 100 {
			p.CPU = 100
		}
		p.CPUUser = math.Round((userDelta/fTot)*1000.0) / 10.0
		p.CPUSystem = math.Round((sysDelta/fTot)*1000.0) / 10.0
		p.CPUIdle = math.Round((idleDelta/fTot)*1000.0) / 10.0
		p.CPUIOWait = math.Round((iowaitDelta/fTot)*1000.0) / 10.0
		p.CPUSteal = math.Round((stealDelta/fTot)*1000.0) / 10.0
	} else {
		// First tick baseline or counter reset
		p.CPU = 0
	}
	c.lastOverall = currentOverall

	// Calculate per-core metrics
	if len(currentCores) > 0 {
		coresList := make([]CPUCoreUsage, 0, len(currentCores))
		for i := 0; i < len(currentCores); i++ {
			cu := CPUCoreUsage{
				CoreIndex: i,
				FreqMHz:   p.CPUFreqMHz,
			}
			curr := currentCores[i]
			if prev, ok := c.lastCores[i]; ok {
				cTot := int64(curr.total()) - int64(prev.total())
				if cTot > 0 {
					fTot := float64(cTot)
					uDelta := float64(curr.user+curr.nice) - float64(prev.user+prev.nice)
					sDelta := float64(curr.system) - float64(prev.system)
					iDelta := float64(curr.idle) - float64(prev.idle)
					wDelta := float64(curr.iowait) - float64(prev.iowait)

					cu.Total = math.Round(((fTot-iDelta-wDelta)/fTot)*1000.0) / 10.0
					if cu.Total < 0 {
						cu.Total = 0
					}
					cu.User = math.Round((uDelta/fTot)*1000.0) / 10.0
					cu.System = math.Round((sDelta/fTot)*1000.0) / 10.0
					cu.Idle = math.Round((iDelta/fTot)*1000.0) / 10.0
					cu.IOWait = math.Round((wDelta/fTot)*1000.0) / 10.0
				}
			}
			coresList = append(coresList, cu)
		}
		p.CPUPerCore = coresList
		c.lastCores = currentCores
	}

	return CollectorReport{Status: "ok"}, nil
}

func parseCPULine(fields []string) cpuTime {
	var ct cpuTime
	if len(fields) > 0 { ct.user, _ = strconv.ParseUint(fields[0], 10, 64) }
	if len(fields) > 1 { ct.nice, _ = strconv.ParseUint(fields[1], 10, 64) }
	if len(fields) > 2 { ct.system, _ = strconv.ParseUint(fields[2], 10, 64) }
	if len(fields) > 3 { ct.idle, _ = strconv.ParseUint(fields[3], 10, 64) }
	if len(fields) > 4 { ct.iowait, _ = strconv.ParseUint(fields[4], 10, 64) }
	if len(fields) > 5 { ct.irq, _ = strconv.ParseUint(fields[5], 10, 64) }
	if len(fields) > 6 { ct.softirq, _ = strconv.ParseUint(fields[6], 10, 64) }
	if len(fields) > 7 { ct.steal, _ = strconv.ParseUint(fields[7], 10, 64) }
	return ct
}

func readCPUFreq() float64 {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "cpu MHz") {
			parts := strings.Split(line, ":")
			if len(parts) == 2 {
				if freq, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
					return freq
				}
			}
		}
	}
	return 0
}
