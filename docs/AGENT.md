# NodeWatch Agent (`nodewatch-agent`)

The NodeWatch agent is an ultra-lightweight, standalone Go binary designed for continuous 24/7 server metrics collection with near-zero resource utilization.

---

## 1. Design Principles

- **Zero External Command Spawning**: Instead of executing `top`, `free`, `df`, `ps`, or `netstat` every 5 seconds, the agent reads directly from Linux virtual filesystems (`/proc` and `/sys`).
- **Minimal Footprint**:
  - Memory: < 15 MB RSS
  - CPU: < 0.1% average utilization
  - Binary size: ~8 MB static binary
- **Fault-Tolerant Reconnection**: When the central monitoring server is unreachable, the agent employs exponential backoff with random jitter, avoiding aggressive connection retry loops.
- **Graceful Sensor Degradation**: Cloud virtual machines without physical hardware temperature sensors or specific interfaces fail gracefully without throwing fatal errors.

---

## 2. Metric Sources

| Metric Domain | Primary Linux Source | Collected Information |
|---|---|---|
| **CPU** | `/proc/stat`, `/proc/cpuinfo` | Overall CPU %, per-core CPU %, core count, clock frequency MHz |
| **Memory** | `/proc/meminfo` | Total, Used, Available, Buffers/Cache, Swap Total, Swap Used |
| **Disk** | `/proc/mounts`, `statfs` | Total GB, Used GB, Percentage for root and mounted filesystems |
| **Disk I/O** | `/proc/diskstats` | Delta read bytes, delta write bytes, read/write I/O operations |
| **Network** | `/proc/net/dev` | RX/TX bytes per second, packet throughput, network error rates |
| **Load** | `/proc/loadavg` | 1-minute, 5-minute, and 15-minute system load averages |
| **Temperature** | `/sys/class/thermal`, `/sys/class/hwmon` | Highest package and thermal zone temperature in Celsius |
| **Processes** | `/proc` entries, `/proc/[pid]/stat` | Total process count, running (R) processes, zombie (Z) count |
| **TCP** | `/proc/net/tcp`, `/proc/net/tcp6` | Established TCP connections (01), listening ports (0A), total |
| **Services** | `/proc/[pid]/comm` | Status of configured daemons (nginx, docker, redis, postgresql) |

---

## 3. Configuration File (`/etc/nodewatch/agent.json`)

```json
{
  "server_url": "https://monitor.example.com",
  "node_token": "nw_a1b2c3d4e5f6...",
  "interval": 5,
  "services": ["nginx", "docker", "xray", "redis", "postgresql"],
  "mount_points": ["/"]
}
```

Permissions must be restricted:
```bash
sudo chmod 600 /etc/nodewatch/agent.json
```

---

## 4. Environment Variables

- `NODEWATCH_SERVER_URL`: Central server URL
- `NODEWATCH_TOKEN`: Node authentication token
- `NODEWATCH_INTERVAL`: Monitoring interval in seconds (5, 10, 30, 60)
