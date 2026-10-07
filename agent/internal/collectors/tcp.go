package collectors

import (
	"bufio"
	"os"
	"strings"
)

type TCPCollector struct{}

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

	p.TCP = breakdown

	if !anySuccess {
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc/net/tcp or /proc/net/tcp6: files not accessible",
		}, nil
	}

	return CollectorReport{Status: "ok"}, nil
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
