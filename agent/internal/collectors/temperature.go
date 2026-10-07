package collectors

import (
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type TemperatureCollector struct{}

func NewTemperatureCollector() *TemperatureCollector {
	return &TemperatureCollector{}
}

func (t *TemperatureCollector) Name() string {
	return "temperature"
}

func (t *TemperatureCollector) Collect(p *Payload) (CollectorReport, error) {
	sensors := make([]ThermalSensorDetail, 0)
	var maxTemp float64
	var found bool

	// 1. Check /sys/class/thermal/thermal_zone*
	zones, err := filepath.Glob("/sys/class/thermal/thermal_zone*")
	if err == nil {
		for _, zone := range zones {
			tempFile := filepath.Join(zone, "temp")
			typeFile := filepath.Join(zone, "type")

			tempData, err := os.ReadFile(tempFile)
			if err != nil {
				continue
			}

			millidegrees, err := strconv.ParseFloat(strings.TrimSpace(string(tempData)), 64)
			if err != nil || millidegrees <= 0 {
				continue
			}

			celsius := math.Round((millidegrees/1000.0)*10) / 10
			if celsius < -20 || celsius > 130 {
				continue // ignore invalid/faulty sensor readings
			}

			name := filepath.Base(zone)
			if nameData, err := os.ReadFile(typeFile); err == nil {
				trimmedName := strings.TrimSpace(string(nameData))
				if trimmedName != "" {
					name = trimmedName
				}
			}

			status := "ok"
			if celsius >= 85 {
				status = "critical"
			} else if celsius >= 75 {
				status = "warning"
			}

			sensors = append(sensors, ThermalSensorDetail{
				Name:         name,
				TemperatureC: celsius,
				Status:       status,
			})

			if !found || celsius > maxTemp {
				maxTemp = celsius
				found = true
			}
		}
	}

	// 2. Check /sys/class/hwmon/hwmon*
	hwmons, err := filepath.Glob("/sys/class/hwmon/hwmon*")
	if err == nil {
		for _, hw := range hwmons {
			hwName := filepath.Base(hw)
			if nameData, err := os.ReadFile(filepath.Join(hw, "name")); err == nil {
				hwName = strings.TrimSpace(string(nameData))
			}

			tempInputs, _ := filepath.Glob(filepath.Join(hw, "temp*_input"))
			for _, inputPath := range tempInputs {
				data, err := os.ReadFile(inputPath)
				if err != nil {
					continue
				}

				milli, err := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
				if err != nil || milli <= 0 {
					continue
				}

				celsius := math.Round((milli/1000.0)*10) / 10
				if celsius < -20 || celsius > 130 {
					continue
				}

				sensorName := hwName + "_" + filepath.Base(inputPath)
				status := "ok"
				if celsius >= 85 {
					status = "critical"
				} else if celsius >= 75 {
					status = "warning"
				}

				sensors = append(sensors, ThermalSensorDetail{
					Name:         sensorName,
					TemperatureC: celsius,
					Status:       status,
				})

				if !found || celsius > maxTemp {
					maxTemp = celsius
					found = true
				}
			}
		}
	}

	p.ThermalSensors = sensors
	if found {
		p.Temperature = &maxTemp
		return CollectorReport{Status: "ok"}, nil
	}

	p.Temperature = nil
	return CollectorReport{
		Status:  "unavailable",
		Message: "No hardware thermal sensors found in /sys/class/thermal or hwmon (typical for virtual machines and cloud instances)",
	}, nil
}
