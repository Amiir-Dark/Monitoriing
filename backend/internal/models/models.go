package models

import "time"

// User represents an administrative or viewer account.
type User struct {
	ID           string     `json:"id"`
	Username     string     `json:"username"`
	PasswordHash string     `json:"-"`
	Role         string     `json:"role"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
}

// Node represents a monitored server with full metadata.
type Node struct {
	ID                string        `json:"id"`
	Name              string        `json:"name"`
	Hostname          string        `json:"hostname"`
	IPAddress         string        `json:"ip_address"`
	OperatingSystem   string        `json:"operating_system"`
	Architecture      string        `json:"architecture"`
	Kernel            string        `json:"kernel"`
	AgentVersion      string        `json:"agent_version"`
	Status            string        `json:"status"` // ONLINE, STALE, DEGRADED, OFFLINE, disabled, unknown
	ConnectionState   string        `json:"connection_state"` // ONLINE, STALE, DEGRADED, OFFLINE
	HeartbeatInterval int           `json:"heartbeat_interval"`
	LatencyMS         float64       `json:"latency_ms"`
	LastSeen          *time.Time    `json:"last_seen,omitempty"`
	LastHeartbeat     *time.Time    `json:"last_heartbeat,omitempty"`
	LastTelemetryAt   *time.Time    `json:"last_telemetry_at,omitempty"`
	CreatedAt         time.Time     `json:"created_at"`
	UpdatedAt         time.Time     `json:"updated_at"`
	GroupID           *string       `json:"group_id,omitempty"`
	GroupName         *string       `json:"group_name,omitempty"`
	Disabled          bool          `json:"disabled"`
	Tags              []string      `json:"tags,omitempty"`
	LatestMetrics     *NodeStats    `json:"latest_metrics,omitempty"`
	LatestPayload     *AgentPayload `json:"latest_payload,omitempty"`
}

// NodeToken represents an authentication token for a node agent.
type NodeToken struct {
	ID         string     `json:"id"`
	NodeID     string     `json:"node_id"`
	TokenHash  string     `json:"-"`
	RawToken   string     `json:"token,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

// NodeGroup represents a cluster or environment category.
type NodeGroup struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	NodeCount   int       `json:"node_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// MetricRecord represents a single point-in-time metric.
type MetricRecord struct {
	ID         int64   `json:"id"`
	NodeID     string  `json:"node_id"`
	Timestamp  int64   `json:"timestamp"`
	MetricType string  `json:"metric_type"`
	Value      float64 `json:"value"`
}

// AggregatedMetric represents an hourly or daily roll-up.
type AggregatedMetric struct {
	Timestamp   int64   `json:"timestamp"`
	MetricType  string  `json:"metric_type"`
	MinValue    float64 `json:"min_value"`
	MaxValue    float64 `json:"max_value"`
	AvgValue    float64 `json:"avg_value"`
	SampleCount int     `json:"sample_count"`
}

// ProcessItem represents a real Linux running process snapshot.
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

// DockerContainer represents real Docker container telemetry.
type DockerContainer struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Image         string  `json:"image"`
	Status        string  `json:"status"` // Up 2 hours, Exited, etc.
	State         string  `json:"state"`  // running, exited, paused
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

// DockerReport tracks Docker daemon availability and containers.
type DockerReport struct {
	Available  bool              `json:"available"`
	Message    string            `json:"message,omitempty"` // "Docker not detected" or "Connected"
	Containers []DockerContainer `json:"containers"`
}

// NodeLogEntry represents actual system/service log events.
type NodeLogEntry struct {
	Timestamp int64  `json:"timestamp"`
	Unit      string `json:"unit"`
	Level     string `json:"level"` // info, warning, error, debug
	Message   string `json:"message"`
}

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

// Service represents a monitored service status on a node.
type Service struct {
	ID            string    `json:"id"`
	NodeID        string    `json:"node_id"`
	Name          string    `json:"name"`
	Status        string    `json:"status"` // RUNNING, STOPPED, FAILED, unknown
	PID           int       `json:"pid,omitempty"`
	CPUPercent    float64   `json:"cpu_percent,omitempty"`
	MemoryBytes   int64     `json:"memory_bytes,omitempty"`
	UptimeSeconds int64     `json:"uptime_seconds,omitempty"`
	RestartCount  int       `json:"restart_count,omitempty"`
	LastRestart   string    `json:"last_restart,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// AlertRule defines conditions under which alerts are generated.
type AlertRule struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	MetricType      string    `json:"metric_type"`
	Operator        string    `json:"operator"`
	Threshold       float64   `json:"threshold"`
	DurationSeconds int       `json:"duration_seconds"`
	Severity        string    `json:"severity"` // critical, warning, info
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"created_at"`
}

// Alert represents an alert event triggered by an alert rule.
type Alert struct {
	ID             string     `json:"id"`
	NodeID         string     `json:"node_id"`
	NodeName       string     `json:"node_name,omitempty"`
	RuleID         *string    `json:"rule_id,omitempty"`
	RuleName       string     `json:"rule_name,omitempty"`
	Metric         string     `json:"metric,omitempty"`
	Status         string     `json:"status"` // triggered, acknowledged, resolved
	Severity       string     `json:"severity"` // critical, warning, info
	Message        string     `json:"message"`
	Value          float64    `json:"value"`
	Threshold      float64    `json:"threshold"`
	Duration       string     `json:"duration,omitempty"`
	TriggeredAt    time.Time  `json:"triggered_at"`
	LastUpdate     time.Time  `json:"last_update"`
	AcknowledgedAt *time.Time `json:"acknowledged_at,omitempty"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
}

// TelegramIntegration represents configuration for Telegram bot notifications.
type TelegramIntegration struct {
	ID        string    `json:"id"`
	BotToken  string    `json:"bot_token"`
	ChatID    string    `json:"chat_id"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AuditLog tracks sensitive admin operations.
type AuditLog struct {
	ID        int64     `json:"id"`
	UserID    string    `json:"user_id"`
	Username  string    `json:"username,omitempty"`
	Action    string    `json:"action"`
	Details   string    `json:"details"`
	IPAddress string    `json:"ip_address"`
	CreatedAt time.Time `json:"created_at"`
}

// CollectorReport tracks the precise health, execution time, and errors of individual collectors.
type CollectorReport struct {
	Status      string `json:"status"`                // ok, unavailable, error
	Message     string `json:"message,omitempty"`     // exact failure reason if unavailable
	DurationUS  int64  `json:"duration_us,omitempty"` // execution duration in microseconds
	CollectedAt int64  `json:"collected_at"`          // timestamp
}

// CPUCoreUsage represents precise per-core stats.
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
	IOPS            float64 `json:"iops,omitempty"`
	LatencyMS       float64 `json:"latency_ms,omitempty"`
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
	RXDropsSec       float64  `json:"rx_drops_sec,omitempty"`
	TXDropsSec       float64  `json:"tx_drops_sec,omitempty"`
	RXErrorsSec      float64  `json:"rx_errors_sec,omitempty"`
	TXErrorsSec      float64  `json:"tx_errors_sec,omitempty"`
	PacketLossPct    float64  `json:"packet_loss_pct,omitempty"`
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
	Established  int     `json:"established"`
	SynSent      int     `json:"syn_sent"`
	SynRecv      int     `json:"syn_recv"`
	FinWait1     int     `json:"fin_wait1"`
	FinWait2     int     `json:"fin_wait2"`
	TimeWait     int     `json:"time_wait"`
	CloseWait    int     `json:"close_wait"`
	LastAck      int     `json:"last_ack"`
	Listen       int     `json:"listen"`
	Closing      int     `json:"closing"`
	Total        int     `json:"total"`
	UDPTotal     int     `json:"udp_total"`
	RetransRate  float64 `json:"retrans_rate,omitempty"`
	RetransTotal uint64  `json:"retrans_total,omitempty"`
	InSegs       uint64  `json:"in_segs,omitempty"`
	OutSegs      uint64  `json:"out_segs,omitempty"`
}

// ProcessStateBreakdown represents exact process counts by OS state.
type ProcessStateBreakdown struct {
	Total     int `json:"total"`
	Running   int `json:"running"`   // R
	Sleeping  int `json:"sleeping"`  // S
	DiskSleep int `json:"disk_sleep"`// D
	Zombie    int `json:"zombie"`    // Z
	Stopped   int `json:"stopped"`   // T
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
	Name          string  `json:"name"`
	Status        string  `json:"status"` // RUNNING, STOPPED, FAILED, unknown
	PID           int     `json:"pid,omitempty"`
	CPUPercent    float64 `json:"cpu_percent,omitempty"`
	MemoryBytes   int64   `json:"memory_bytes,omitempty"`
	UptimeSeconds int64   `json:"uptime_seconds,omitempty"`
	RestartCount  int     `json:"restart_count,omitempty"`
	LastRestart   string  `json:"last_restart,omitempty"`
}

// AgentPayload is the comprehensive, precise batch metrics payload.
type AgentPayload struct {
	Timestamp            int64                      `json:"timestamp"`
	CollectionDurationUS int64                      `json:"collection_duration_us,omitempty"`
	Collectors           map[string]CollectorReport `json:"collectors,omitempty"`

	// CPU
	CPU        float64        `json:"cpu"` // Total percentage
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
	Memory           float64        `json:"memory"` // percentage
	MemTotalBytes    uint64         `json:"mem_total_bytes"`
	MemUsedBytes     uint64         `json:"mem_used_bytes"`
	MemFreeBytes     uint64         `json:"mem_free_bytes"`
	MemAvailBytes    uint64         `json:"mem_avail_bytes"`
	MemBuffersBytes  uint64         `json:"mem_buffers_bytes,omitempty"`
	MemCachedBytes   uint64         `json:"mem_cached_bytes,omitempty"`
	MemActiveBytes   uint64         `json:"mem_active_bytes,omitempty"`
	MemInactiveBytes uint64         `json:"mem_inactive_bytes,omitempty"`
	MemDirtyBytes    uint64         `json:"mem_dirty_bytes,omitempty"`
	MemSlabBytes     uint64         `json:"mem_slab_bytes,omitempty"`
	MemoryPressure   MemoryPressure `json:"memory_pressure"`
	SwapActivity     SwapActivity   `json:"swap_activity"`

	// Swap (Exact bytes)
	Swap           float64 `json:"swap"` // percentage
	SwapTotalBytes uint64  `json:"swap_total_bytes,omitempty"`
	SwapUsedBytes  uint64  `json:"swap_used_bytes,omitempty"`
	SwapFreeBytes  uint64  `json:"swap_free_bytes,omitempty"`

	// Disk
	Disk              float64              `json:"disk"` // main root percentage
	DiskTotalBytes    uint64               `json:"disk_total_bytes"`
	DiskUsedBytes     uint64               `json:"disk_used_bytes"`
	Mounts            []DiskMountDetail    `json:"mounts,omitempty"`
	DiskIODevices     []DiskIODeviceDetail `json:"disk_io_devices,omitempty"`
	DiskReadBytesSec  float64              `json:"disk_read_bytes_sec"`
	DiskWriteBytesSec float64              `json:"disk_write_bytes_sec"`
	DiskReadOpsSec    float64              `json:"disk_read_ops_sec,omitempty"`
	DiskWriteOpsSec   float64              `json:"disk_write_ops_sec,omitempty"`
	DiskIOPS          float64              `json:"disk_iops,omitempty"`
	DiskLatencyMS     float64              `json:"disk_latency_ms,omitempty"`

	// Network
	NetworkRXBytesSec   float64                  `json:"network_rx"` // rate bytes/sec
	NetworkTXBytesSec   float64                  `json:"network_tx"` // rate bytes/sec
	NetworkRXPacketsSec float64                  `json:"network_rx_packets,omitempty"`
	NetworkTXPacketsSec float64                  `json:"network_tx_packets,omitempty"`
	NetworkRXErrorsSec  float64                  `json:"network_rx_errors,omitempty"`
	NetworkTXErrorsSec  float64                  `json:"network_tx_errors,omitempty"`
	NetworkRXDropsSec   float64                  `json:"network_rx_drops,omitempty"`
	NetworkTXDropsSec   float64                  `json:"network_tx_drops,omitempty"`
	TotalRXBytes        uint64                   `json:"total_rx_bytes,omitempty"`
	TotalTXBytes        uint64                   `json:"total_tx_bytes,omitempty"`
	Interfaces          []NetworkInterfaceDetail `json:"interfaces,omitempty"`

	// Load & System
	Load   LoadDetail `json:"load"`
	Load1  float64    `json:"load1"`
	Load5  float64    `json:"load5"`
	Load15 float64    `json:"load15"`

	// Temperature
	Temperature    *float64              `json:"temperature,omitempty"`
	ThermalSensors []ThermalSensorDetail `json:"thermal_sensors,omitempty"`

	// Processes & TCP
	Processes    ProcessStateBreakdown `json:"processes"`
	TopProcesses []ProcessItem         `json:"top_processes,omitempty"`
	TCP          TCPStateBreakdown     `json:"tcp"`
	Services     []ServiceStatus       `json:"services,omitempty"`

	// Docker
	Docker DockerReport `json:"docker"`

	// Logs
	Logs []NodeLogEntry `json:"logs,omitempty"`

	// Uptime & Boot time
	UptimeSeconds int64 `json:"uptime_seconds"`
	BootTime      int64 `json:"boot_time,omitempty"`
}

// SystemInfo is sent on register or heartbeat update.
type SystemInfo struct {
	Hostname        string   `json:"hostname"`
	OperatingSystem string   `json:"operating_system"`
	Distribution    string   `json:"distribution"`
	Kernel          string   `json:"kernel"`
	Architecture    string   `json:"architecture"`
	AgentVersion    string   `json:"agent_version"`
	UptimeSeconds   int64    `json:"uptime_seconds"`
	BootTime        int64    `json:"boot_time,omitempty"`
	CPUModel        string   `json:"cpu_model,omitempty"`
	CPUCount        int      `json:"cpu_count"`
	CPUThreads      int      `json:"cpu_threads,omitempty"`
	CPUFreqMHz      float64  `json:"cpu_freq_mhz,omitempty"`
	RAMTotalBytes   uint64   `json:"ram_total_bytes,omitempty"`
	SwapTotalBytes  uint64   `json:"swap_total_bytes,omitempty"`
	PublicIP        string   `json:"public_ip,omitempty"`
	PrivateIP       string   `json:"private_ip,omitempty"`
	IPAddresses     []string `json:"ip_addresses"`
	Timezone        string   `json:"timezone"`
}

// NodeStats holds the snapshot of essential metrics for rapid list rendering.
type NodeStats struct {
	CPU                float64  `json:"cpu"`
	Memory             float64  `json:"memory"`
	Disk               float64  `json:"disk"`
	Load1              float64  `json:"load1"`
	NetworkRXBytesSec  float64  `json:"network_rx"`
	NetworkTXBytesSec  float64  `json:"network_tx"`
	Temperature        *float64 `json:"temperature,omitempty"`
	UptimeSeconds      int64    `json:"uptime_seconds"`
	Timestamp          int64    `json:"timestamp"`
	IsThermalAvailable bool     `json:"is_thermal_available"`
	IsLoadAvailable    bool     `json:"is_load_available"`
}

// DashboardSummary represents the high level aggregated dashboard statistics.
type DashboardSummary struct {
	TotalNodes     int            `json:"total_nodes"`
	OnlineNodes    int            `json:"online_nodes"`
	OfflineNodes   int            `json:"offline_nodes"`
	WarningNodes   int            `json:"warning_nodes"`
	StaleNodes     int            `json:"stale_nodes"`
	DisabledNodes  int            `json:"disabled_nodes"`
	AvgCPU         float64        `json:"avg_cpu"`
	AvgMemory      float64        `json:"avg_memory"`
	AvgDisk        float64        `json:"avg_disk"`
	TotalNetworkRX float64        `json:"total_network_rx"`
	TotalNetworkTX float64        `json:"total_network_tx"`
	ActiveAlerts   int            `json:"active_alerts"`
	RecentAlerts   []Alert        `json:"recent_alerts"`
	RecentActivity []AuditLog     `json:"recent_activity"`
}

// RetentionConfig stores metric retention thresholds.
type RetentionConfig struct {
	RawDays        int `json:"raw_days"`
	HourlyDays     int `json:"hourly_days"`
	DailyDays      int `json:"daily_days"`
	OfflineSeconds int `json:"offline_seconds"`
}
