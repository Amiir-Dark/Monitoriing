package system

import (
	"bufio"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const AgentVersion = "2.0.0"

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

func CollectSystemInfo() *SystemInfo {
	hostname, _ := os.Hostname()
	tz, _ := time.Now().Zone()
	uptime := detectUptime()
	bootTime := time.Now().Unix() - uptime
	ips := detectIPs()

	var privateIP string
	if len(ips) > 0 {
		privateIP = ips[0]
	}

	ramTotal, swapTotal := detectMemoryTotals()

	info := &SystemInfo{
		Hostname:        hostname,
		OperatingSystem: runtime.GOOS,
		Distribution:    detectDistro(),
		Kernel:          detectKernel(),
		Architecture:    runtime.GOARCH,
		AgentVersion:    AgentVersion,
		UptimeSeconds:   uptime,
		BootTime:        bootTime,
		CPUModel:        detectCPUModel(),
		CPUCount:        detectCPUCores(),
		CPUThreads:      runtime.NumCPU(),
		CPUFreqMHz:      detectCPUFreq(),
		RAMTotalBytes:   ramTotal,
		SwapTotalBytes:  swapTotal,
		PrivateIP:       privateIP,
		IPAddresses:     ips,
		Timezone:        tz,
	}

	return info
}

func detectDistro() string {
	if f, err := os.Open("/etc/os-release"); err == nil {
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				val := strings.TrimPrefix(line, "PRETTY_NAME=")
				return strings.Trim(val, "\"")
			}
		}
	}
	return runtime.GOOS
}

func detectKernel() string {
	if data, err := os.ReadFile("/proc/version"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) >= 3 {
			return fields[2]
		}
	}
	return runtime.GOOS + "/" + runtime.GOARCH
}

func detectUptime() int64 {
	if data, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			if up, err := strconv.ParseFloat(fields[0], 64); err == nil {
				return int64(up)
			}
		}
	}
	return 0
}

func detectCPUModel() string {
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

func detectCPUCores() int {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return runtime.NumCPU()
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	coreIDs := make(map[string]bool)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "core id") {
			parts := strings.Split(line, ":")
			if len(parts) == 2 {
				coreIDs[strings.TrimSpace(parts[1])] = true
			}
		}
	}
	if len(coreIDs) > 0 {
		return len(coreIDs)
	}
	return runtime.NumCPU()
}

func detectCPUFreq() float64 {
	if data, err := os.ReadFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq"); err == nil {
		if khz, err := strconv.ParseFloat(strings.TrimSpace(string(data)), 64); err == nil && khz > 0 {
			return khz / 1000.0
		}
	}
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
				if mhz, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
					return mhz
				}
			}
		}
	}
	return 0
}

func detectMemoryTotals() (uint64, uint64) {
	var ramTotal, swapTotal uint64
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()

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
		if kb, err := strconv.ParseUint(fields[0], 10, 64); err == nil {
			if key == "MemTotal" {
				ramTotal = kb * 1024
			} else if key == "SwapTotal" {
				swapTotal = kb * 1024
			}
		}
	}
	return ramTotal, swapTotal
}

func detectIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}

	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		if strings.HasPrefix(i.Name, "docker") || strings.HasPrefix(i.Name, "veth") || strings.HasPrefix(i.Name, "br-") {
			continue
		}

		addrs, err := i.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip != nil && !ip.IsLoopback() && ip.To4() != nil {
				ips = append(ips, ip.String())
			}
		}
	}

	return ips
}
