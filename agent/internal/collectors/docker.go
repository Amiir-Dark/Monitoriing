package collectors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

// DockerContainer represents a live container's telemetry.
type DockerContainer struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Image         string  `json:"image"`
	Status        string  `json:"status"` // "Up 2 hours", "Exited (0)", etc.
	State         string  `json:"state"`  // "running", "exited", "paused"
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryBytes   uint64  `json:"memory_bytes"`
	MemoryLimit   uint64  `json:"memory_limit"`
	NetworkRX     float64 `json:"network_rx"`
	NetworkTX     float64 `json:"network_tx"`
	DiskRead      float64 `json:"disk_read"`
	DiskWrite     float64 `json:"disk_write"`
	RestartCount  int     `json:"restart_count"`
	UptimeSeconds int64   `json:"uptime_seconds"`
}

// DockerReport contains the Docker daemon detection status and list of containers.
type DockerReport struct {
	Available  bool              `json:"available"`
	Message    string            `json:"message,omitempty"`
	Containers []DockerContainer `json:"containers"`
}

type DockerCollector struct {
	socketPath string
	client     *http.Client
}

func NewDockerCollector() *DockerCollector {
	socketPath := "/var/run/docker.sock"
	// Create an HTTP client that communicates over the Unix domain socket
	client := &http.Client{
		Timeout: 4 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "unix", socketPath)
			},
			DisableKeepAlives: true,
		},
	}
	return &DockerCollector{
		socketPath: socketPath,
		client:     client,
	}
}

func (d *DockerCollector) Name() string {
	return "docker"
}

// Minimal JSON structs to parse Docker daemon responses
type rawDockerContainer struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Created int64             `json:"Created"`
	Labels  map[string]string `json:"Labels"`
}

type rawDockerStats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     int    `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64 `json:"usage"`
		Limit uint64 `json:"limit"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RXBytes uint64 `json:"rx_bytes"`
		TXBytes uint64 `json:"tx_bytes"`
	} `json:"networks"`
	BlkioStats struct {
		IOServiceBytesRecursive []struct {
			Op    string `json:"op"`
			Bytes uint64 `json:"value"`
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
}

func (d *DockerCollector) Collect(p *Payload) (CollectorReport, error) {
	// 1. Check if socket exists
	if _, err := os.Stat(d.socketPath); os.IsNotExist(err) {
		p.Docker = DockerReport{
			Available:  false,
			Message:    "Docker not detected",
			Containers: []DockerContainer{},
		}
		return CollectorReport{
			Status:  "unavailable",
			Message: "Docker not detected (socket /var/run/docker.sock absent)",
		}, nil
	}

	// 2. Query /containers/json to list all active containers
	resp, err := d.client.Get("http://docker/containers/json?all=1")
	if err != nil {
		p.Docker = DockerReport{
			Available:  false,
			Message:    "Docker not detected",
			Containers: []DockerContainer{},
		}
		return CollectorReport{
			Status:  "unavailable",
			Message: "Docker socket exists but daemon did not respond: " + err.Error(),
		}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		p.Docker = DockerReport{
			Available:  false,
			Message:    "Docker not detected",
			Containers: []DockerContainer{},
		}
		return CollectorReport{
			Status:  "unavailable",
			Message: fmt.Sprintf("Docker returned HTTP %d", resp.StatusCode),
		}, nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		p.Docker = DockerReport{
			Available:  false,
			Message:    "Failed to read Docker response",
			Containers: []DockerContainer{},
		}
		return CollectorReport{Status: "error", Message: err.Error()}, nil
	}

	var rawContainers []rawDockerContainer
	if err := json.Unmarshal(body, &rawContainers); err != nil {
		p.Docker = DockerReport{
			Available:  false,
			Message:    "Failed to parse Docker response",
			Containers: []DockerContainer{},
		}
		return CollectorReport{Status: "error", Message: err.Error()}, nil
	}

	containers := make([]DockerContainer, 0, len(rawContainers))
	now := time.Now().Unix()

	for _, rc := range rawContainers {
		name := rc.ID
		if len(rc.Names) > 0 {
			name = strings.TrimPrefix(rc.Names[0], "/")
		}
		shortID := rc.ID
		if len(shortID) > 12 {
			shortID = shortID[:12]
		}

		c := DockerContainer{
			ID:          shortID,
			Name:        name,
			Image:       rc.Image,
			Status:      rc.Status,
			State:       rc.State,
			MemoryLimit: 0,
		}

		if rc.Created > 0 && now > rc.Created {
			c.UptimeSeconds = now - rc.Created
		}

		// Only query stats if the container is running
		if rc.State == "running" {
			d.populateContainerStats(&c, rc.ID)
		}

		containers = append(containers, c)
	}

	p.Docker = DockerReport{
		Available:  true,
		Message:    fmt.Sprintf("%d containers detected", len(containers)),
		Containers: containers,
	}

	return CollectorReport{Status: "ok"}, nil
}

func (d *DockerCollector) populateContainerStats(c *DockerContainer, containerID string) {
	statsURL := fmt.Sprintf("http://docker/containers/%s/stats?stream=false", containerID)
	resp, err := d.client.Get(statsURL)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}

	var stats rawDockerStats
	if err := json.Unmarshal(body, &stats); err != nil {
		return
	}

	// 1. Calculate CPU Percent
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage) - float64(stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemCPUUsage) - float64(stats.PreCPUStats.SystemCPUUsage)
	onlineCPUs := stats.CPUStats.OnlineCPUs
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}

	if systemDelta > 0 && cpuDelta >= 0 {
		cpuPct := (cpuDelta / systemDelta) * float64(onlineCPUs) * 100.0
		c.CPUPercent = math.Round(cpuPct*10) / 10
	}

	// 2. Memory
	c.MemoryBytes = stats.MemoryStats.Usage
	c.MemoryLimit = stats.MemoryStats.Limit

	// 3. Network totals
	var totalRX, totalTX uint64
	for _, netStats := range stats.Networks {
		totalRX += netStats.RXBytes
		totalTX += netStats.TXBytes
	}
	c.NetworkRX = float64(totalRX)
	c.NetworkTX = float64(totalTX)

	// 4. Block I/O
	var totalRead, totalWrite uint64
	for _, blk := range stats.BlkioStats.IOServiceBytesRecursive {
		switch strings.ToLower(blk.Op) {
		case "read":
			totalRead += blk.Bytes
		case "write":
			totalWrite += blk.Bytes
		}
	}
	c.DiskRead = float64(totalRead)
	c.DiskWrite = float64(totalWrite)
}
