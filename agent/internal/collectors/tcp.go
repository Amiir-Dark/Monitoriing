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

type TCPCollector struct {
	mu            sync.Mutex
	lastRetrans   uint64
	lastOutSegs   uint64
	lastSampleAt  time.Time
}

func NewTCPCollector() *TCPCollector {
	return &TCPCollector{}
}

func (t *TCPCollector) Name() string {
	return "tcp"
}

func (t *TCPCollector) Collect(p *Payload) (CollectorReport, error) {
	var breakdown TCPStateBreakdown
	var anySuccess bool

	if parseTCPStateFile("/proc/net/tcp", &breakdown) {
		anySuccess = true
	}
	if parseTCPStateFile("/proc/net/tcp6", &breakdown) {
		anySuccess = true
	}
	breakdown.UDPTotal += countUDPFile("/proc/net/udp")
	breakdown.UDPTotal += countUDPFile("/proc/net/udp6")

	// Parse TCP retransmission and segment statistics from /proc/net/snmp
	t.collectRetransmissions(&breakdown)

	p.TCP = breakdown

	if !anySuccess {
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc/net/tcp or /proc/net/tcp6: files not accessible",
		}, nil
	}

	return CollectorReport{Status: "ok"}, nil
}

func (t *TCPCollector) collectRetransmissions(bd *TCPStateBreakdown) {
	f, err := os.Open("/proc/net/snmp")
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	var headerFields, dataFields []string

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Tcp: ") {
			if len(headerFields) == 0 {
				headerFields = strings.Fields(line)[1:]
			} else {
				dataFields = strings.Fields(line)[1:]
				break
			}
		}
	}

	if len(headerFields) == 0 || len(headerFields) != len(dataFields) {
		return
	}

	var inSegs, outSegs, retransSegs uint64
	for i, name := range headerFields {
		val, _ := strconv.ParseUint(dataFields[i], 10, 64)
		switch name {
		case "InSegs":
			inSegs = val
		case "OutSegs":
			outSegs = val
		case "RetransSegs":
			retransSegs = val
		}
	}

	bd.InSegs = inSegs
	bd.OutSegs = outSegs
	bd.RetransTotal = retransSegs

	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	if !t.lastSampleAt.IsZero() {
		elapsedSec := now.Sub(t.lastSampleAt).Seconds()
		if elapsedSec > 0.05 && outSegs >= t.lastOutSegs {
			deltaOut := outSegs - t.lastOutSegs
			deltaRetrans := uint64(0)
			if retransSegs >= t.lastRetrans {
				deltaRetrans = retransSegs - t.lastRetrans
			}
			if deltaOut > 0 {
				rate := (float64(deltaRetrans) / float64(deltaOut)) * 100.0
				bd.RetransRate = math.Round(rate*100) / 100
			}
		}
	}

	t.lastOutSegs = outSegs
	t.lastRetrans = retransSegs
	t.lastSampleAt = now
}

func parseTCPStateFile(filePath string, bd *TCPStateBreakdown) bool {
	f, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	// Skip header
	if !scanner.Scan() {
		return false
	}

	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 4 {
			bd.Total++
			state := fields[3]
			switch state {
			case "01": // ESTABLISHED
				bd.Established++
			case "02": // SYN_SENT
				bd.SynSent++
			case "03": // SYN_RECV
				bd.SynRecv++
			case "04": // FIN_WAIT1
				bd.FinWait1++
			case "05": // FIN_WAIT2
				bd.FinWait2++
			case "06": // TIME_WAIT
				bd.TimeWait++
			case "07": // CLOSE / CLOSING
				bd.Closing++
			case "08": // CLOSE_WAIT
				bd.CloseWait++
			case "09": // LAST_ACK
				bd.LastAck++
			case "0A": // LISTEN
				bd.Listen++
			case "0B": // CLOSING
				bd.Closing++
			}
		}
	}
	return true
}

func countUDPFile(filePath string) int {
	f, err := os.Open(filePath)
	if err != nil {
		return 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return 0
	}

	count := 0
	for scanner.Scan() {
		count++
	}
	return count
}
