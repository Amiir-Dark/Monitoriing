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
	rxErrors  uint64
	txErrors  uint64
	rxDrops   uint64
	txDrops   uint64
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
	var totalRXPacketsRate, totalTXPacketsRate float64
	var totalRXErrorsRate, totalTXErrorsRate float64
	var totalRXDropsRate, totalTXDropsRate float64
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
			rxErrors:  rxErrs,
			txErrors:  txErrs,
			rxDrops:   rxDrops,
			txDrops:   txDrops,
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
			if curSample.rxErrors >= prev.rxErrors {
				ifaceDetail.RXErrorsSec = math.Round((float64(curSample.rxErrors-prev.rxErrors)/elapsedSec)*10) / 10
			}
			if curSample.txErrors >= prev.txErrors {
				ifaceDetail.TXErrorsSec = math.Round((float64(curSample.txErrors-prev.txErrors)/elapsedSec)*10) / 10
			}
			if curSample.rxDrops >= prev.rxDrops {
				ifaceDetail.RXDropsSec = math.Round((float64(curSample.rxDrops-prev.rxDrops)/elapsedSec)*10) / 10
			}
			if curSample.txDrops >= prev.txDrops {
				ifaceDetail.TXDropsSec = math.Round((float64(curSample.txDrops-prev.txDrops)/elapsedSec)*10) / 10
			}

			// Packet loss estimate based on drops/errors vs total packets
			totalPkt := ifaceDetail.RXPacketsSec + ifaceDetail.TXPacketsSec
			lossPkt := ifaceDetail.RXDropsSec + ifaceDetail.TXDropsSec + ifaceDetail.RXErrorsSec + ifaceDetail.TXErrorsSec
			if totalPkt+lossPkt > 0 {
				lossPct := (lossPkt / (totalPkt + lossPkt)) * 100.0
				ifaceDetail.PacketLossPct = math.Round(lossPct*100) / 100
			}
		}

		interfaces = append(interfaces, ifaceDetail)

		// Don't count loopback towards global node network throughput
		if ifName != "lo" {
			totalRXRate += ifaceDetail.RXBytesSec
			totalTXRate += ifaceDetail.TXBytesSec
			totalRXPacketsRate += ifaceDetail.RXPacketsSec
			totalTXPacketsRate += ifaceDetail.TXPacketsSec
			totalRXErrorsRate += ifaceDetail.RXErrorsSec
			totalTXErrorsRate += ifaceDetail.TXErrorsSec
			totalRXDropsRate += ifaceDetail.RXDropsSec
			totalTXDropsRate += ifaceDetail.TXDropsSec
			totalRXBytes += rxBytes
			totalTXBytes += txBytes
		}
	}

	n.lastSample = currentSamples
	n.lastSampleAt = now

	p.Interfaces = interfaces
	p.NetworkRXBytesSec = totalRXRate
	p.NetworkTXBytesSec = totalTXRate
	p.NetworkRXPacketsSec = totalRXPacketsRate
	p.NetworkTXPacketsSec = totalTXPacketsRate
	p.NetworkRXErrorsSec = totalRXErrorsRate
	p.NetworkTXErrorsSec = totalTXErrorsRate
	p.NetworkRXDropsSec = totalRXDropsRate
	p.NetworkTXDropsSec = totalTXDropsRate
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
