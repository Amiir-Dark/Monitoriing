//go:build linux

package collectors

import (
	"syscall"
)

func getMountUsage(mountPath string) (totalBytes, usedBytes, availBytes, inodesTotal, inodesUsed, inodesFree uint64, err error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(mountPath, &stat); err != nil {
		return 0, 0, 0, 0, 0, 0, err
	}
	bsize := uint64(stat.Bsize)
	totalBytes = stat.Blocks * bsize
	availBytes = stat.Bavail * bsize
	freeBytes := stat.Bfree * bsize
	if totalBytes >= freeBytes {
		usedBytes = totalBytes - freeBytes
	}
	inodesTotal = stat.Files
	inodesFree = stat.Ffree
	if inodesTotal >= inodesFree {
		inodesUsed = inodesTotal - inodesFree
	}
	return
}
