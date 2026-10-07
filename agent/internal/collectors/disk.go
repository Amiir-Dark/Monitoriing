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

type deviceSample struct {
	readBytes  uint64
	writeBytes uint64
	readOps    uint64
	writeOps   uint64
	ioTimeMS   int64
}

type DiskCollector struct {
	mu           sync.Mutex
	lastSample   map[string]deviceSample
	lastSampleAt time.Time
}

func NewDiskCollector() *DiskCollector {
	return &DiskCollector{
		lastSample: make(map[string]deviceSample),
	}
}

func (d *DiskCollector) Name() string {
	return "disk"
}

func (d *DiskCollector) Collect(p *Payload) (CollectorReport, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now()
	var elapsedSec float64
	if !d.lastSampleAt.IsZero() {
		elapsedSec = now.Sub(d.lastSampleAt).Seconds()
	}

	// 1. Filesystem mounts from /proc/mounts
	mounts := parseMounts()
	p.Mounts = mounts

	// Find root filesystem '/'
	var rootFound bool
	for _, m := range mounts {
		if m.MountPoint == "/" {
			p.Disk = m.Percent
			p.DiskTotalBytes = m.TotalBytes
			p.DiskUsedBytes = m.UsedBytes
			rootFound = true
			break
		}
	}
	if !rootFound && len(mounts) > 0 {
		p.Disk = mounts[0].Percent
		p.DiskTotalBytes = mounts[0].TotalBytes
		p.DiskUsedBytes = mounts[0].UsedBytes
	}

	// 2. Disk I/O from /proc/diskstats
	f, err := os.Open("/proc/diskstats")
	if err != nil {
		if len(mounts) > 0 {
			return CollectorReport{Status: "ok", Message: "Mounts collected; /proc/diskstats unavailable: " + err.Error()}, nil
		}
		return CollectorReport{Status: "unavailable", Message: "Cannot read /proc/mounts or /proc/diskstats: " + err.Error()}, nil
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	currentSamples := make(map[string]deviceSample)
	deviceDetails := make([]DiskIODeviceDetail, 0)

	var totalReadBytesSec, totalWriteBytesSec, totalReadOpsSec, totalWriteOpsSec float64
	var sumLatencyMS float64
	var latencyDevicesCount int

	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 14 {
			continue
		}

		devName := fields[2]
		// Skip loop, ram, and dm devices
		if strings.HasPrefix(devName, "loop") || strings.HasPrefix(devName, "ram") || strings.HasPrefix(devName, "dm-") {
			continue
		}

		// Field 3: reads completed
		reads, _ := strconv.ParseUint(fields[3], 10, 64)
		// Field 5: sectors read (512 bytes per sector)
		sectorsRead, _ := strconv.ParseUint(fields[5], 10, 64)
		// Field 7: writes completed
		writes, _ := strconv.ParseUint(fields[7], 10, 64)
		// Field 9: sectors written (512 bytes per sector)
		sectorsWritten, _ := strconv.ParseUint(fields[9], 10, 64)
		// Field 12: time spent doing I/Os (ms)
		ioTimeMS, _ := strconv.ParseInt(fields[12], 10, 64)

		curSample := deviceSample{
			readBytes:  sectorsRead * 512,
			writeBytes: sectorsWritten * 512,
			readOps:    reads,
			writeOps:   writes,
			ioTimeMS:   ioTimeMS,
		}
		currentSamples[devName] = curSample

		devDetail := DiskIODeviceDetail{
			DeviceName:      devName,
			TotalReadBytes:  curSample.readBytes,
			TotalWriteBytes: curSample.writeBytes,
			IOTimeMS:        ioTimeMS,
		}

		// Rate and IOPS calculation
		if prev, ok := d.lastSample[devName]; ok && elapsedSec > 0.05 {
			if curSample.readBytes >= prev.readBytes {
				devDetail.ReadBytesSec = math.Round((float64(curSample.readBytes-prev.readBytes)/elapsedSec)*10) / 10
			}
			if curSample.writeBytes >= prev.writeBytes {
				devDetail.WriteBytesSec = math.Round((float64(curSample.writeBytes-prev.writeBytes)/elapsedSec)*10) / 10
			}
			var deltaReadOps, deltaWriteOps uint64
			if curSample.readOps >= prev.readOps {
				deltaReadOps = curSample.readOps - prev.readOps
				devDetail.ReadOpsSec = math.Round((float64(deltaReadOps)/elapsedSec)*10) / 10
			}
			if curSample.writeOps >= prev.writeOps {
				deltaWriteOps = curSample.writeOps - prev.writeOps
				devDetail.WriteOpsSec = math.Round((float64(deltaWriteOps)/elapsedSec)*10) / 10
			}

			devDetail.IOPS = math.Round((devDetail.ReadOpsSec+devDetail.WriteOpsSec)*10) / 10

			// Latency calculation: deltaIOTimeMS / deltaOps
			deltaOps := deltaReadOps + deltaWriteOps
			if deltaOps > 0 && curSample.ioTimeMS >= prev.ioTimeMS {
				deltaIOTime := curSample.ioTimeMS - prev.ioTimeMS
				latency := float64(deltaIOTime) / float64(deltaOps)
				devDetail.LatencyMS = math.Round(latency*100) / 100
				sumLatencyMS += devDetail.LatencyMS
				latencyDevicesCount++
			}
		}

		deviceDetails = append(deviceDetails, devDetail)
		totalReadBytesSec += devDetail.ReadBytesSec
		totalWriteBytesSec += devDetail.WriteBytesSec
		totalReadOpsSec += devDetail.ReadOpsSec
		totalWriteOpsSec += devDetail.WriteOpsSec
	}

	d.lastSample = currentSamples
	d.lastSampleAt = now

	p.DiskIODevices = deviceDetails
	p.DiskReadBytesSec = totalReadBytesSec
	p.DiskWriteBytesSec = totalWriteBytesSec
	p.DiskReadOpsSec = totalReadOpsSec
	p.DiskWriteOpsSec = totalWriteOpsSec
	p.DiskIOPS = totalReadOpsSec + totalWriteOpsSec
	if latencyDevicesCount > 0 {
		p.DiskLatencyMS = math.Round((sumLatencyMS/float64(latencyDevicesCount))*100) / 100
	}

	return CollectorReport{Status: "ok"}, nil
}

func parseMounts() []DiskMountDetail {
	mounts := make([]DiskMountDetail, 0)
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return mounts
	}
	defer f.Close()

	// Virtual and pseudo filesystems to ignore (allow tmpfs if mounted on /tmp)
	ignoredTypes := map[string]bool{
		"proc": true, "sysfs": true, "devpts": true,
		"cgroup": true, "cgroup2": true, "securityfs": true,
		"pstore": true, "bpf": true, "autofs": true, "mqueue": true,
		"hugetlbfs": true, "debugfs": true, "tracefs": true,
		"configfs": true, "fusectl": true, "binfmt_misc": true,
		"devtmpfs": true, "overlay": false,
	}

	seenMounts := make(map[string]bool)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		device := fields[0]
		mountPoint := fields[1]
		fsType := fields[2]

		// Skip kernel pseudo FS, but allow /tmp even if tmpfs
		if fsType == "tmpfs" && mountPoint != "/tmp" {
			continue
		}
		if ignoredTypes[fsType] || seenMounts[mountPoint] {
			continue
		}
		// Skip read-only snaps
		if strings.HasPrefix(mountPoint, "/snap") {
			continue
		}

		total, used, avail, inodesTot, inodesUsed, inodesFree, err := getMountUsage(mountPoint)
		if err != nil || total == 0 {
			continue
		}

		pct := (float64(used) / float64(total)) * 100.0
		var inodesPct float64
		if inodesTot > 0 {
			inodesPct = (float64(inodesUsed) / float64(inodesTot)) * 100.0
		}

		seenMounts[mountPoint] = true
		mounts = append(mounts, DiskMountDetail{
			MountPoint:    mountPoint,
			Device:        device,
			FSType:        fsType,
			TotalBytes:    total,
			UsedBytes:     used,
			AvailBytes:    avail,
			Percent:       math.Round(pct*10) / 10,
			InodesTotal:   inodesTot,
			InodesUsed:    inodesUsed,
			InodesFree:    inodesFree,
			InodesPercent: math.Round(inodesPct*10) / 10,
		})
	}

	return mounts
}
