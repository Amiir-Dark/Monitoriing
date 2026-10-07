package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"nodewatch/backend/internal/alerts"
	"nodewatch/backend/internal/auth"
	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/metrics"
	"nodewatch/backend/internal/models"
	"nodewatch/backend/internal/nodes"
	"nodewatch/backend/internal/telegram"
	"nodewatch/backend/internal/websocket"
)

type Server struct {
	db          *database.DB
	authMgr     *auth.AuthManager
	nodesRepo   *nodes.Repository
	metricsRepo *metrics.Repository
	alertEngine *alerts.Engine
	hub         *websocket.Hub
	tgClient    *telegram.Client
	serverURL   string
	distPath    string
}

func NewServer(
	db *database.DB,
	authMgr *auth.AuthManager,
	nodesRepo *nodes.Repository,
	metricsRepo *metrics.Repository,
	alertEngine *alerts.Engine,
	hub *websocket.Hub,
	tgClient *telegram.Client,
	serverURL string,
	distPath string,
) *Server {
	return &Server{
		db:          db,
		authMgr:     authMgr,
		nodesRepo:   nodesRepo,
		metricsRepo: metricsRepo,
		alertEngine: alertEngine,
		hub:         hub,
		tgClient:    tgClient,
		serverURL:   serverURL,
		distPath:    distPath,
	}
}

// Router configures all HTTP routes.
func (s *Server) Router() http.Handler {
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /ready", s.handleReady)

	// Agent installer script & binary downloads
	mux.HandleFunc("GET /install.sh", s.handleInstallScript)
	mux.HandleFunc("GET /downloads/{file}", s.handleDownloadFile)
	mux.HandleFunc("GET /api/agent/download", s.handleDownloadAgent)

	// Agent ingestion endpoints (Authenticated by node token)
	mux.HandleFunc("POST /api/agent/register", s.handleAgentRegister)
	mux.HandleFunc("POST /api/agent/heartbeat", s.handleAgentHeartbeat)
	mux.HandleFunc("POST /api/agent/metrics", s.handleAgentMetrics)
	mux.HandleFunc("POST /api/agent/status", s.handleAgentStatus)

	// Auth endpoints
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.authMiddleware(s.handleMe))

	// Real-time WebSocket
	mux.HandleFunc("GET /api/ws", func(w http.ResponseWriter, r *http.Request) {
		s.hub.HandleWS(s.authMgr, w, r)
	})

	// Protected Dashboard API endpoints
	mux.HandleFunc("GET /api/dashboard", s.authMiddleware(s.handleDashboardSummary))

	// Node Management
	mux.HandleFunc("GET /api/nodes", s.authMiddleware(s.handleListNodes))
	mux.HandleFunc("POST /api/nodes", s.authMiddleware(s.handleCreateNode))
	mux.HandleFunc("GET /api/nodes/{id}", s.authMiddleware(s.handleGetNode))
	mux.HandleFunc("PUT /api/nodes/{id}", s.authMiddleware(s.handleUpdateNode))
	mux.HandleFunc("DELETE /api/nodes/{id}", s.authMiddleware(s.handleDeleteNode))
	mux.HandleFunc("POST /api/nodes/{id}/token/rotate", s.authMiddleware(s.handleRotateToken))
	mux.HandleFunc("POST /api/nodes/{id}/disable", s.authMiddleware(s.handleDisableNode))
	mux.HandleFunc("POST /api/nodes/{id}/enable", s.authMiddleware(s.handleEnableNode))

	// Node Metrics & Services
	mux.HandleFunc("GET /api/nodes/{id}/metrics", s.authMiddleware(s.handleGetNodeMetrics))
	mux.HandleFunc("GET /api/nodes/{id}/services", s.authMiddleware(s.handleGetNodeServices))
	mux.HandleFunc("GET /api/nodes/{id}/alerts", s.authMiddleware(s.handleGetNodeAlerts))

	// Alerts & Rules
	mux.HandleFunc("GET /api/alerts", s.authMiddleware(s.handleListAlerts))
	mux.HandleFunc("POST /api/alerts/{id}/acknowledge", s.authMiddleware(s.handleAcknowledgeAlert))
	mux.HandleFunc("POST /api/alerts/{id}/resolve", s.authMiddleware(s.handleResolveAlert))
	mux.HandleFunc("GET /api/alerts/rules", s.authMiddleware(s.handleListRules))
	mux.HandleFunc("POST /api/alerts/rules", s.authMiddleware(s.handleSaveRule))
	mux.HandleFunc("DELETE /api/alerts/rules/{id}", s.authMiddleware(s.handleDeleteRule))

	// Groups
	mux.HandleFunc("GET /api/groups", s.authMiddleware(s.handleListGroups))
	mux.HandleFunc("POST /api/groups", s.authMiddleware(s.handleCreateGroup))
	mux.HandleFunc("PUT /api/groups/{id}", s.authMiddleware(s.handleUpdateGroup))
	mux.HandleFunc("DELETE /api/groups/{id}", s.authMiddleware(s.handleDeleteGroup))

	// Settings & Backup
	mux.HandleFunc("GET /api/settings/telegram", s.authMiddleware(s.handleGetTelegramSettings))
	mux.HandleFunc("POST /api/settings/telegram", s.authMiddleware(s.handleSaveTelegramSettings))
	mux.HandleFunc("POST /api/settings/telegram/test", s.authMiddleware(s.handleTestTelegram))
	mux.HandleFunc("GET /api/settings/retention", s.authMiddleware(s.handleGetRetentionSettings))
	mux.HandleFunc("POST /api/settings/retention", s.authMiddleware(s.handleSaveRetentionSettings))
	mux.HandleFunc("POST /api/backup", s.authMiddleware(s.handleBackupDatabase))

	// Static UI serving (fallback to index.html for SPA client-side routing)
	mux.HandleFunc("/", s.handleStaticFiles)

	return s.corsAndSecurityMiddleware(mux)
}

// Security, CORS and Header middleware
func (s *Server) corsAndSecurityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Node-Token")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Authentication middleware for dashboard API
func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := auth.ExtractBearerToken(r)
		if token == "" {
			writeJSONError(w, http.StatusUnauthorized, "Missing authorization token")
			return
		}

		claims, err := s.authMgr.VerifyJWT(token)
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}

		// Store user context if needed, then continue
		_ = claims
		next(w, r)
	}
}

// Health and readiness
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "app": "NodeWatch"})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if err := s.db.Ping(); err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "database": "connected"})
}

// getBaseURL dynamically resolves the public address of the server
func (s *Server) getBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Host
	if host != "" && !strings.Contains(host, "localhost") && !strings.Contains(host, "127.0.0.1") {
		return fmt.Sprintf("%s://%s", scheme, host)
	}
	if s.serverURL != "" && !strings.Contains(s.serverURL, "localhost") && !strings.Contains(s.serverURL, "127.0.0.1") {
		return s.serverURL
	}
	if host != "" {
		return fmt.Sprintf("%s://%s", scheme, host)
	}
	return "http://localhost:8765"
}

func (s *Server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	file := filepath.Base(r.PathValue("file"))
	paths := []string{
		filepath.Join("/opt/nodewatch/downloads", file),
		filepath.Join("./downloads", file),
		filepath.Join("/opt/nodewatch", file),
		filepath.Join(".", file),
		filepath.Join("/opt/nodewatch", "nodewatch-agent"),
	}
	for _, p := range paths {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", file))
			http.ServeFile(w, r, p)
			return
		}
	}
	http.NotFound(w, r)
}

func (s *Server) handleDownloadAgent(w http.ResponseWriter, r *http.Request) {
	paths := []string{
		"/opt/nodewatch/downloads/nodewatch-agent-amd64",
		"/opt/nodewatch/nodewatch-agent",
		"./downloads/nodewatch-agent-amd64",
		"./nodewatch-agent",
	}
	for _, p := range paths {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			w.Header().Set("Content-Disposition", "attachment; filename=\"nodewatch-agent\"")
			http.ServeFile(w, r, p)
			return
		}
	}
	http.NotFound(w, r)
}

// Agent installer script handler
func (s *Server) handleInstallScript(w http.ResponseWriter, r *http.Request) {
	srvURL := s.getBaseURL(r)

	script := fmt.Sprintf(`#!/usr/bin/env bash
set -e

SERVER_URL="%s"
TOKEN=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --token) TOKEN="$2"; shift ;;
        --server) SERVER_URL="$2"; shift ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$TOKEN" ]; then
    echo "Error: --token is required."
    echo "Usage: curl -fsSL $SERVER_URL/install.sh | sudo bash -s -- --token \"NODE_TOKEN\""
    exit 1
fi

echo "================================================"
echo "          NodeWatch Agent Installer             "
echo "================================================"

ARCH=$(uname -m)
AGENT_ARCH="amd64"
case $ARCH in
    x86_64) AGENT_ARCH="amd64" ;;
    aarch64|arm64) AGENT_ARCH="arm64" ;;
    armv7l|armhf) AGENT_ARCH="arm" ;;
esac

echo "Detected architecture: $AGENT_ARCH"
mkdir -p /opt/nodewatch
mkdir -p /etc/nodewatch

cat <<EOF > /etc/nodewatch/agent.json
{
  "server_url": "$SERVER_URL",
  "node_token": "$TOKEN",
  "interval": 5
}
EOF
chmod 600 /etc/nodewatch/agent.json

# 1. Download precompiled agent directly from central server or fallback to repo
echo "Downloading NodeWatch Agent..."
if curl -s -f -o /opt/nodewatch/nodewatch-agent "$SERVER_URL/downloads/nodewatch-agent-$AGENT_ARCH" || \
   curl -s -f -o /opt/nodewatch/nodewatch-agent "$SERVER_URL/downloads/nodewatch-agent" || \
   curl -s -f -o /opt/nodewatch/nodewatch-agent "$SERVER_URL/api/agent/download"; then
    chmod +x /opt/nodewatch/nodewatch-agent
else
    echo "Fetching agent installer from central repository..."
    curl -sSL https://raw.githubusercontent.com/Amiir-Dark/Monitoriing/main/scripts/nodewatch-agent-install.sh | sudo bash -s -- --token "$TOKEN" --server "$SERVER_URL"
    exit 0
fi

cat <<EOF > /etc/systemd/system/nodewatch-agent.service
[Unit]
Description=NodeWatch Monitoring Agent
After=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/nodewatch/nodewatch-agent -config /etc/nodewatch/agent.json
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nodewatch-agent
systemctl restart nodewatch-agent || true

echo "✔ NodeWatch Agent installed and actively reporting to $SERVER_URL!"
`, srvURL)

	w.Header().Set("Content-Type", "text/x-shellscript")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(script))
}

// Agent Authentication and Ingestion
func (s *Server) authenticateAgent(r *http.Request) (string, error) {
	rawToken := auth.ExtractAgentToken(r)
	if rawToken == "" {
		return "", auth.ErrUnauthorized
	}
	return s.nodesRepo.ValidateAgentToken(rawToken)
}

func (s *Server) handleAgentRegister(w http.ResponseWriter, r *http.Request) {
	nodeID, err := s.authenticateAgent(r)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, err.Error())
		return
	}

	var info models.SystemInfo
	if err := json.NewDecoder(r.Body).Decode(&info); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	if err := s.nodesRepo.UpdateNodeSystemInfo(nodeID, &info); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.hub.BroadcastJSON("node_registered", map[string]interface{}{"node_id": nodeID, "hostname": info.Hostname})
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "registered", "node_id": nodeID})
}

func (s *Server) handleAgentHeartbeat(w http.ResponseWriter, r *http.Request) {
	nodeID, err := s.authenticateAgent(r)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, err.Error())
		return
	}

	_ = s.nodesRepo.UpdateNodeSeen(nodeID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAgentMetrics(w http.ResponseWriter, r *http.Request) {
	nodeID, err := s.authenticateAgent(r)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, err.Error())
		return
	}

	var p models.AgentPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Malformed metrics JSON")
		return
	}

	if err := s.metricsRepo.Ingest(nodeID, &p); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to persist metrics: "+err.Error())
		return
	}

	_ = s.nodesRepo.SaveNodePayload(nodeID, &p)

	// Fetch node to get name for alerts & notifications
	n, _ := s.nodesRepo.GetNode(nodeID)
	nodeName := nodeID
	if n != nil {
		nodeName = n.Name
	}

	// Evaluate alert rules
	s.alertEngine.EvaluateMetrics(nodeID, nodeName, &p)

	// Broadcast live stats to WebSocket listeners
	s.hub.BroadcastJSON("node_metrics", map[string]interface{}{
		"node_id": nodeID,
		"metrics": p,
	})

	writeJSON(w, http.StatusCreated, map[string]string{"status": "accepted"})
}

func (s *Server) handleAgentStatus(w http.ResponseWriter, r *http.Request) {
	nodeID, err := s.authenticateAgent(r)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, err.Error())
		return
	}

	_ = s.nodesRepo.UpdateNodeSeen(nodeID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "recorded"})
}

// User Dashboard Login/Logout
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var u models.User
	var lastLogin sql.NullInt64
	var createdAt, updatedAt int64

	err := s.db.QueryRow(`
		SELECT id, username, password_hash, role, created_at, updated_at, last_login_at
		FROM users
		WHERE username = ?
	`, req.Username).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &createdAt, &updatedAt, &lastLogin)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "Invalid username or password")
		return
	}

	if !auth.CheckPassword(req.Password, u.PasswordHash) {
		writeJSONError(w, http.StatusUnauthorized, "Invalid username or password")
		return
	}

	now := time.Now().Unix()
	_, _ = s.db.Exec("UPDATE users SET last_login_at = ? WHERE id = ?", now, u.ID)
	_ = s.db.LogAudit(u.ID, "login", "User logged in", r.RemoteAddr)

	token, err := s.authMgr.SignJWT(u.ID, u.Username, u.Role, 7*24*time.Hour)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Token signing failure")
		return
	}

	// Set cookie for browser convenience
	http.SetCookie(w, &http.Cookie{
		Name:     "nodewatch_token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   7 * 86400,
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":       u.ID,
			"username": u.Username,
			"role":     u.Role,
		},
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "nodewatch_token",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged_out"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	token := auth.ExtractBearerToken(r)
	claims, err := s.authMgr.VerifyJWT(token)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":       claims.UserID,
		"username": claims.Username,
		"role":     claims.Role,
	})
}

// Dashboard Aggregation
func (s *Server) handleDashboardSummary(w http.ResponseWriter, r *http.Request) {
	nodesList, err := s.nodesRepo.ListNodes("", "", "", "")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var summary models.DashboardSummary
	summary.RecentAlerts = []models.Alert{}
	summary.RecentActivity = []models.AuditLog{}
	summary.TotalNodes = len(nodesList)

	var totalCPU, totalMem, totalDisk float64
	var activeNodesCount int

	for _, n := range nodesList {
		switch n.Status {
		case "online":
			summary.OnlineNodes++
		case "offline":
			summary.OfflineNodes++
		case "warning":
			summary.WarningNodes++
		}
		if n.Disabled {
			summary.DisabledNodes++
		}

		if n.LatestMetrics != nil && n.Status == "online" {
			totalCPU += n.LatestMetrics.CPU
			totalMem += n.LatestMetrics.Memory
			totalDisk += n.LatestMetrics.Disk
			summary.TotalNetworkRX += n.LatestMetrics.NetworkRXBytesSec
			summary.TotalNetworkTX += n.LatestMetrics.NetworkTXBytesSec
			activeNodesCount++
		}
	}

	if activeNodesCount > 0 {
		summary.AvgCPU = totalCPU / float64(activeNodesCount)
		summary.AvgMemory = totalMem / float64(activeNodesCount)
		summary.AvgDisk = totalDisk / float64(activeNodesCount)
	}

	// Active alerts
	alertsList, _ := s.alertEngine.ListAlerts("triggered", "", 10)
	summary.ActiveAlerts = len(alertsList)
	summary.RecentAlerts = alertsList

	// Recent activity
	rows, err := s.db.Query(`
		SELECT a.id, a.user_id, COALESCE(u.username, 'System'), a.action, a.details, a.ip_address, a.created_at
		FROM audit_logs a
		LEFT JOIN users u ON a.user_id = u.id
		ORDER BY a.created_at DESC
		LIMIT 10
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var l models.AuditLog
			var createdAt int64
			if err := rows.Scan(&l.ID, &l.UserID, &l.Username, &l.Action, &l.Details, &l.IPAddress, &createdAt); err == nil {
				l.CreatedAt = time.Unix(createdAt, 0)
				summary.RecentActivity = append(summary.RecentActivity, l)
			}
		}
	}

	writeJSON(w, http.StatusOK, summary)
}

// Nodes Handlers
func (s *Server) handleListNodes(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("search")
	status := r.URL.Query().Get("status")
	group := r.URL.Query().Get("group")
	tag := r.URL.Query().Get("tag")

	list, err := s.nodesRepo.ListNodes(search, status, group, tag)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateNode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string   `json:"name"`
		GroupID *string  `json:"group_id"`
		Tags    []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeJSONError(w, http.StatusBadRequest, "Node name is required")
		return
	}

	node, rawToken, err := s.nodesRepo.CreateNode(req.Name, req.GroupID, req.Tags)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	baseURL := s.getBaseURL(r)
	installCmd := fmt.Sprintf("curl -fsSL %s/install.sh | sudo bash -s -- --token %q", baseURL, rawToken)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"node":            node,
		"token":           rawToken,
		"install_command": installCmd,
	})
}

func (s *Server) handleGetNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	node, err := s.nodesRepo.GetNode(id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "Node not found")
		return
	}
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleUpdateNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Name     string   `json:"name"`
		GroupID  *string  `json:"group_id"`
		Tags     []string `json:"tags"`
		Disabled bool     `json:"disabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if err := s.nodesRepo.UpdateNode(id, req.Name, req.GroupID, req.Tags, req.Disabled); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	updated, _ := s.nodesRepo.GetNode(id)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.nodesRepo.DeleteNode(id); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleRotateToken(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	newToken, err := s.nodesRepo.RotateToken(id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	baseURL := s.getBaseURL(r)
	installCmd := fmt.Sprintf("curl -fsSL %s/install.sh | sudo bash -s -- --token %q", baseURL, newToken)
	writeJSON(w, http.StatusOK, map[string]string{
		"token":           newToken,
		"install_command": installCmd,
	})
}

func (s *Server) handleDisableNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_, err := s.db.Exec("UPDATE nodes SET disabled = 1, status = 'disabled' WHERE id = ?", id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func (s *Server) handleEnableNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_, err := s.db.Exec("UPDATE nodes SET disabled = 0, status = 'unknown' WHERE id = ?", id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "enabled"})
}

// Metrics and services
func (s *Server) handleGetNodeMetrics(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	metricType := r.URL.Query().Get("type")
	if metricType == "" {
		metricType = "cpu"
	}
	window := r.URL.Query().Get("window")
	if window == "" {
		window = "1h"
	}

	series, err := s.metricsRepo.GetMetricsSeries(id, metricType, window)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, series)
}

func (s *Server) handleGetNodeServices(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	svcs, err := s.metricsRepo.GetServices(id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, svcs)
}

func (s *Server) handleGetNodeAlerts(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	alertsList, err := s.alertEngine.ListAlerts("", id, 50)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, alertsList)
}

// Alerts and rules
func (s *Server) handleListAlerts(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if val, err := strconv.Atoi(limitStr); err == nil {
			limit = val
		}
	}

	alertsList, err := s.alertEngine.ListAlerts(status, "", limit)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, alertsList)
}

func (s *Server) handleAcknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.alertEngine.AcknowledgeAlert(id); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "acknowledged"})
}

func (s *Server) handleResolveAlert(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.alertEngine.ResolveAlert(id); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "resolved"})
}

func (s *Server) handleListRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.alertEngine.ListRules()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) handleSaveRule(w http.ResponseWriter, r *http.Request) {
	var rule models.AlertRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid rule JSON")
		return
	}
	if err := s.alertEngine.SaveRule(&rule); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) handleDeleteRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.alertEngine.DeleteRule(id); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Groups Handlers
func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT g.id, g.name, COALESCE(g.description, ''),
		       (SELECT COUNT(*) FROM nodes WHERE group_id = g.id),
		       g.created_at, g.updated_at
		FROM node_groups g
		ORDER BY g.name ASC
	`)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	groups := []models.NodeGroup{}
	for rows.Next() {
		var g models.NodeGroup
		var createdAt, updatedAt int64
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.NodeCount, &createdAt, &updatedAt); err == nil {
			g.CreatedAt = time.Unix(createdAt, 0)
			g.UpdatedAt = time.Unix(updatedAt, 0)
			groups = append(groups, g)
		}
	}
	writeJSON(w, http.StatusOK, groups)
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeJSONError(w, http.StatusBadRequest, "Group name is required")
		return
	}

	id := uuid.New().String()
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO node_groups (id, name, description, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`, id, req.Name, req.Description, now, now)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "name": req.Name})
}

func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	now := time.Now().Unix()
	_, err := s.db.Exec(`
		UPDATE node_groups SET name = ?, description = ?, updated_at = ?
		WHERE id = ?
	`, req.Name, req.Description, now, id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_, err := s.db.Exec("DELETE FROM node_groups WHERE id = ?", id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Telegram & Retention Settings Handlers
func (s *Server) handleGetTelegramSettings(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.tgClient.GetConfig()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"enabled": false, "bot_token": "", "chat_id": ""})
		return
	}
	// Mask bot token for display security
	maskedToken := cfg.BotToken
	if len(maskedToken) > 8 {
		maskedToken = maskedToken[:4] + "..." + maskedToken[len(maskedToken)-4:]
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":      cfg.Enabled,
		"bot_token":    cfg.BotToken,
		"masked_token": maskedToken,
		"chat_id":      cfg.ChatID,
	})
}

func (s *Server) handleSaveTelegramSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BotToken string `json:"bot_token"`
		ChatID   string `json:"chat_id"`
		Enabled  bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	if err := s.tgClient.SaveConfig(req.BotToken, req.ChatID, req.Enabled); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (s *Server) handleTestTelegram(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BotToken string `json:"bot_token"`
		ChatID   string `json:"chat_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	if err := s.tgClient.TestNotification(req.BotToken, req.ChatID); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Telegram test failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "message_sent"})
}

func (s *Server) handleGetRetentionSettings(w http.ResponseWriter, r *http.Request) {
	raw, _ := strconv.Atoi(s.db.GetSetting("raw_retention_days", "7"))
	hourly, _ := strconv.Atoi(s.db.GetSetting("hourly_retention_days", "90"))
	daily, _ := strconv.Atoi(s.db.GetSetting("daily_retention_days", "365"))
	timeout, _ := strconv.Atoi(s.db.GetSetting("offline_timeout_seconds", "30"))

	writeJSON(w, http.StatusOK, models.RetentionConfig{
		RawDays:        raw,
		HourlyDays:     hourly,
		DailyDays:      daily,
		OfflineSeconds: timeout,
	})
}

func (s *Server) handleSaveRetentionSettings(w http.ResponseWriter, r *http.Request) {
	var req models.RetentionConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	_ = s.db.SetSetting("raw_retention_days", strconv.Itoa(req.RawDays))
	_ = s.db.SetSetting("hourly_retention_days", strconv.Itoa(req.HourlyDays))
	_ = s.db.SetSetting("daily_retention_days", strconv.Itoa(req.DailyDays))
	_ = s.db.SetSetting("offline_timeout_seconds", strconv.Itoa(req.OfflineSeconds))

	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (s *Server) handleBackupDatabase(w http.ResponseWriter, r *http.Request) {
	backupDir := "./data/backups"
	_ = os.MkdirAll(backupDir, 0750)
	filename := fmt.Sprintf("nodewatch_backup_%s.db", time.Now().Format("20060102_150405"))
	backupPath := filepath.Join(backupDir, filename)

	if err := s.db.Backup(backupPath); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Backup failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":      "backup_created",
		"backup_path": backupPath,
		"filename":    filename,
	})
}

// Static files handler with fallback for React SPA
func (s *Server) handleStaticFiles(w http.ResponseWriter, r *http.Request) {
	if s.distPath == "" {
		s.distPath = "../frontend/dist"
	}

	path := filepath.Clean(r.URL.Path)
	filePath := filepath.Join(s.distPath, path)

	info, err := os.Stat(filePath)
	if err == nil && !info.IsDir() {
		http.ServeFile(w, r, filePath)
		return
	}

	// Serve index.html for client side routing
	indexPath := filepath.Join(s.distPath, "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		http.ServeFile(w, r, indexPath)
		return
	}

	// If dist does not exist yet (e.g. running API standalone before build)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, `{"service":"NodeWatch Central Server","status":"ready","api_prefix":"/api"}`)
}

// JSON helpers
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
