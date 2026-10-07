package collectors

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

// CollectorReport tracks execution time and diagnostic errors per collector.
type CollectorReport struct {
	Status      string `json:"status"`                // ok, unavailable, error
	Message     string `json:"message,omitempty"`     // failure or skip reason
	DurationUS  int64  `json:"duration_us,omitempty"` // microseconds taken
	CollectedAt int64  `json:"collected_at"`          // timestamp
}

// CPUCoreUsage represents precise per-core statistics.
type CPUCoreUsage struct {
	CoreIndex int     `json:"core_index"`
	Total     float64 `json:"total"`
	User      float64 `json:"user,omitempty"`
	System    float64 `json:"system,omitempty"`
	Idle      float64 `json:"idle,omitempty"`
	IOWait    float64 `json:"iowait,omitempty"`
	FreqMHz   float64 `json:"freq_mhz,omitempty"`
}

// DiskMountDetail represents complete filesystem usage including inodes.
type DiskMountDetail struct {
	MountPoint    string  `json:"mount_point"`
	Device        string  `json:"device"`
	FSType        string  `json:"fs_type"`
	TotalBytes    uint64  `json:"total_bytes"`
	UsedBytes     uint64  `json:"used_bytes"`
	AvailBytes    uint64  `json:"avail_bytes"`
	Percent       float64 `json:"percent"`
	InodesTotal   uint64  `json:"inodes_total,omitempty"`
	InodesUsed    uint64  `json:"inodes_used,omitempty"`
	InodesFree    uint64  `json:"inodes_free,omitempty"`
	InodesPercent float64 `json:"inodes_percent,omitempty"`
}

// DiskIODeviceDetail represents exact per-block-device IOPS and byte rates.
type DiskIODeviceDetail struct {
	DeviceName      string  `json:"device_name"`
	ReadBytesSec    float64 `json:"read_bytes_sec"`
	WriteBytesSec   float64 `json:"write_bytes_sec"`
	ReadOpsSec      float64 `json:"read_ops_sec"`
	WriteOpsSec     float64 `json:"write_ops_sec"`
	IOTimeMS        int64   `json:"io_time_ms,omitempty"`
	TotalReadBytes  uint64  `json:"total_read_bytes"`
	TotalWriteBytes uint64  `json:"total_write_bytes"`
}

// NetworkInterfaceDetail represents per-adapter rates, totals, and errors.
type NetworkInterfaceDetail struct {
	Name             string   `json:"name"`
	MAC              string   `json:"mac,omitempty"`
	IPAddresses      []string `json:"ip_addresses,omitempty"`
	Status           string   `json:"status"` // up, down
	SpeedMbps        int      `json:"speed_mbps,omitempty"`
	RXBytesSec       float64  `json:"rx_bytes_sec"`
	TXBytesSec       float64  `json:"tx_bytes_sec"`
	RXPacketsSec     float64  `json:"rx_packets_sec,omitempty"`
	TXPacketsSec     float64  `json:"tx_packets_sec,omitempty"`
	TotalRXBytes     uint64   `json:"total_rx_bytes"`
	TotalTXBytes     uint64   `json:"total_tx_bytes"`
	TotalRXPackets   uint64   `json:"total_rx_packets,omitempty"`
	TotalTXPackets   uint64   `json:"total_tx_packets,omitempty"`
	TotalRXErrors    uint64   `json:"total_rx_errors"`
	TotalTXErrors    uint64   `json:"total_tx_errors"`
	TotalRXDrops     uint64   `json:"total_rx_drops,omitempty"`
	TotalTXDrops     uint64   `json:"total_tx_drops,omitempty"`
}

// ThermalSensorDetail represents individual real hardware sensor readings.
type ThermalSensorDetail struct {
	Name         string   `json:"name"`
	TemperatureC float64  `json:"temperature_c"`
	CriticalC    *float64 `json:"critical_c,omitempty"`
	Status       string   `json:"status"` // ok, warning, critical
}

// TCPStateBreakdown represents exact socket state counts from /proc/net/tcp.
type TCPStateBreakdown struct {
	Established int `json:"established"`
	SynSent     int `json:"syn_sent"`
	SynRecv     int `json:"syn_recv"`
	FinWait1    int `json:"fin_wait1"`
	FinWait2    int `json:"fin_wait2"`
	TimeWait    int `json:"time_wait"`
	CloseWait   int `json:"close_wait"`
	LastAck     int `json:"last_ack"`
	Listen      int `json:"listen"`
	Closing     int `json:"closing"`
	Total       int `json:"total"`
	UDPTotal    int `json:"udp_total"`
}

// ProcessStateBreakdown represents exact process counts by OS state.
type ProcessStateBreakdown struct {
	Total     int `json:"total"`
	Running   int `json:"running"`    // R
	Sleeping  int `json:"sleeping"`   // S
	DiskSleep int `json:"disk_sleep"` // D
	Zombie    int `json:"zombie"`     // Z
	Stopped   int `json:"stopped"`    // T
}

// LoadDetail holds detailed load averages and kernel thread counts.
type LoadDetail struct {
	Load1          float64 `json:"load1"`
	Load5          float64 `json:"load5"`
	Load15         float64 `json:"load15"`
	RunningThreads int     `json:"running_threads"`
	TotalThreads   int     `json:"total_threads"`
	LastPID        int     `json:"last_pid,omitempty"`
	Available      bool    `json:"available"`
}

// ServiceStatus represents monitored service status.
type ServiceStatus struct {
	Name          string `json:"name"`
	Status        string `json:"status"` // running, stopped, failed, unknown
	PID           int    `json:"pid,omitempty"`
	MemoryBytes   int64  `json:"memory_bytes,omitempty"`
	UptimeSeconds int64  `json:"uptime_seconds,omitempty"`
}

// Payload represents the comprehensive, accurate metrics batch.
type Payload struct {
	Timestamp            int64                      `json:"timestamp"`
	CollectionDurationUS int64                      `json:"collection_duration_us,omitempty"`
	Collectors           map[string]CollectorReport `json:"collectors,omitempty"`

	// CPU
	CPU        float64        `json:"cpu"`
	CPUUser    float64        `json:"cpu_user,omitempty"`
	CPUSystem  float64        `json:"cpu_system,omitempty"`
	CPUIdle    float64        `json:"cpu_idle,omitempty"`
	CPUIOWait  float64        `json:"cpu_iowait,omitempty"`
	CPUSteal   float64        `json:"cpu_steal,omitempty"`
	CPUModel   string         `json:"cpu_model,omitempty"`
	CPUCount   int            `json:"cpu_count"`
	CPUFreqMHz float64        `json:"cpu_freq_mhz,omitempty"`
	CPUPerCore []CPUCoreUsage `json:"cpu_per_core,omitempty"`

	// Memory (Exact bytes)
	Memory           float64 `json:"memory"`
	MemTotalBytes    uint64  `json:"mem_total_bytes"`
	MemUsedBytes     uint64  `json:"mem_used_bytes"`
	MemFreeBytes     uint64  `json:"mem_free_bytes"`
	MemAvailBytes    uint64  `json:"mem_avail_bytes"`
	MemBuffersBytes  uint64  `json:"mem_buffers_bytes,omitempty"`
	MemCachedBytes   uint64  `json:"mem_cached_bytes,omitempty"`
	MemActiveBytes   uint64  `json:"mem_active_bytes,omitempty"`
	MemInactiveBytes uint64  `json:"mem_inactive_bytes,omitempty"`
	MemDirtyBytes    uint64  `json:"mem_dirty_bytes,omitempty"`
	MemSlabBytes     uint64  `json:"mem_slab_bytes,omitempty"`

	// Swap (Exact bytes)
	Swap           float64 `json:"swap"`
	SwapTotalBytes uint64  `json:"swap_total_bytes,omitempty"`
	SwapUsedBytes  uint64  `json:"swap_used_bytes,omitempty"`
	SwapFreeBytes  uint64  `json:"swap_free_bytes,omitempty"`

	// Disk
	Disk              float64              `json:"disk"`
	DiskTotalBytes    uint64               `json:"disk_total_bytes"`
	DiskUsedBytes     uint64               `json:"disk_used_bytes"`
	Mounts            []DiskMountDetail    `json:"mounts,omitempty"`
	DiskIODevices     []DiskIODeviceDetail `json:"disk_io_devices,omitempty"`
	DiskReadBytesSec  float64              `json:"disk_read_bytes_sec"`
	DiskWriteBytesSec float64              `json:"disk_write_bytes_sec"`
	DiskReadOpsSec    float64              `json:"disk_read_ops_sec,omitempty"`
	DiskWriteOpsSec   float64              `json:"disk_write_ops_sec,omitempty"`

	// Network
	NetworkRXBytesSec float64                  `json:"network_rx"`
	NetworkTXBytesSec float64                  `json:"network_tx"`
	TotalRXBytes      uint64                   `json:"total_rx_bytes,omitempty"`
	TotalTXBytes      uint64                   `json:"total_tx_bytes,omitempty"`
	Interfaces        []NetworkInterfaceDetail `json:"interfaces,omitempty"`

	// Load & System
	Load   LoadDetail `json:"load"`
	Load1  float64    `json:"load1"`
	Load5  float64    `json:"load5"`
	Load15 float64    `json:"load15"`

	// Temperature
	Temperature    *float64              `json:"temperature,omitempty"`
	ThermalSensors []ThermalSensorDetail `json:"thermal_sensors,omitempty"`

	// Processes & TCP
	Processes ProcessStateBreakdown `json:"processes"`
	TCP       TCPStateBreakdown     `json:"tcp"`
	Services  []ServiceStatus       `json:"services,omitempty"`

	// Uptime & Boot time
	UptimeSeconds int64 `json:"uptime_seconds"`
	BootTime      int64 `json:"boot_time,omitempty"`
}

// Collector is the modular interface for each metric domain.
type Collector interface {
	Name() string
	Collect(p *Payload) (CollectorReport, error)
}

// Manager orchestrates all registered metric collectors.
type Manager struct {
	collectors []Collector
}

func NewManager() *Manager {
	m := &Manager{}
	m.Register(NewCPUCollector())
	m.Register(NewMemoryCollector())
	m.Register(NewDiskCollector())
	m.Register(NewNetworkCollector())
	m.Register(NewLoadCollector())
	m.Register(NewTemperatureCollector())
	m.Register(NewProcessesCollector())
	m.Register(NewTCPCollector())
	return m
}

func (m *Manager) Register(c Collector) {
	m.collectors = append(m.collectors, c)
}

func (m *Manager) CollectAll(servicesToMonitor []string) *Payload {
	totalStart := time.Now()
	p := &Payload{
		Timestamp:      time.Now().Unix(),
		Collectors:     make(map[string]CollectorReport),
		ThermalSensors: []ThermalSensorDetail{},
		Mounts:         []DiskMountDetail{},
		DiskIODevices:  []DiskIODeviceDetail{},
		Interfaces:     []NetworkInterfaceDetail{},
		CPUPerCore:     []CPUCoreUsage{},
		Services:       []ServiceStatus{},
	}

	for _, c := range m.collectors {
		cStart := time.Now()
		report, _ := c.Collect(p)
		report.DurationUS = time.Since(cStart).Microseconds()
		report.CollectedAt = time.Now().Unix()
		p.Collectors[c.Name()] = report
	}

	// Collect services
	svcCollector := NewServicesCollector(servicesToMonitor)
	sStart := time.Now()
	svcReport, _ := svcCollector.Collect(p)
	svcReport.DurationUS = time.Since(sStart).Microseconds()
	svcReport.CollectedAt = time.Now().Unix()
	p.Collectors["services"] = svcReport

	// Global Uptime and Boot Time
	uptimeSec, bootSec := readUptimeAndBoot()
	p.UptimeSeconds = uptimeSec
	p.BootTime = bootSec

	p.CollectionDurationUS = time.Since(totalStart).Microseconds()
	return p
}

func readUptimeAndBoot() (int64, int64) {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, 0
	}
	fields := strings.Fields(string(data))
	if len(fields) > 0 {
		if up, err := strconv.ParseFloat(fields[0], 64); err == nil {
			uptimeSec := int64(up)
			bootTime := time.Now().Unix() - uptimeSec
			return uptimeSec, bootTime
		}
	}
	return 0, 0
}

func readModelName() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") {
			parts := strings.Split(line, ":")
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return ""
}
