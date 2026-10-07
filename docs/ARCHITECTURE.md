# NodeWatch Architecture & Internal Design

NodeWatch is designed as a decentralized agent-server system powered entirely by Go and embedded SQLite 3.

```text
                    ┌─────────────────────────┐
                    │       NodeWatch         │
                    │    Central Server       │
                    │                         │
                    │ Go REST API + SQLite    │
                    │ Auth & JWT Manager      │
                    │ Alert & Telegram Engine │
                    │ WebSocket Real-Time Hub │
                    │ Web SPA Dashboard       │
                    └────────────┬────────────┘
                                 │
                         HTTPS / WebSocket
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
   ┌────────────┐         ┌────────────┐         ┌────────────┐
   │ Node Agent │         │ Node Agent │         │ Node Agent │
   │   Server 1 │         │   Server 2 │         │   Server 3 │
   └────────────┘         └────────────┘         └────────────┘
```

---

## 1. Storage Architecture — SQLite 3 WAL

NodeWatch requires **zero external database engines** (no PostgreSQL, MySQL, Redis, or Mongo). All states and time-series metrics are managed using pure-Go SQLite with Write-Ahead Logging (WAL):

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;
```

### Why WAL Mode?
- **Concurrent Readers & Writers**: Writers do not block dashboard query readers.
- **In-Memory Buffer**: Fast sequential writes into `-wal` log file with minimal fsync overhead.
- **Atomic Online Backups**: Creates point-in-time consistent backups via `VACUUM INTO` without file locking.

---

## 2. Metric Rollup & Retention Lifecycle

To prevent infinite database expansion while preserving long-term analytical trends, NodeWatch implements automatic tiered aggregation:

1. **Raw Metrics**: Stored for **7 days**. High-resolution points recorded at 5s/10s intervals.
2. **Hourly Rollups (`metric_hourly`)**: Stored for **90 days**. Calculated automatically every 30 minutes for data older than 1 hour, computing `min`, `max`, `avg`, and `sample_count`.
3. **Daily Rollups (`metric_daily`)**: Stored for **365 days**. Aggregates hourly buckets into calendar day summaries.
4. **Non-Blocking Background Worker**: Runs on a separate goroutine every 30 minutes to clean expired raw rows and rollups in small, lock-free transactions.

---

## 3. Real-Time Streaming & WebSocket Pipeline

Instead of having the web browser repeatedly poll REST endpoints every few seconds:
1. When the agent posts a metrics batch (`POST /api/agent/metrics`), the server evaluates alert thresholds and broadcasts the event into a thread-safe WebSocket Hub.
2. Connected dashboard clients immediately update live gauge dials, status dots, and charts.
3. Fallback reconnection with backoff ensures transparent reconnects if the network drops.

---

## 4. Alert Engine

The alert engine continuously evaluates node health:
- **Offline Detection**: Nodes failing to send heartbeats for >30 seconds transition to `offline`.
- **Duration Verification**: Spikes must sustain for `duration_seconds` (e.g. CPU > 90% for 120 seconds) before an alert is dispatched, preventing alert fatigue from momentary spikes.
- **Telegram Dispatcher**: Messages are queued with cooldown deduplication (e.g., maximum 1 alert every 15 minutes per rule) to avoid spamming admin channels.
