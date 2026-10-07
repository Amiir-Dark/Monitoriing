# NodeWatch — Production-Ready Server Monitoring Platform

NodeWatch is a lightweight, fast, secure, and modern server monitoring platform designed to monitor multiple Linux servers with near-zero overhead.

Built entirely with **Go**, **pure SQLite 3 (WAL mode)**, and a **JavaScript-only React 19 / Tailwind CSS** dashboard.

---

## ✨ Key Features

- **Decentralized Architecture**: Central Go monitoring server with lightweight standalone Go agents.
- **Embedded Database Only**: Powered exclusively by SQLite 3 with Write-Ahead Logging (`WAL`), requiring **no PostgreSQL, MySQL, Redis, or Mongo**.
- **Automated Metric Retention & Aggregation**: Automatic 7-day raw, 90-day hourly, and 365-day daily roll-ups.
- **Ultra-Lightweight Agent (`nodewatch-agent`)**: Reads Linux `/proc` and `/sys` directly without spawning expensive shell commands like `top` or `free`.
- **Comprehensive Metrics**: Total & per-core CPU, RAM & Swap, Disk capacity & I/O, Network RX/TX, Load 1/5/15, Hardware temperatures, Process counts, and TCP sockets.
- **Service Monitoring**: Status tracking for `nginx`, `docker`, `redis`, `postgresql`, `xray`, `marzban`, etc.
- **Alert Engine**: Evaluates thresholds with duration verification (e.g. CPU > 90% sustained for 2 minutes) to prevent false alerts.
- **Telegram Notifications**: Markdown-formatted alerts with rate-limiting and deduplication.
- **Modern Dark-First Dashboard**: Minimalist, fast, and technical interface inspired by Linear and Cloudflare.
- **Real-Time Live Updates**: WebSocket push updates for instant gauge and chart updates.
- **Consistent SQLite Backups**: Atomic snapshots via `VACUUM INTO` command.

---

## 🚀 Quick Start (Local Development)

### 1. Start Backend Server
```bash
cd backend
go run ./cmd/nodewatch
```
The server will initialize the SQLite database in `./backend/data/nodewatch.db` and start on `http://localhost:8080`.
Default credentials: **`admin`** / **`admin123`**

### 2. Start Frontend Dev Server
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

### 3. Run Agent (Local or Remote)
In the dashboard, click **Add Server** to generate a token, or run locally:
```bash
cd agent
go run ./cmd/nodewatch-agent -token "<YOUR_NODE_TOKEN>" -url "http://localhost:8080"
```

---

## 📦 Production Deployment

### Native Systemd (Linux)
```bash
sudo bash install.sh
```

### Docker Compose
```bash
docker compose up -d
```

---

## 📚 Documentation

- [API Specification](docs/API.md)
- [Installation Guide](docs/INSTALL.md)
- [Agent Internals & Collectors](docs/AGENT.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Security Model](docs/SECURITY.md)

---

## 🧪 Testing

Run backend tests:
```bash
cd backend
go test -v ./...
```

Run agent tests:
```bash
cd agent
go test -v ./...
```

Verify frontend build:
```bash
cd frontend
npm run build
```
