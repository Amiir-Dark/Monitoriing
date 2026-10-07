package collectors

import (
	"bufio"
	"math"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ifaceSample struct {
	rxBytes   uint64
	txBytes   uint64
	rxPackets uint64
	txPackets uint64
}

type NetworkCollector struct {
	mu           sync.Mutex
	lastSample   map[string]ifaceSample
	lastSampleAt time.Time
}

func NewNetworkCollector() *NetworkCollector {
	return &NetworkCollector{
		lastSample: make(map[string]ifaceSample),
	}
}

func (n *NetworkCollector) Name() string {
	return "network"
}

func (n *NetworkCollector) Collect(p *Payload) (CollectorReport, error) {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return CollectorReport{
			Status:  "unavailable",
			Message: "Cannot read /proc/net/dev: " + err.Error(),
		}, nil
	}
	defer f.Close()

	n.mu.Lock()
	defer n.mu.Unlock()

	now := time.Now()
	var elapsedSec float64
	if !n.lastSampleAt.IsZero() {
		elapsedSec = now.Sub(n.lastSampleAt).Seconds()
	}

	interfaceIPMap := getInterfaceIPs()

	scanner := bufio.NewScanner(f)
	currentSamples := make(map[string]ifaceSample)
	interfaces := make([]NetworkInterfaceDetail, 0)

	var totalRXRate, totalTXRate float64
	var totalRXBytes, totalTXBytes uint64

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.Contains(line, ":") {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		ifName := strings.TrimSpace(parts[0])

		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}

		rxBytes, _ := strconv.ParseUint(fields[0], 10, 64)
		rxPackets, _ := strconv.ParseUint(fields[1], 10, 64)
		rxErrs, _ := strconv.ParseUint(fields[2], 10, 64)
		rxDrops, _ := strconv.ParseUint(fields[3], 10, 64)

		txBytes, _ := strconv.ParseUint(fields[8], 10, 64)
		txPackets, _ := strconv.ParseUint(fields[9], 10, 64)
		txErrs, _ := strconv.ParseUint(fields[10], 10, 64)
		txDrops, _ := strconv.ParseUint(fields[11], 10, 64)

		curSample := ifaceSample{
			rxBytes:   rxBytes,
			txBytes:   txBytes,
			rxPackets: rxPackets,
			txPackets: txPackets,
		}
		currentSamples[ifName] = curSample

		mac := readSysFile("/sys/class/net/" + ifName + "/address")
		operstate := readSysFile("/sys/class/net/" + ifName + "/operstate")
		if operstate == "" {
			operstate = "unknown"
		}
		speedMbps := 0
		if spdStr := readSysFile("/sys/class/net/" + ifName + "/speed"); spdStr != "" {
			if s, err := strconv.Atoi(spdStr); err == nil && s > 0 {
				speedMbps = s
			}
		}

		ifaceDetail := NetworkInterfaceDetail{
			Name:           ifName,
			MAC:            mac,
			IPAddresses:    interfaceIPMap[ifName],
			Status:         operstate,
			SpeedMbps:      speedMbps,
			TotalRXBytes:   rxBytes,
			TotalTXBytes:   txBytes,
			TotalRXPackets: rxPackets,
			TotalTXPackets: txPackets,
			TotalRXErrors:  rxErrs,
			TotalTXErrors:  txErrs,
			TotalRXDrops:   rxDrops,
			TotalTXDrops:   txDrops,
		}

		// Rate calculation with Counter Reset Protection
		if prev, ok := n.lastSample[ifName]; ok && elapsedSec > 0.05 {
			// Counter reset detection (interface down/up, reload, or wrap)
			if curSample.rxBytes >= prev.rxBytes {
				ifaceDetail.RXBytesSec = math.Round((float64(curSample.rxBytes-prev.rxBytes)/elapsedSec)*10) / 10
			}
			if curSample.txBytes >= prev.txBytes {
				ifaceDetail.TXBytesSec = math.Round((float64(curSample.txBytes-prev.txBytes)/elapsedSec)*10) / 10
			}
			if curSample.rxPackets >= prev.rxPackets {
				ifaceDetail.RXPacketsSec = math.Round((float64(curSample.rxPackets-prev.rxPackets)/elapsedSec)*10) / 10
			}
			if curSample.txPackets >= prev.txPackets {
				ifaceDetail.TXPacketsSec = math.Round((float64(curSample.txPackets-prev.txPackets)/elapsedSec)*10) / 10
			}
		}

		interfaces = append(interfaces, ifaceDetail)

		// Don't count loopback towards node network throughput
		if ifName != "lo" {
			totalRXRate += ifaceDetail.RXBytesSec
			totalTXRate += ifaceDetail.TXBytesSec
			totalRXBytes += rxBytes
			totalTXBytes += txBytes
		}
	}

	n.lastSample = currentSamples
	n.lastSampleAt = now

	p.Interfaces = interfaces
	p.NetworkRXBytesSec = totalRXRate
	p.NetworkTXBytesSec = totalTXRate
	p.TotalRXBytes = totalRXBytes
	p.TotalTXBytes = totalTXBytes

	return CollectorReport{Status: "ok"}, nil
}

func readSysFile(path string) string {
	if data, err := os.ReadFile(path); err == nil {
		return strings.TrimSpace(string(data))
	}
	return ""
}

func getInterfaceIPs() map[string][]string {
	res := make(map[string][]string)
	ifaces, err := net.Interfaces()
	if err != nil {
		return res
	}
	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		var ips []string
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip != nil && !ip.IsLoopback() {
				ips = append(ips, ip.String())
			}
		}
		if len(ips) > 0 {
			res[iface.Name] = ips
		}
	}
	return res
}
