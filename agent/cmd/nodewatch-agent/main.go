package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nodewatch/agent/internal/client"
	"nodewatch/agent/internal/collectors"
	"nodewatch/agent/internal/config"
	"nodewatch/agent/internal/system"
)

func main() {
	log.Println("[INFO] NodeWatch Agent initializing...")

	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("[ERROR] Failed to load configuration: %v", err)
	}

	if cfg.NodeToken == "" {
		log.Println("[WARN] Node authentication token is not set. Run with -token <TOKEN> or set NODEWATCH_TOKEN.")
	}

	sysInfo := system.CollectSystemInfo()
	log.Printf("[INFO] Host: %s (%s %s) | Agent version: %s | Server: %s",
		sysInfo.Hostname, sysInfo.OperatingSystem, sysInfo.Architecture, sysInfo.AgentVersion, cfg.ServerURL)

	httpClient := client.NewClient(cfg.ServerURL, cfg.NodeToken)
	collectorMgr := collectors.NewManager()

	// Initial register
	if cfg.NodeToken != "" {
		if err := httpClient.Register(sysInfo); err != nil {
			log.Printf("[WARN] Initial node registration deferred: %v", err)
		} else {
			log.Println("[INFO] Successfully registered with NodeWatch central server.")
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	log.Printf("[INFO] Agent monitoring loop started (interval: %v)", cfg.Interval)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if cfg.NodeToken == "" {
					continue
				}

				payload := collectorMgr.CollectAll(cfg.Services)
				if err := httpClient.SendMetrics(payload); err != nil {
					// Client handles logging backoff
					continue
				}
			}
		}
	}()

	<-quit
	log.Println("[INFO] NodeWatch Agent stopping gracefully...")
	cancel()
	time.Sleep(500 * time.Millisecond)
	log.Println("[INFO] Agent stopped cleanly.")
}
