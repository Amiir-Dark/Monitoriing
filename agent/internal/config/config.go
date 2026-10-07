package config

import (
	"encoding/json"
	"flag"
	"os"
	"strconv"
	"time"
)

type Config struct {
	ServerURL    string        `json:"server_url"`
	NodeToken    string        `json:"node_token"`
	IntervalSec  int           `json:"interval"`
	Services     []string      `json:"services"`     // custom services to monitor
	MountPoints  []string      `json:"mount_points"` // mount points to monitor
	LogLevel     string        `json:"log_level"`
	Interval     time.Duration `json:"-"`
}

func DefaultConfig() *Config {
	return &Config{
		ServerURL:   "http://localhost:8080",
		NodeToken:   "",
		IntervalSec: 5,
		Services:    []string{"nginx", "docker", "xray", "marzban", "mysql", "postgresql", "redis"},
		MountPoints: []string{"/"},
		LogLevel:    "INFO",
		Interval:    5 * time.Second,
	}
}

// LoadConfig merges defaults, configuration file, environment variables, and CLI flags.
func LoadConfig() (*Config, error) {
	cfg := DefaultConfig()

	configPath := flag.String("config", "", "Path to configuration file")
	serverURL := flag.String("url", "", "NodeWatch central server URL")
	nodeToken := flag.String("token", "", "Node authentication token")
	interval := flag.Int("interval", 0, "Collection interval in seconds (5, 10, 30, 60)")
	flag.Parse()

	// 1. Load from file if specified or if default file exists
	fileToLoad := *configPath
	if fileToLoad == "" {
		if _, err := os.Stat("/etc/nodewatch/agent.json"); err == nil {
			fileToLoad = "/etc/nodewatch/agent.json"
		} else if _, err := os.Stat("agent.json"); err == nil {
			fileToLoad = "agent.json"
		}
	}

	if fileToLoad != "" {
		if data, err := os.ReadFile(fileToLoad); err == nil {
			_ = json.Unmarshal(data, cfg)
		}
	}

	// 2. Override with Environment Variables
	if envURL := os.Getenv("NODEWATCH_SERVER_URL"); envURL != "" {
		cfg.ServerURL = envURL
	}
	if envToken := os.Getenv("NODEWATCH_TOKEN"); envToken != "" {
		cfg.NodeToken = envToken
	}
	if envInterval := os.Getenv("NODEWATCH_INTERVAL"); envInterval != "" {
		if val, err := strconv.Atoi(envInterval); err == nil && val > 0 {
			cfg.IntervalSec = val
		}
	}

	// 3. Override with CLI flags
	if *serverURL != "" {
		cfg.ServerURL = *serverURL
	}
	if *nodeToken != "" {
		cfg.NodeToken = *nodeToken
	}
	if *interval > 0 {
		cfg.IntervalSec = *interval
	}

	// Sanitize interval
	if cfg.IntervalSec < 1 {
		cfg.IntervalSec = 5
	}
	cfg.Interval = time.Duration(cfg.IntervalSec) * time.Second

	return cfg, nil
}
