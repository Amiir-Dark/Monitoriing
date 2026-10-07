# NodeWatch API Documentation

NodeWatch provides a REST API for dashboard management and high-throughput agent metric ingestion, as well as a real-time WebSocket stream.

---

## 1. Authentication

### User Login
Authenticates dashboard users and returns a signed JWT token.

- **Endpoint**: `POST /api/auth/login`
- **Request Body**:
  ```json
  {
    "username": "admin",
    "password": "admin123"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "token": "eyJhbGciOi...",
    "user": {
      "id": "uuid-...",
      "username": "admin",
      "role": "admin"
    }
  }
  ```

### Current User
- **Endpoint**: `GET /api/auth/me`
- **Headers**: `Authorization: Bearer <token>`
- **Response** (200 OK):
  ```json
  {
    "id": "uuid-...",
    "username": "admin",
    "role": "admin"
  }
  ```

---

## 2. Agent Ingestion Endpoints

Agent endpoints are authenticated using the unique node token passed via `X-Node-Token` header.

### Register Node System Info
Called by the agent on startup to report hardware specs and OS details.

- **Endpoint**: `POST /api/agent/register`
- **Headers**: `X-Node-Token: nw_...`
- **Request Body**:
  ```json
  {
    "hostname": "frankfurt-prod-01",
    "operating_system": "linux",
    "distribution": "Ubuntu 24.04 LTS",
    "kernel": "6.8.0-40-generic",
    "architecture": "amd64",
    "agent_version": "1.0.0",
    "uptime_seconds": 128450,
    "cpu_count": 4,
    "ip_addresses": ["198.51.100.14"],
    "timezone": "UTC"
  }
  ```

### Send Metrics Batch
Called every interval (default 5s) by the agent.

- **Endpoint**: `POST /api/agent/metrics`
- **Headers**: `X-Node-Token: nw_...`
- **Request Body**:
  ```json
  {
    "timestamp": 1728312000,
    "cpu": 24.5,
    "cpu_per_core": [22.1, 26.8, 23.4, 25.7],
    "cpu_count": 4,
    "cpu_freq_mhz": 2400.0,
    "memory": 48.2,
    "memory_total_mb": 16000.0,
    "memory_used_mb": 7712.0,
    "memory_avail_mb": 8288.0,
    "swap": 0.0,
    "disk": 38.4,
    "disk_total_gb": 120.0,
    "disk_used_gb": 46.08,
    "disk_read_bytes": 1048576,
    "disk_write_bytes": 5242880,
    "network_rx": 4194304,
    "network_tx": 2097152,
    "load1": 0.85,
    "load5": 0.62,
    "load15": 0.45,
    "temperature": 49.5,
    "processes": 124,
    "tcp_total": 85,
    "services": [
      { "name": "nginx", "status": "running" },
      { "name": "docker", "status": "running" }
    ]
  }
  ```

### Heartbeat
- **Endpoint**: `POST /api/agent/heartbeat`
- **Headers**: `X-Node-Token: nw_...`
- **Response** (200 OK): `{"status":"ok"}`

---

## 3. Node Management

### List Nodes
- **Endpoint**: `GET /api/nodes`
- **Query Parameters**:
  - `search`: Filter by name, hostname, or IP
  - `status`: Filter by status (`online`, `offline`, `warning`, `disabled`)
  - `group`: Filter by group ID
  - `tag`: Filter by tag name

### Create Node
- **Endpoint**: `POST /api/nodes`
- **Request Body**:
  ```json
  {
    "name": "Frankfurt-01",
    "group_id": "group-id-or-null",
    "tags": ["prod", "docker"]
  }
  ```
- **Response** (201 Created):
  ```json
  {
    "node": { "id": "...", "name": "Frankfurt-01", ... },
    "token": "nw_a1b2c3d4...",
    "install_command": "curl -fsSL https://monitor.example.com/install.sh | sudo bash -s -- --token \"nw_a1b2c3d4...\""
  }
  ```

### Rotate Token
- **Endpoint**: `POST /api/nodes/:id/token/rotate`
- **Response** (200 OK):
  ```json
  {
    "token": "nw_new_token...",
    "install_command": "curl -fsSL https://monitor.example.com/install.sh | sudo bash -s -- --token \"nw_new_token...\""
  }
  ```

---

## 4. Real-Time WebSocket

- **Endpoint**: `GET /api/ws?token=<JWT_TOKEN>`
- **Events Broadcasted**:
  - `node_metrics`: Sent whenever an agent reports metrics.
  - `node_status`: Sent when a node transitions between online and offline.
  - `alert_triggered`: Sent when a metric rule triggers an alert.
  - `alert_resolved`: Sent when an alert is resolved.
