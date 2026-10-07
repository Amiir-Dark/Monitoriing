# NodeWatch Installation Guide

NodeWatch can be deployed natively on any modern Linux distribution using standard systemd units or via Docker Compose.

---

## 1. Native Installation (Recommended)

### Requirements
- Linux (Ubuntu 20.04+, Debian 11+, RHEL/CentOS 8+, AlmaLinux, Rocky, Arch)
- Systemd
- Port 8080 open (or behind Nginx / Caddy reverse proxy with TLS)

### One-Command Server Setup
```bash
git clone https://github.com/example/nodewatch.git /tmp/nodewatch
cd /tmp/nodewatch
sudo bash install.sh
```

The installer will:
1. Detect architecture (`amd64`, `arm64`, `arm`).
2. Build or copy the compiled `nodewatch` binary to `/opt/nodewatch`.
3. Create database directory `/opt/nodewatch/data` with WAL mode enabled.
4. Copy compiled frontend assets to `/opt/nodewatch/dist`.
5. Install and enable the systemd service `/etc/systemd/system/nodewatch.service`.
6. Start the server on port 8080.

### Managing the Server Service
```bash
sudo systemctl status nodewatch
sudo systemctl restart nodewatch
sudo systemctl stop nodewatch
journalctl -u nodewatch -f
```

---

## 2. Docker Deployment

### Requirements
- Docker and Docker Compose v2+

### Setup
```bash
docker compose up -d
```

The container automatically mounts `./data` on the host to persist the SQLite database and automated backups.

---

## 3. Agent Installation on Monitored Linux Servers

From the NodeWatch dashboard:
1. Click **Add Server**.
2. Give the server a descriptive name and tags.
3. Copy the generated one-line command:
   ```bash
   curl -fsSL https://monitor.example.com/install.sh | sudo bash -s -- --token "nw_your_token_here"
   ```
4. Paste and execute the command in your remote server's terminal.

The remote server will automatically:
- Download the lightweight standalone Go agent binary.
- Create `/etc/nodewatch/agent.json` with permissions `0600`.
- Install `/etc/systemd/system/nodewatch-agent.service` with resource caps.
- Connect and immediately begin reporting CPU, RAM, Disk, Network, and Services metrics.
