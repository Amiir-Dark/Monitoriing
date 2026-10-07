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

const AgentVersion = "1.0.0"

type SystemInfo struct {
	Hostname        string   `json:"hostname"`
	OperatingSystem string   `json:"operating_system"`
	Distribution    string   `json:"distribution"`
	Kernel          string   `json:"kernel"`
	Architecture    string   `json:"architecture"`
	AgentVersion    string   `json:"agent_version"`
	UptimeSeconds   int64    `json:"uptime_seconds"`
	CPUCount        int      `json:"cpu_count"`
	IPAddresses     []string `json:"ip_addresses"`
	Timezone        string   `json:"timezone"`
}

func CollectSystemInfo() *SystemInfo {
	hostname, _ := os.Hostname()
	tz, _ := time.Now().Zone()

	info := &SystemInfo{
		Hostname:        hostname,
		OperatingSystem: runtime.GOOS,
		Distribution:    detectDistro(),
		Kernel:          detectKernel(),
		Architecture:    runtime.GOARCH,
		AgentVersion:    AgentVersion,
		UptimeSeconds:   detectUptime(),
		CPUCount:        runtime.NumCPU(),
		IPAddresses:     detectIPs(),
		Timezone:        tz,
	}

	return info
}

func detectDistro() string {
	// Check /etc/os-release on Linux
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

func detectIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}

	for _, i := range ifaces {
		// skip down, loopback or docker interfaces
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
