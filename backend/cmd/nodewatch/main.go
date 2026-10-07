package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"nodewatch/backend/internal/alerts"
	"nodewatch/backend/internal/api"
	"nodewatch/backend/internal/auth"
	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/metrics"
	"nodewatch/backend/internal/nodes"
	"nodewatch/backend/internal/telegram"
	"nodewatch/backend/internal/websocket"
)

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func main() {
	// Check for CLI backup command: `nodewatch backup [dest]`
	if len(os.Args) > 1 && os.Args[1] == "backup" {
		dbPath := getEnv("NODEWATCH_DATABASE", "./data/nodewatch.db")
		dest := fmt.Sprintf("./data/backups/backup_%s.db", time.Now().Format("20060102_150405"))
		if len(os.Args) > 2 {
			dest = os.Args[2]
		}

		db, err := database.Open(dbPath)
		if err != nil {
			log.Fatalf("Failed to open database: %v", err)
		}
		defer db.Close()

		if err := db.Backup(dest); err != nil {
			log.Fatalf("Backup failed: %v", err)
		}
		fmt.Printf("Database successfully backed up to: %s\n", dest)
		return
	}

	// Check for CLI create-node command: `nodewatch create-node [name] [-db path]`
	if len(os.Args) > 1 && os.Args[1] == "create-node" {
		dbPath := "./data/nodewatch.db"
		nodeName := "Master Server (Local)"
		for i := 2; i < len(os.Args); i++ {
			if os.Args[i] == "-db" && i+1 < len(os.Args) {
				dbPath = os.Args[i+1]
				i++
			} else if !strings.HasPrefix(os.Args[i], "-") {
				nodeName = os.Args[i]
			}
		}

		db, err := database.Open(dbPath)
		if err != nil {
			log.Fatalf("Failed to open database: %v", err)
		}
		defer db.Close()

		nodesRepo := nodes.NewRepository(db)
		// Check if node with this name already exists
		existingNodes, err := nodesRepo.ListNodes("", "", "", "")
		if err == nil {
			for _, n := range existingNodes {
				if n.Name == nodeName {
					// Rotate or reuse token
					tok, regErr := nodesRepo.RotateToken(n.ID)
					if regErr == nil {
						fmt.Printf("NODE_ID=%s\nNODE_TOKEN=%s\n", n.ID, tok)
						return
					}
				}
			}
		}

		node, token, err := nodesRepo.CreateNode(nodeName, nil, []string{"master", "local"})
		if err != nil {
			log.Fatalf("Failed to create node: %v", err)
		}
		fmt.Printf("NODE_ID=%s\nNODE_TOKEN=%s\n", node.ID, token)
		return
	}

	// Server CLI flags and env fallbacks
	portFlag := flag.String("port", getEnv("NODEWATCH_PORT", "8765"), "HTTP server port")
	dbFlag := flag.String("db", getEnv("NODEWATCH_DATABASE", "./data/nodewatch.db"), "Path to SQLite database")
	secretFlag := flag.String("secret", getEnv("NODEWATCH_SECRET", "nodewatch-super-secret-key-32bytes!"), "JWT auth secret key")
	serverURLFlag := flag.String("url", getEnv("NODEWATCH_SERVER_URL", "http://localhost:8765"), "Central server public URL")
	distFlag := flag.String("dist", getEnv("NODEWATCH_DIST_PATH", "../frontend/dist"), "Path to built frontend files")
	flag.Parse()

	log.Printf("[NODEWATCH] Starting NodeWatch Central Server...")

	// 1. Initialize SQLite Database
	db, err := database.Open(*dbFlag)
	if err != nil {
		log.Fatalf("[NODEWATCH] Database initialization error: %v", err)
	}
	defer db.Close()
	log.Printf("[NODEWATCH] SQLite database opened with WAL mode at %s", *dbFlag)

	// 2. Initialize Core Subsystems
	authMgr := auth.NewAuthManager(*secretFlag)
	nodesRepo := nodes.NewRepository(db)
	metricsRepo := metrics.NewRepository(db)
	tgClient := telegram.NewClient(db)

	hub := websocket.NewHub()
	go hub.Run()

	alertEngine := alerts.NewEngine(db, hub, tgClient)

	// Context for graceful shutdown of background workers
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 3. Start Background Workers
	go alertEngine.StartOfflineChecker(ctx, nodesRepo)
	go metricsRepo.StartRetentionWorker(ctx)

	// Locate dist folder if relative
	distPath := *distFlag
	if _, err := os.Stat(distPath); os.IsNotExist(err) {
		// check ./dist or frontend/dist
		if _, err := os.Stat("frontend/dist"); err == nil {
			distPath = "frontend/dist"
		} else if _, err := os.Stat("./dist"); err == nil {
			distPath = "./dist"
		}
	}
	absDist, _ := filepath.Abs(distPath)
	log.Printf("[NODEWATCH] Serving static frontend from %s", absDist)

	// 4. Setup API Server & Router
	srv := api.NewServer(
		db,
		authMgr,
		nodesRepo,
		metricsRepo,
		alertEngine,
		hub,
		tgClient,
		*serverURLFlag,
		distPath,
	)

	httpServer := &http.Server{
		Addr:         ":" + *portFlag,
		Handler:      srv.Router(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 5. Run Server with Graceful Shutdown
	go func() {
		log.Printf("[NODEWATCH] Listening on http://0.0.0.0:%s", *portFlag)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[NODEWATCH] HTTP server error: %v", err)
		}
	}()

	// Wait for terminate signals
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	log.Printf("[NODEWATCH] Shutting down server gracefully...")
	cancel() // Stop background workers

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("[NODEWATCH] Server forced to shutdown: %v", err)
	}

	log.Printf("[NODEWATCH] Server exited cleanly.")
}
