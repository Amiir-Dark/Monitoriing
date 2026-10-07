//go:build !linux

package collectors

import "errors"

func getMountUsage(mountPath string) (totalBytes, usedBytes, availBytes, inodesTotal, inodesUsed, inodesFree uint64, err error) {
	return 0, 0, 0, 0, 0, 0, errors.New("statfs unavailable on non-linux OS")
}
