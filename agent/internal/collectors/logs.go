package collectors

import (
	"bufio"
	"bytes"
	"os"
	"os/exec"
	"strings"
	"time"
)

// NodeLogEntry represents an actual system/journal log event.
type NodeLogEntry struct {
	Timestamp int64  `json:"timestamp"`
	Unit      string `json:"unit"`
	Level     string `json:"level"` // info, warning, error, debug
	Message   string `json:"message"`
}

type LogsCollector struct{}

func NewLogsCollector() *LogsCollector {
	return &LogsCollector{}
}

func (l *LogsCollector) Name() string {
	return "logs"
}

func (l *LogsCollector) Collect(p *Payload) (CollectorReport, error) {
	// 1. Try reading journalctl first
	entries, ok := l.collectFromJournal()
	if ok && len(entries) > 0 {
		p.Logs = entries
		return CollectorReport{Status: "ok"}, nil
	}

	// 2. Fallback to /var/log/syslog or /var/log/messages
	entries = l.collectFromFile()
	p.Logs = entries
	return CollectorReport{Status: "ok"}, nil
}

func (l *LogsCollector) collectFromJournal() ([]NodeLogEntry, bool) {
	cmd := exec.Command("journalctl", "-n", "60", "--no-pager", "-o", "short-iso")
	out, err := cmd.Output()
	if err != nil || len(out) == 0 {
		return nil, false
	}

	var entries []NodeLogEntry
	scanner := bufio.NewScanner(bytes.NewReader(out))

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		// Example: 2026-10-07T12:00:00+0000 hostname sshd[123]: Accepted publickey...
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		var ts int64
		if t, err := time.Parse(time.RFC3339, fields[0]); err == nil {
			ts = t.Unix()
		} else {
			ts = time.Now().Unix()
		}

		unit := fields[2]
		msg := strings.Join(fields[3:], " ")

		level := "info"
		msgLower := strings.ToLower(msg)
		if strings.Contains(msgLower, "error") || strings.Contains(msgLower, "fail") || strings.Contains(msgLower, "fatal") {
			level = "error"
		} else if strings.Contains(msgLower, "warn") {
			level = "warning"
		}

		entries = append(entries, NodeLogEntry{
			Timestamp: ts,
			Unit:      strings.TrimSuffix(unit, ":"),
			Level:     level,
			Message:   msg,
		})
	}

	return entries, true
}

func (l *LogsCollector) collectFromFile() []NodeLogEntry {
	var entries []NodeLogEntry
	paths := []string{"/var/log/syslog", "/var/log/messages", "/var/log/auth.log"}

	var fileData []byte
	for _, p := range paths {
		if data, err := os.ReadFile(p); err == nil && len(data) > 0 {
			fileData = data
			break
		}
	}

	if len(fileData) == 0 {
		return entries
	}

	lines := strings.Split(string(fileData), "\n")
	start := 0
	if len(lines) > 60 {
		start = len(lines) - 60
	}

	for _, line := range lines[start:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}

		unit := fields[4]
		msg := strings.Join(fields[5:], " ")

		level := "info"
		msgLower := strings.ToLower(msg)
		if strings.Contains(msgLower, "error") || strings.Contains(msgLower, "fail") || strings.Contains(msgLower, "fatal") {
			level = "error"
		} else if strings.Contains(msgLower, "warn") {
			level = "warning"
		}

		entries = append(entries, NodeLogEntry{
			Timestamp: time.Now().Unix(),
			Unit:      strings.TrimSuffix(unit, ":"),
			Level:     level,
			Message:   msg,
		})
	}

	return entries
}
