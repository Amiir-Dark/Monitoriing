import { useState, useEffect, useMemo, useRef } from 'react';
import { getDashboardSummary, getNodes, acknowledgeAlert } from '../services/api';
import { wsService } from '../services/ws';
import Panel from '../components/common/Panel';
import Readout from '../components/common/Readout';
import MetricChart from '../components/charts/MetricChart';
import AddNodeModal from '../components/nodes/AddNodeModal';
import { GaugeCard, SegmentBar, MiniRadialGauge } from '../components/gauge';
import {
  formatNetworkSpeed,
  formatPercent,
  formatBytes,
  formatNumber,
  formatUptime,
  timeAgo,
  formatLatency,
  formatIOPS,
  formatPacketRate,
  formatDataFreshness,
} from '../utils/formatters';
import {
  Server,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Search,
  ArrowUpRight,
  ShieldAlert,
  Terminal,
  Copy,
  Check,
  ArrowDown,
  ArrowUp,
  Cpu,
  Gauge,
  Thermometer,
  HardDrive,
  Network,
  Activity,
  Layers,
  Clock,
  AlertCircle,
} from 'lucide-react';

const SAMPLE_MS = 5000;
const TREND_LIMIT = 120; // 5s x 120 = rolling 10 min buffer
const FRESH_WINDOW_S = 45;

const mean = (values) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

const fmtLoad = (v) => (v === null || v === undefined || isNaN(v) ? 'Unavailable' : v.toFixed(2));

export default function Dashboard({ onNavigateToNode, onNavigateToAlerts }) {
  const [summary, setSummary] = useState(null);
  const [nodesList, setNodesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [wsConnected, setWsConnected] = useState(wsService.isConnected);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [isAddNodeOpen, setIsAddNodeOpen] = useState(false);
  const [copiedIp, setCopiedIp] = useState(null);

  // Real-time trend buffers for cluster overview
  const [cpuTrend, setCpuTrend] = useState([]);
  const [memTrend, setMemTrend] = useState([]);
  const [netRxTrend, setNetRxTrend] = useState([]);
  const [netTxTrend, setNetTxTrend] = useState([]);

  const nodesRef = useRef(nodesList);
  useEffect(() => {
    nodesRef.current = nodesList;
  }, [nodesList]);

  const loadData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [summaryData, nodesData] = await Promise.all([
        getDashboardSummary(),
        getNodes(),
      ]);
      setSummary(summaryData);
      setNodesList(nodesData || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Sample real cluster metrics from online nodes only (never invent fake values)
  const sampleCluster = () => {
    const now = Math.floor(Date.now() / 1000);
    const online = nodesRef.current.filter((n) => {
      if (n.disabled) return false;
      const ts = n.latest_payload?.timestamp || (n.last_seen ? Math.floor(new Date(n.last_seen).getTime() / 1000) : null);
      return (n.status === 'online' || n.connection_state === 'ONLINE') && ts && (now - ts <= FRESH_WINDOW_S);
    });

    if (online.length === 0) return;

    const cpuVals = online
      .map((n) => n.latest_payload?.cpu ?? n.latest_metrics?.cpu)
      .filter((v) => v !== undefined && v !== null);
    const memVals = online
      .map((n) => n.latest_payload?.memory ?? n.latest_metrics?.memory)
      .filter((v) => v !== undefined && v !== null);
    const rxVals = online.map((n) => n.latest_payload?.network_rx ?? n.latest_metrics?.network_rx ?? 0);
    const txVals = online.map((n) => n.latest_payload?.network_tx ?? n.latest_metrics?.network_tx ?? 0);

    const cpu = mean(cpuVals);
    const mem = mean(memVals);
    const rx = rxVals.reduce((s, v) => s + v, 0);
    const tx = txVals.reduce((s, v) => s + v, 0);

    if (cpu !== null) setCpuTrend((prev) => [...prev, { timestamp: now, value: cpu }].slice(-TREND_LIMIT));
    if (mem !== null) setMemTrend((prev) => [...prev, { timestamp: now, value: mem }].slice(-TREND_LIMIT));
    setNetRxTrend((prev) => [...prev, { timestamp: now, value: rx }].slice(-TREND_LIMIT));
    setNetTxTrend((prev) => [...prev, { timestamp: now, value: tx }].slice(-TREND_LIMIT));
  };

  useEffect(() => {
    loadData();

    const sampleInterval = setInterval(sampleCluster, SAMPLE_MS);
    const pollInterval = setInterval(() => loadData(), 8000);

    const unsubLive = wsService.subscribe('connection_status', (data) => {
      setWsConnected(Boolean(data && data.connected));
    });

    const unsubMetrics = wsService.subscribe('node_metrics', (event) => {
      if (!event || !event.metrics) return;
      const p = event.metrics;
      const thermalOk = p.collectors?.temperature?.status === 'ok';

      setNodesList((prev) =>
        prev.map((node) => {
          if (node.id !== event.node_id) return node;
          const prevMetrics = node.latest_metrics || {};
          return {
            ...node,
            status: 'online',
            connection_state: 'ONLINE',
            last_seen: new Date().toISOString(),
            latest_payload: { ...node.latest_payload, ...p },
            latest_metrics: {
              ...prevMetrics,
              cpu: p.cpu,
              memory: p.memory,
              disk: p.disk,
              load1: p.load1 ?? p.load?.load1,
              network_rx: p.network_rx,
              network_tx: p.network_tx,
              uptime_seconds: p.uptime_seconds,
              timestamp: p.timestamp,
              temperature: thermalOk ? p.temperature : null,
              is_thermal_available: thermalOk,
              is_load_available: Boolean(p.load && p.load.available),
            },
          };
        })
      );
    });

    const unsubAlert = wsService.subscribe('alert_triggered', () => loadData());
    const unsubResolved = wsService.subscribe('alert_resolved', () => loadData());
    const unsubStatus = wsService.subscribe('node_status', (event) => {
      if (!event) return;
      setNodesList((prev) =>
        prev.map((n) => (n.id === event.node_id ? { ...n, status: event.status, connection_state: event.status?.toUpperCase() } : n))
      );
    });

    return () => {
      clearInterval(sampleInterval);
      clearInterval(pollInterval);
      unsubLive();
      unsubMetrics();
      unsubAlert();
      unsubResolved();
      unsubStatus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAck = async (id) => {
    try {
      await acknowledgeAlert(id);
      loadData();
    } catch {
      // silent
    }
  };

  const handleCopyIp = (ip, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 1800);
  };

  // Compute cluster-wide latest timestamp to calculate genuine cluster freshness
  const latestClusterTimestamp = useMemo(() => {
    let latest = 0;
    nodesList.forEach((n) => {
      const ts = n.latest_payload?.timestamp || (n.last_seen ? Math.floor(new Date(n.last_seen).getTime() / 1000) : 0);
      if (ts > latest) latest = ts;
    });
    return latest > 0 ? latest : null;
  }, [nodesList]);

  // Genuine cluster freshness state
  const clusterFreshness = useMemo(() => {
    if (!wsConnected && !latestClusterTimestamp) {
      return { status: 'DISCONNECTED', text: 'Backend disconnected', isLive: false, isStale: false, isOffline: true };
    }
    return formatDataFreshness(latestClusterTimestamp);
  }, [wsConnected, latestClusterTimestamp]);

  // Filtered nodes list for fleet view
  const filteredNodes = useMemo(() => {
    return nodesList.filter((node) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        node.name?.toLowerCase().includes(query) ||
        node.hostname?.toLowerCase().includes(query) ||
        node.ip_address?.toLowerCase().includes(query) ||
        (node.operating_system && node.operating_system.toLowerCase().includes(query)) ||
        (node.tags && node.tags.some((t) => t.toLowerCase().includes(query)));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'online' && (node.status === 'online' || node.connection_state === 'ONLINE')) ||
        (statusFilter === 'offline' && (node.status === 'offline' || node.connection_state === 'OFFLINE')) ||
        (statusFilter === 'warning' && (node.status === 'warning' || node.status === 'degraded')) ||
        (statusFilter === 'critical' && (node.status === 'critical' || node.latest_metrics?.cpu > 90));

      return matchesSearch && matchesStatus;
    });
  }, [nodesList, searchQuery, statusFilter]);

  // Aggregate telemetry derived exclusively from real Linux agent payloads
  const fleet = useMemo(() => {
    const statusCount = (s) => nodesList.filter((n) => n.status === s || n.connection_state === s.toUpperCase()).length;

    const reportingNodes = nodesList.filter((n) => {
      if (n.disabled) return false;
      const ts = n.latest_payload?.timestamp || (n.last_seen ? Math.floor(new Date(n.last_seen).getTime() / 1000) : 0);
      const isRecent = ts > 0 && Math.floor(Date.now() / 1000) - ts <= FRESH_WINDOW_S;
      return (n.status === 'online' || n.connection_state === 'ONLINE') && isRecent;
    });

    const payloads = reportingNodes
      .filter((n) => n.latest_payload)
      .map((n) => ({ name: n.name, p: n.latest_payload }));

    const collectorOk = (name) => ({ p }) => p.collectors?.[name]?.status === 'ok';
    const sum = (items, pick) => items.reduce((s, item) => s + (pick(item) || 0), 0);

    // CPU Telemetry -----------------------------------------------------------
    const cpuNodes = payloads.filter(collectorOk('cpu'));
    const totalCores = sum(cpuNodes, ({ p }) => p.cpu_count || 0);
    const splitOf = (p) =>
      (p.cpu_user || 0) + (p.cpu_system || 0) + (p.cpu_idle || 0) + (p.cpu_iowait || 0) + (p.cpu_steal || 0);
    const splitNodes = cpuNodes.filter(({ p }) => splitOf(p) > 0);
    const cpuSplit = splitNodes.length
      ? {
          user: mean(splitNodes.map(({ p }) => p.cpu_user || 0)),
          system: mean(splitNodes.map(({ p }) => p.cpu_system || 0)),
          iowait: mean(splitNodes.map(({ p }) => p.cpu_iowait || 0)),
          steal: mean(splitNodes.map(({ p }) => p.cpu_steal || 0)),
          idle: mean(splitNodes.map(({ p }) => p.cpu_idle || 0)),
          nodes: splitNodes.length,
        }
      : null;

    // Per-core usage across online nodes (collect representative per-core array)
    const perCoreUsages = [];
    payloads.forEach(({ p }) => {
      if (Array.isArray(p.cpu_per_core) && p.cpu_per_core.length > 0) {
        p.cpu_per_core.forEach((core) => {
          perCoreUsages.push(core);
        });
      }
    });

    // CPU Frequency
    const freqNodes = payloads.filter(({ p }) => p.cpu_freq_mhz && p.cpu_freq_mhz > 0);
    const avgCpuFreq = freqNodes.length ? mean(freqNodes.map(({ p }) => p.cpu_freq_mhz)) : null;

    // Load Averages
    const loadNodes = payloads.filter(({ p }) => p.load?.available || p.load1 !== undefined);
    const load1 = mean(loadNodes.map(({ p }) => p.load?.load1 ?? p.load1));
    const load5 = mean(loadNodes.map(({ p }) => p.load?.load5 ?? p.load5));
    const load15 = mean(loadNodes.map(({ p }) => p.load?.load15 ?? p.load15));

    // Peak CPU
    const peakCpu =
      reportingNodes
        .map((n) => ({ name: n.name, value: n.latest_payload?.cpu ?? n.latest_metrics?.cpu }))
        .filter((n) => n.value !== undefined && n.value !== null)
        .sort((a, b) => b.value - a.value)[0] || null;

    // Thermal
    const thermalReadings = reportingNodes
      .map((n) => ({
        name: n.name,
        value: n.latest_payload?.temperature ?? n.latest_metrics?.temperature,
      }))
      .filter((n) => n.value !== null && n.value !== undefined);
    const peakTemp = thermalReadings.length
      ? thermalReadings.sort((a, b) => b.value - a.value)[0]
      : null;
    const thermalReason =
      payloads.find(({ p }) => p.collectors?.temperature?.status && p.collectors.temperature.status !== 'ok')
        ?.p.collectors.temperature.message || 'No hardware thermal sensor reported';

    // Memory Telemetry --------------------------------------------------------
    const memNodes = payloads.filter(({ p }) => (p.mem_total_bytes || 0) > 0);
    const memTotal = sum(memNodes, ({ p }) => p.mem_total_bytes);
    const memUsed = sum(memNodes, ({ p }) => p.mem_used_bytes);
    const memFree = sum(memNodes, ({ p }) => p.mem_free_bytes);
    const memAvail = sum(memNodes, ({ p }) => p.mem_avail_bytes);
    const memCached = sum(memNodes, ({ p }) => p.mem_cached_bytes);
    const memBuffers = sum(memNodes, ({ p }) => p.mem_buffers_bytes);
    const memReclaim = Math.max(memAvail - memFree, 0);

    const swapTotal = sum(memNodes, ({ p }) => p.swap_total_bytes);
    const swapUsed = sum(memNodes, ({ p }) => p.swap_used_bytes);

    // Swap Activity
    const swapActNodes = payloads.filter(({ p }) => p.swap_activity?.available);
    const swapInSec = sum(swapActNodes, ({ p }) => p.swap_activity.pages_in_sec);
    const swapOutSec = sum(swapActNodes, ({ p }) => p.swap_activity.pages_out_sec);

    // Memory Pressure (Linux PSI)
    const psiNodes = payloads.filter(({ p }) => p.memory_pressure?.available);
    const psiSome10 = psiNodes.length ? mean(psiNodes.map(({ p }) => p.memory_pressure.some_10)) : null;
    const psiFull10 = psiNodes.length ? mean(psiNodes.map(({ p }) => p.memory_pressure.full_10)) : null;

    // Storage Telemetry -------------------------------------------------------
    const diskNodes = payloads.filter(({ p }) => (p.disk_total_bytes || 0) > 0);
    const diskTotal = sum(diskNodes, ({ p }) => p.disk_total_bytes);
    const diskUsed = sum(diskNodes, ({ p }) => p.disk_used_bytes);
    const diskAvail = diskTotal > diskUsed ? diskTotal - diskUsed : 0;
    const diskUsedPct = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : null;

    const ioNodes = payloads.filter(collectorOk('disk'));
    const diskRead = sum(ioNodes, ({ p }) => p.disk_read_bytes_sec);
    const diskWrite = sum(ioNodes, ({ p }) => p.disk_write_bytes_sec);
    const diskIOPS = sum(ioNodes, ({ p }) => p.disk_iops || (p.disk_read_ops_sec || 0) + (p.disk_write_ops_sec || 0));
    const latencyNodes = ioNodes.filter(({ p }) => p.disk_latency_ms && p.disk_latency_ms > 0);
    const diskLatency = latencyNodes.length ? mean(latencyNodes.map(({ p }) => p.disk_latency_ms)) : null;

    // Collect mounted filesystems across nodes (/ , /home, /var, /tmp, etc.)
    const allMounts = [];
    payloads.forEach(({ name: nodeName, p }) => {
      if (Array.isArray(p.mounts) && p.mounts.length > 0) {
        p.mounts.forEach((m) => {
          allMounts.push({ ...m, nodeName });
        });
      }
    });

    // Network Telemetry -------------------------------------------------------
    const netNodes = payloads.filter(collectorOk('network'));
    const netRX = sum(netNodes, ({ p }) => p.network_rx || p.network_rx_bytes_sec);
    const netTX = sum(netNodes, ({ p }) => p.network_tx || p.network_tx_bytes_sec);
    const netRXPackets = sum(netNodes, ({ p }) => p.network_rx_packets || p.network_rx_packets_sec);
    const netTXPackets = sum(netNodes, ({ p }) => p.network_tx_packets || p.network_tx_packets_sec);
    const netRXErrors = sum(netNodes, ({ p }) => p.network_rx_errors || p.network_rx_errors_sec);
    const netTXErrors = sum(netNodes, ({ p }) => p.network_tx_errors || p.network_tx_errors_sec);
    const netRXDrops = sum(netNodes, ({ p }) => p.network_rx_drops || p.network_rx_drops_sec);
    const netTXDrops = sum(netNodes, ({ p }) => p.network_tx_drops || p.network_tx_drops_sec);

    // Sockets / TCP & UDP
    const tcpNodes = payloads.filter(({ p }) => p.tcp && p.tcp.total !== undefined);
    const tcpConns = sum(tcpNodes, ({ p }) => p.tcp.total);
    const udpConns = sum(tcpNodes, ({ p }) => p.tcp.udp_total || 0);
    const retransNodes = tcpNodes.filter(({ p }) => p.tcp.retrans_rate !== undefined && p.tcp.retrans_rate !== null);
    const tcpRetransRate = retransNodes.length ? mean(retransNodes.map(({ p }) => p.tcp.retrans_rate)) : null;

    // Processes ---------------------------------------------------------------
    const procNodes = payloads.filter(collectorOk('processes')).filter(({ p }) => (p.processes?.total || 0) > 0);
    const procsTotal = sum(procNodes, ({ p }) => p.processes.total);
    const procsRunning = sum(procNodes, ({ p }) => p.processes.running);

    return {
      total: nodesList.length,
      reportingCount: reportingNodes.length,
      online: statusCount('online'),
      offline: statusCount('offline'),
      warning: statusCount('warning'),
      disabled: nodesList.filter((n) => n.disabled).length,
      // CPU
      cores: totalCores,
      cpuSplit,
      perCoreUsages,
      avgCpuFreq,
      peakCpu,
      loadNodes: loadNodes.length,
      load1,
      load5,
      load15,
      peakTemp,
      thermalReason,
      // Memory
      memNodes: memNodes.length,
      memTotal,
      memUsed,
      memFree,
      memAvail,
      memCached,
      memBuffers,
      memReclaim,
      swapTotal,
      swapUsed,
      swapActNodes: swapActNodes.length,
      swapInSec,
      swapOutSec,
      psiSome10,
      psiFull10,
      // Storage
      diskNodes: diskNodes.length,
      diskTotal,
      diskUsed,
      diskAvail,
      diskUsedPct,
      diskRead,
      diskWrite,
      diskIOPS,
      diskLatency,
      mounts: allMounts,
      // Network
      netNodes: netNodes.length,
      netRX,
      netTX,
      netRXPackets,
      netTXPackets,
      netRXErrors,
      netTXErrors,
      netRXDrops,
      netTXDrops,
      tcpConns,
      udpConns,
      tcpRetransRate,
      // Processes
      procsTotal,
      procsRunning,
      procNodes: procNodes.length,
    };
  }, [nodesList]);

  // Top CPU and Memory processes from live payloads
  const topProcesses = useMemo(() => {
    const list = [];
    nodesList.forEach((node) => {
      const p = node.latest_payload;
      if (p && Array.isArray(p.top_processes) && p.top_processes.length > 0) {
        p.top_processes.slice(0, 5).forEach((proc) => {
          list.push({
            nodeName: node.name,
            nodeId: node.id,
            pid: proc.pid,
            name: proc.name,
            cpu: proc.cpu_percent,
            mem: proc.memory_percent,
            memBytes: proc.memory_bytes,
            threads: proc.threads,
            readBytesSec: proc.read_bytes_sec,
            writeBytesSec: proc.write_bytes_sec,
            uptime: proc.uptime_seconds,
            command: proc.command,
          });
        });
      }
    });
    return list.sort((a, b) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 8);
  }, [nodesList]);

  if (loading && !summary) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-24 bg-dark-900 rounded-2xl border border-dark-800" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-72 bg-dark-900 rounded-2xl border border-dark-800" />
          ))}
        </div>
        <div className="h-64 bg-dark-900 rounded-2xl border border-dark-800" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="p-8 rounded-2xl bg-dark-900 border border-dark-800 text-center">
        <AlertTriangle className="mx-auto text-rose-400 mb-3" size={32} />
        <h3 className="text-base font-semibold text-white">Dashboard Telemetry Offline</h3>
        <p className="text-xs text-dark-400 mt-1 mb-4 font-mono">{error}</p>
        <button
          onClick={() => loadData(true)}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-semibold hover:bg-brand-500 transition-colors"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const onlineNodes = fleet.online;
  const noTelemetry = fleet.reportingCount === 0;
  const isHealthy =
    fleet.offline === 0 &&
    fleet.warning === 0 &&
    (summary?.active_alerts || 0) === 0;

  const activeTotal = fleet.total - fleet.disabled;
  const healthPct = activeTotal > 0 ? (onlineNodes / activeTotal) * 100 : null;

  const cpuSplitSegments = fleet.cpuSplit
    ? [
        { label: 'User', value: fleet.cpuSplit.user, color: '#3b82f6', display: `${fleet.cpuSplit.user.toFixed(1)}%` },
        { label: 'System', value: fleet.cpuSplit.system, color: '#06b6d4', display: `${fleet.cpuSplit.system.toFixed(1)}%` },
        { label: 'I/O Wait', value: fleet.cpuSplit.iowait, color: '#f59e0b', display: `${fleet.cpuSplit.iowait.toFixed(1)}%` },
        { label: 'Steal', value: fleet.cpuSplit.steal, color: '#a855f7', display: `${fleet.cpuSplit.steal.toFixed(1)}%` },
        { label: 'Idle', value: fleet.cpuSplit.idle, color: '#475569', display: `${fleet.cpuSplit.idle.toFixed(1)}%` },
      ]
    : [];

  const memSegments = fleet.memTotal
    ? [
        { label: 'Used', value: fleet.memUsed, color: '#60a5fa', display: formatBytes(fleet.memUsed) },
        { label: 'Cached', value: fleet.memCached, color: '#22d3ee', display: formatBytes(fleet.memCached) },
        { label: 'Buffers', value: fleet.memBuffers, color: '#a78bfa', display: formatBytes(fleet.memBuffers) },
        { label: 'Free', value: fleet.memFree, color: '#475569', display: formatBytes(fleet.memFree) },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* 1. Command Header with Truthful Freshness Indicator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-5 py-4 rounded-2xl border border-dark-800/80 bg-dark-900 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg font-bold text-white tracking-tight">
              Linux Infrastructure Command Center
            </h1>
            {/* Truthful Live / Stale / Disconnected indicator */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border font-mono ${
                clusterFreshness.isLive
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : clusterFreshness.isStale
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  clusterFreshness.isLive
                    ? 'bg-emerald-400 animate-pulse'
                    : clusterFreshness.isStale
                    ? 'bg-amber-400'
                    : 'bg-rose-400'
                }`}
              />
              {clusterFreshness.status}: {clusterFreshness.text}
            </span>
          </div>
          <p className="text-xs text-dark-400 mt-1 font-mono">
            Direct /proc & /sys kernel telemetry · Zero synthetic or estimated values
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-end md:self-auto">
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Refresh Metrics"
            className="px-3 py-2.5 rounded-xl bg-dark-800/80 hover:bg-dark-700 text-dark-300 hover:text-white border border-dark-700/60 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-brand-400' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={() => setIsAddNodeOpen(true)}
            className="px-3.5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold transition-all shadow-glow-brand flex items-center gap-1.5"
          >
            <Plus size={15} />
            <span>Add Server Node</span>
          </button>
        </div>
      </div>

      {/* 2. Top-level Overview Strip: FLEET HEALTH, SERVERS, ACTIVE ALERTS */}
      <div
        className={`px-5 py-4 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors ${
          isHealthy
            ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
            : 'border-rose-500/20 bg-rose-500/[0.04]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`p-2 rounded-xl border ${
              isHealthy
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}
          >
            {isHealthy ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {isHealthy ? 'Fleet Health Nominal' : 'Infrastructure Requires Attention'}
            </h3>
            <p className="text-xs text-dark-400 mt-0.5 font-mono truncate">
              {fleet.reportingCount} of {fleet.total} nodes actively reporting live telemetry
              {summary?.active_alerts > 0 && ` · ${summary.active_alerts} active alert(s)`}
            </p>
          </div>
        </div>

        {/* Server Fleet and Alerts Breakdown */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-6 gap-y-2">
          <div className="text-right sm:text-center">
            <div className="text-lg font-bold font-mono tabular-nums leading-none text-white">
              {fleet.total}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-dark-500 mt-1">
              SERVERS
            </div>
          </div>
          <div className="text-right sm:text-center">
            <div className="text-lg font-bold font-mono tabular-nums leading-none text-emerald-400">
              {fleet.online}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-dark-500 mt-1">
              ONLINE
            </div>
          </div>
          <div className="text-right sm:text-center">
            <div className="text-lg font-bold font-mono tabular-nums leading-none text-amber-400">
              {fleet.warning}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-dark-500 mt-1">
              WARNING
            </div>
          </div>
          <div className="text-right sm:text-center">
            <div className="text-lg font-bold font-mono tabular-nums leading-none text-rose-400">
              {fleet.offline}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-dark-500 mt-1">
              OFFLINE
            </div>
          </div>
          <div className="text-right sm:text-center">
            <div className="text-lg font-bold font-mono tabular-nums leading-none text-cyan-400">
              {healthPct !== null ? `${Math.round(healthPct)}%` : 'Unavailable'}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-dark-500 mt-1">
              HEALTH
            </div>
          </div>
          <div className="text-right sm:text-center">
            <div className={`text-lg font-bold font-mono tabular-nums leading-none ${summary?.active_alerts > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {summary?.active_alerts ?? 0}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-dark-500 mt-1">
              ALERTS
            </div>
          </div>
        </div>
      </div>

      {/* 3. CORE OVERVIEW CARDS: CPU, RAM, STORAGE, NETWORK */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* CARD 1: CPU */}
        <div className="bg-dark-900 border border-dark-800/80 rounded-2xl p-4.5 space-y-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-blue-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">CPU</h3>
              </div>
              <p className="text-[11px] text-dark-400 font-mono mt-0.5">
                {fleet.cores > 0 ? `${fleet.cores} Cores` : 'Cores Unavailable'}
                {fleet.avgCpuFreq ? ` · ${(fleet.avgCpuFreq / 1000).toFixed(2)} GHz` : ''}
              </p>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                clusterFreshness.isLive
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {clusterFreshness.lastKnown ? 'LAST KNOWN' : 'LIVE'}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              {noTelemetry ? 'Unavailable' : formatPercent(summary?.avg_cpu)}
            </div>
            <div className="text-right text-[11px] font-mono text-dark-400">
              <span className="text-dark-500">Peak: </span>
              <span className={fleet.peakCpu ? 'text-amber-400 font-bold' : 'text-dark-500'}>
                {fleet.peakCpu ? `${formatPercent(fleet.peakCpu.value)} (${fleet.peakCpu.name})` : 'Unavailable'}
              </span>
            </div>
          </div>

          {/* Load Averages */}
          <div className="p-2.5 bg-dark-950 rounded-xl border border-dark-800/60 text-xs font-mono space-y-1.5">
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>Load Avg (1m / 5m / 15m)</span>
              <span className="text-white font-semibold">
                {fmtLoad(fleet.load1)} · {fmtLoad(fleet.load5)} · {fmtLoad(fleet.load15)}
              </span>
            </div>
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>Temperature</span>
              <span className={fleet.peakTemp ? 'text-amber-400 font-semibold' : 'text-dark-500'}>
                {fleet.peakTemp ? `${fleet.peakTemp.value.toFixed(1)}°C` : 'Unavailable'}
              </span>
            </div>
          </div>

          {/* CPU Time Split: User, System, I/O Wait, Steal, Idle */}
          <div className="space-y-1 text-[11px] font-mono">
            <div className="flex justify-between text-dark-400 text-[10px]">
              <span>TIME SPLIT</span>
              <span>{fleet.cpuSplit ? 'DELTA /proc/stat' : 'Unavailable'}</span>
            </div>
            {fleet.cpuSplit ? (
              <div className="grid grid-cols-5 gap-1 text-center text-[10px] pt-1">
                <div className="p-1 rounded bg-dark-950 border border-dark-800">
                  <div className="text-blue-400 font-bold">{fleet.cpuSplit.user.toFixed(0)}%</div>
                  <div className="text-dark-500">User</div>
                </div>
                <div className="p-1 rounded bg-dark-950 border border-dark-800">
                  <div className="text-cyan-400 font-bold">{fleet.cpuSplit.system.toFixed(0)}%</div>
                  <div className="text-dark-500">Sys</div>
                </div>
                <div className="p-1 rounded bg-dark-950 border border-dark-800">
                  <div className="text-amber-400 font-bold">{fleet.cpuSplit.iowait.toFixed(0)}%</div>
                  <div className="text-dark-500">Wait</div>
                </div>
                <div className="p-1 rounded bg-dark-950 border border-dark-800">
                  <div className="text-purple-400 font-bold">{fleet.cpuSplit.steal.toFixed(0)}%</div>
                  <div className="text-dark-500">Steal</div>
                </div>
                <div className="p-1 rounded bg-dark-950 border border-dark-800">
                  <div className="text-dark-400 font-bold">{fleet.cpuSplit.idle.toFixed(0)}%</div>
                  <div className="text-dark-500">Idle</div>
                </div>
              </div>
            ) : (
              <div className="text-dark-500 text-[11px]">Split data Unavailable</div>
            )}
          </div>
        </div>

        {/* CARD 2: RAM */}
        <div className="bg-dark-900 border border-dark-800/80 rounded-2xl p-4.5 space-y-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-cyan-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">RAM</h3>
              </div>
              <p className="text-[11px] text-dark-400 font-mono mt-0.5">
                {fleet.memTotal ? `${formatBytes(fleet.memUsed)} / ${formatBytes(fleet.memTotal)}` : 'Unavailable'}
              </p>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                clusterFreshness.isLive
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {clusterFreshness.lastKnown ? 'LAST KNOWN' : 'LIVE'}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              {noTelemetry ? 'Unavailable' : formatPercent(summary?.avg_memory)}
            </div>
            <div className="text-right text-[11px] font-mono text-dark-400">
              <span className="text-dark-500">Avail: </span>
              <span className="text-emerald-400 font-semibold">
                {fleet.memAvail ? formatBytes(fleet.memAvail) : 'Unavailable'}
              </span>
            </div>
          </div>

          {/* Buffers, Cached, Swap */}
          <div className="p-2.5 bg-dark-950 rounded-xl border border-dark-800/60 text-xs font-mono space-y-1.5">
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>Cached / Buffers</span>
              <span className="text-dark-200">
                {fleet.memCached ? `${formatBytes(fleet.memCached)} / ${formatBytes(fleet.memBuffers)}` : 'Unavailable'}
              </span>
            </div>
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>Swap Used / Total</span>
              <span className="text-dark-200">
                {fleet.swapTotal ? `${formatBytes(fleet.swapUsed)} / ${formatBytes(fleet.swapTotal)}` : 'No Swap'}
              </span>
            </div>
          </div>

          {/* Swap Activity & Memory Pressure PSI */}
          <div className="space-y-1 text-[11px] font-mono">
            <div className="flex justify-between text-dark-400 text-[10px]">
              <span>PRESSURE (PSI) / SWAP I/O</span>
              <span className="text-dark-500">/proc/pressure</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
              <div className="p-1.5 rounded bg-dark-950 border border-dark-800">
                <div className="text-dark-500">PSI Some10</div>
                <div className="text-cyan-400 font-semibold font-mono">
                  {fleet.psiSome10 !== null ? `${fleet.psiSome10.toFixed(2)}%` : 'Unavailable'}
                </div>
              </div>
              <div className="p-1.5 rounded bg-dark-950 border border-dark-800">
                <div className="text-dark-500">Swap Activity</div>
                <div className="text-dark-200 font-semibold font-mono">
                  {fleet.swapActNodes > 0
                    ? `${fleet.swapInSec.toFixed(1)} in / ${fleet.swapOutSec.toFixed(1)} out/s`
                    : 'Unavailable'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CARD 3: STORAGE */}
        <div className="bg-dark-900 border border-dark-800/80 rounded-2xl p-4.5 space-y-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <HardDrive size={16} className="text-purple-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">STORAGE</h3>
              </div>
              <p className="text-[11px] text-dark-400 font-mono mt-0.5">
                {fleet.diskTotal ? `${formatBytes(fleet.diskUsed)} / ${formatBytes(fleet.diskTotal)}` : 'Unavailable'}
              </p>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                clusterFreshness.isLive
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {clusterFreshness.lastKnown ? 'LAST KNOWN' : 'LIVE'}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              {noTelemetry ? 'Unavailable' : formatPercent(fleet.diskUsedPct ?? summary?.avg_disk)}
            </div>
            <div className="text-right text-[11px] font-mono text-dark-400">
              <span className="text-dark-500">Free: </span>
              <span className="text-purple-400 font-semibold">
                {fleet.diskAvail ? formatBytes(fleet.diskAvail) : 'Unavailable'}
              </span>
            </div>
          </div>

          {/* I/O Throughput & IOPS */}
          <div className="p-2.5 bg-dark-950 rounded-xl border border-dark-800/60 text-xs font-mono space-y-1.5">
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>Read / Write Speed</span>
              <span className="text-dark-200">
                {fleet.diskNodes ? `${formatNetworkSpeed(fleet.diskRead)} / ${formatNetworkSpeed(fleet.diskWrite)}` : 'Unavailable'}
              </span>
            </div>
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>IOPS / Latency</span>
              <span className="text-dark-200">
                {fleet.diskNodes ? `${formatIOPS(fleet.diskIOPS)} · ${formatLatency(fleet.diskLatency)}` : 'Unavailable'}
              </span>
            </div>
          </div>

          {/* Mounted Filesystems Preview */}
          <div className="space-y-1 text-[11px] font-mono">
            <div className="flex justify-between text-dark-400 text-[10px]">
              <span>MOUNTED FILESYSTEMS</span>
              <span>{fleet.mounts.length} detected</span>
            </div>
            {fleet.mounts.length > 0 ? (
              <div className="space-y-1 max-h-16 overflow-y-auto pr-1">
                {fleet.mounts.slice(0, 3).map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[10px] text-dark-300">
                    <span className="truncate max-w-[100px] text-white font-medium">{m.mount_point}</span>
                    <span className="text-dark-500">{formatBytes(m.used_bytes)} / {formatBytes(m.total_bytes)}</span>
                    <span className={m.percent > 85 ? 'text-rose-400 font-bold' : 'text-purple-400'}>
                      {formatPercent(m.percent)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-dark-500 text-[11px]">No mount telemetry reported</div>
            )}
          </div>
        </div>

        {/* CARD 4: NETWORK */}
        <div className="bg-dark-900 border border-dark-800/80 rounded-2xl p-4.5 space-y-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Network size={16} className="text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">NETWORK</h3>
              </div>
              <p className="text-[11px] text-dark-400 font-mono mt-0.5">
                {fleet.netNodes > 0 ? `${fleet.netNodes} nodes reporting` : 'Unavailable'}
              </p>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                clusterFreshness.isLive
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {clusterFreshness.lastKnown ? 'LAST KNOWN' : 'LIVE'}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="text-xl font-bold font-mono text-white tracking-tight">
              <span className="text-emerald-400">↓ {formatNetworkSpeed(fleet.netRX)}</span>
              <span className="text-dark-600 mx-1.5">/</span>
              <span className="text-blue-400">↑ {formatNetworkSpeed(fleet.netTX)}</span>
            </div>
          </div>

          {/* Packets per second & Errors / Drops */}
          <div className="p-2.5 bg-dark-950 rounded-xl border border-dark-800/60 text-xs font-mono space-y-1.5">
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>RX / TX Packets</span>
              <span className="text-dark-200">
                {fleet.netNodes > 0 ? `${formatPacketRate(fleet.netRXPackets)} / ${formatPacketRate(fleet.netTXPackets)}` : 'Unavailable'}
              </span>
            </div>
            <div className="flex items-center justify-between text-dark-400 text-[11px]">
              <span>Errors / Drops</span>
              <span className={(fleet.netRXErrors + fleet.netTXErrors + fleet.netRXDrops + fleet.netTXDrops) > 0 ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                {fleet.netNodes > 0 ? `${fleet.netRXErrors + fleet.netTXErrors} err · ${fleet.netRXDrops + fleet.netTXDrops} drop` : 'Unavailable'}
              </span>
            </div>
          </div>

          {/* TCP / UDP Sockets & Retransmissions */}
          <div className="space-y-1 text-[11px] font-mono">
            <div className="flex justify-between text-dark-400 text-[10px]">
              <span>SOCKETS & RETRANSMISSION</span>
              <span className="text-dark-500">/proc/net/snmp</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
              <div className="p-1.5 rounded bg-dark-950 border border-dark-800">
                <div className="text-dark-500">TCP / UDP Conns</div>
                <div className="text-white font-semibold">
                  {fleet.netNodes > 0 ? `${fleet.tcpConns} TCP · ${fleet.udpConns} UDP` : 'Unavailable'}
                </div>
              </div>
              <div className="p-1.5 rounded bg-dark-950 border border-dark-800">
                <div className="text-dark-500">TCP Retrans Rate</div>
                <div className="text-amber-400 font-semibold">
                  {fleet.tcpRetransRate !== null ? `${fleet.tcpRetransRate.toFixed(2)}%` : 'Unavailable'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Cluster Telemetry Readouts (Detailed Metrics strip) */}
      <Panel
        title="Fleet Telemetry Aggregation"
        meta="Real-time mathematical aggregation across reporting Linux agents"
        bodyClassName="px-3 sm:px-5"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-3">
          <Readout
            label="Network In"
            icon={ArrowDown}
            value={noTelemetry ? 'Unavailable' : formatNetworkSpeed(fleet.netRX)}
            sub="aggregate rx bandwidth"
            tone="text-emerald-400"
          />
          <Readout
            label="Network Out"
            icon={ArrowUp}
            value={noTelemetry ? 'Unavailable' : formatNetworkSpeed(fleet.netTX)}
            sub="aggregate tx bandwidth"
            tone="text-blue-400"
          />
          <Readout
            label="Load Avg 1m"
            icon={Gauge}
            value={fmtLoad(fleet.load1)}
            sub={
              fleet.loadNodes
                ? `5m ${fmtLoad(fleet.load5)} · 15m ${fmtLoad(fleet.load15)}`
                : 'no node reports load'
            }
            tone="text-white"
          />
          <Readout
            label="Peak Temp"
            icon={Thermometer}
            value={fleet.peakTemp ? `${fleet.peakTemp.value.toFixed(1)}°C` : 'Unavailable'}
            sub={fleet.peakTemp ? fleet.peakTemp.name : fleet.thermalReason}
            tone="text-amber-400"
          />
          <Readout
            label="Processes"
            icon={Cpu}
            value={fleet.procNodes ? formatNumber(fleet.procsTotal) : 'Unavailable'}
            sub={fleet.procNodes ? `${formatNumber(fleet.procsRunning)} active running` : 'no telemetry'}
            tone="text-white"
          />
          <Readout
            label="Active Alerts"
            icon={ShieldAlert}
            value={summary?.active_alerts ?? 0}
            sub="triggered incidents"
            tone={(summary?.active_alerts || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}
          />
        </div>
      </Panel>

      {/* 5. Breakdown Bars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="CPU Time Allocation"
          meta={fleet.cpuSplit ? `Mean delta across ${fleet.cpuSplit.nodes} nodes` : 'Awaiting telemetry'}
        >
          <SegmentBar
            segments={cpuSplitSegments}
            unavailableText="Unavailable — no node has reported a complete CPU delta yet"
          />
          <p className="mt-4 text-[10px] font-mono text-dark-500 leading-relaxed">
            user + system + iowait + steal + idle = 100% per node, computed directly from /proc/stat
            counter deltas between agent sampling intervals.
          </p>
        </Panel>

        <Panel
          title="Memory Distribution"
          meta={fleet.memNodes ? `Exact bytes from /proc/meminfo · ${fleet.memNodes} nodes` : 'Awaiting telemetry'}
        >
          <SegmentBar
            segments={memSegments}
            unavailableText="Unavailable — no memory payload received yet"
          />
          <p className="mt-4 text-[10px] font-mono text-dark-500 leading-relaxed">
            used = total − available · reclaimable = available − free (buffers, cached) ·
            all measurements are exact byte counters from the Linux virtual filesystem.
          </p>
        </Panel>
      </div>

      {/* 6. SERVER FLEET SECTION */}
      <Panel
        title="Server Fleet"
        meta={`${filteredNodes.length} / ${nodesList.length} monitored servers`}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                type="text"
                placeholder="Search hostname, IP, tag, OS..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 sm:w-60 bg-dark-950 border border-dark-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-dark-500 focus:outline-none focus:border-brand-500 font-mono"
              />
            </div>

            <div className="flex items-center bg-dark-950 p-1 rounded-xl border border-dark-800 text-[11px] font-medium">
              {[
                { id: 'all', label: 'All' },
                { id: 'online', label: 'Online' },
                { id: 'offline', label: 'Offline' },
                { id: 'warning', label: 'Warning' },
                { id: 'critical', label: 'Critical' },
              ].map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setStatusFilter(filter.id)}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    statusFilter === filter.id
                      ? 'bg-brand-600 text-white font-semibold'
                      : 'text-dark-400 hover:text-white'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        }
        bodyClassName="px-3 sm:px-5"
      >
        {filteredNodes.length === 0 ? (
          <div className="py-12 text-center text-dark-400 text-xs font-mono">
            <Server size={32} className="mx-auto text-dark-600 mb-2 opacity-50" />
            No server nodes match the current filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredNodes.map((node) => {
              const isOnline = node.status === 'online' || node.connection_state === 'ONLINE';
              const isDegraded = node.status === 'warning' || node.status === 'degraded';
              const m = node.latest_metrics || {};
              const p = node.latest_payload || {};
              const cpuVal = p.cpu ?? m.cpu ?? 0;
              const memVal = p.memory ?? m.memory ?? 0;
              const diskVal = p.disk ?? m.disk ?? 0;
              const rxSpeed = p.network_rx ?? m.network_rx ?? 0;
              const txSpeed = p.network_tx ?? m.network_tx ?? 0;
              const uptimeSec = p.uptime_seconds ?? m.uptime_seconds;
              const ts = p.timestamp || (node.last_seen ? Math.floor(new Date(node.last_seen).getTime() / 1000) : null);
              const freshness = formatDataFreshness(ts);

              return (
                <div
                  key={node.id}
                  onClick={() => onNavigateToNode && onNavigateToNode(node.id)}
                  className="bg-dark-950/70 hover:bg-dark-950 border border-dark-800/80 hover:border-brand-500/40 rounded-2xl p-4 transition-all duration-200 cursor-pointer shadow-sm group"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative">
                        <span
                          className={`w-2.5 h-2.5 rounded-full block ${
                            isOnline ? 'bg-emerald-500' : isDegraded ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                        />
                        {isOnline && (
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 absolute inset-0 animate-ping opacity-75" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-white truncate group-hover:text-brand-400 transition-colors">
                            {node.name}
                          </h3>
                        </div>
                        <p className="text-[11px] text-dark-500 font-mono truncate">
                          {node.hostname || 'hostname unassigned'}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border font-mono ${
                        isOnline
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : isDegraded
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {node.connection_state || node.status?.toUpperCase()}
                    </span>
                  </div>

                  {/* IP & OS Badges */}
                  <div className="flex items-center gap-2 mb-3.5 text-[11px] font-mono flex-wrap">
                    {node.ip_address && (
                      <button
                        onClick={(e) => handleCopyIp(node.ip_address, e)}
                        title="Click to copy IP"
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-dark-900 hover:bg-dark-800 text-dark-300 hover:text-white border border-dark-800 transition-colors"
                      >
                        <span>{node.ip_address}</span>
                        {copiedIp === node.ip_address ? (
                          <Check size={11} className="text-emerald-400" />
                        ) : (
                          <Copy size={11} />
                        )}
                      </button>
                    )}
                    {(node.operating_system || node.operatingSystem) && (
                      <span className="px-2 py-0.5 rounded-md bg-dark-900 text-dark-400 border border-dark-800 truncate">
                        {node.operating_system || node.operatingSystem}
                      </span>
                    )}
                  </div>

                  {/* Gauges for CPU, RAM, DISK */}
                  <div className="grid grid-cols-3 gap-2 py-2.5 px-2 bg-dark-900/60 rounded-xl border border-dark-800/80 mb-3">
                    <MiniRadialGauge
                      value={Number(cpuVal.toFixed(1))}
                      label="CPU"
                      size={54}
                      color={!isOnline ? '#475569' : undefined}
                    />
                    <MiniRadialGauge
                      value={Number(memVal.toFixed(1))}
                      label="RAM"
                      size={54}
                      color={!isOnline ? '#475569' : undefined}
                    />
                    <MiniRadialGauge
                      value={Number(diskVal.toFixed(1))}
                      label="DISK"
                      size={54}
                      color={!isOnline ? '#475569' : undefined}
                    />
                  </div>

                  {/* Network & Uptime */}
                  <div className="pt-2.5 border-t border-dark-800/60 flex items-center justify-between gap-2 text-[11px] text-dark-400 font-mono">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex items-center gap-0.5 text-emerald-400">
                        <ArrowDown size={11} />
                        {formatNetworkSpeed(rxSpeed)}
                      </span>
                      <span className="flex items-center gap-0.5 text-blue-400">
                        <ArrowUp size={11} />
                        {formatNetworkSpeed(txSpeed)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-dark-500">
                        UP: {uptimeSec ? formatUptime(uptimeSec) : '—'}
                      </span>
                      <span className="flex items-center gap-0.5 text-dark-400 group-hover:text-brand-400 font-medium transition-colors">
                        Inspect <ArrowUpRight size={12} />
                      </span>
                    </div>
                  </div>

                  {/* Freshness footer on card */}
                  <div className="mt-2 text-[10px] font-mono text-dark-500 flex items-center justify-between">
                    <span className={freshness.isLive ? 'text-emerald-400/80' : 'text-amber-400/80'}>
                      {freshness.lastKnown ? `LAST KNOWN DATA (${freshness.text})` : freshness.text}
                    </span>
                    {node.agent_version && <span>v{node.agent_version}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* 7. Live Telemetry Charts (Cluster Historical Trend) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dark-400">
              Live Cluster Telemetry Streams
            </h2>
            <span className="text-[10px] font-mono text-dark-500">
              Rolling {Math.round((SAMPLE_MS / 1000) * TREND_LIMIT / 60)}m continuous kernel telemetry
            </span>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
              clusterFreshness.isLive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-dark-800 text-dark-400 border-dark-700'
            }`}
          >
            {clusterFreshness.isLive ? 'STREAMING LIVE' : 'DATA PAUSED'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MetricChart
            title="Cluster CPU Utilization"
            data={cpuTrend}
            unit="%"
            color="blue"
            height={170}
          />
          <MetricChart
            title="Cluster RAM Utilization"
            data={memTrend}
            unit="%"
            color="emerald"
            height={170}
          />
          <MetricChart
            title="Network RX Bandwidth"
            data={netRxTrend}
            unit="bytes"
            color="purple"
            height={170}
          />
          <MetricChart
            title="Network TX Bandwidth"
            data={netTxTrend}
            unit="bytes"
            color="amber"
            height={170}
          />
        </div>
      </div>

      {/* 8. Top Resource-Heavy Processes & Active Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel
          title="Top CPU / Memory Processes"
          meta="Live /proc snapshot from online nodes"
          className="lg:col-span-2"
          bodyClassName="px-3 sm:px-5"
        >
          {topProcesses.length === 0 ? (
            <div className="py-8 text-center text-dark-500 text-xs font-mono">
              <Terminal size={26} className="mx-auto mb-2 opacity-60" />
              Waiting for process telemetry from reporting nodes...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-dark-800 text-dark-500 text-[11px]">
                    <th className="pb-2 font-medium">Process</th>
                    <th className="pb-2 font-medium">Server</th>
                    <th className="pb-2 font-medium">PID</th>
                    <th className="pb-2 font-medium text-right">CPU %</th>
                    <th className="pb-2 font-medium text-right">MEM %</th>
                    <th className="pb-2 font-medium text-right">RSS</th>
                    <th className="pb-2 font-medium text-right">Threads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800/40">
                  {topProcesses.map((proc, idx) => (
                    <tr
                      key={`${proc.nodeId}-${proc.pid}-${idx}`}
                      className="hover:bg-dark-950/50 transition-colors"
                    >
                      <td className="py-2.5 font-bold text-white">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0" />
                          <span className="truncate max-w-[140px] sm:max-w-[200px]" title={proc.command || proc.name}>
                            {proc.name}
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 text-dark-400">
                        <button
                          onClick={() => onNavigateToNode && onNavigateToNode(proc.nodeId)}
                          className="hover:text-brand-400 transition-colors text-left"
                        >
                          {proc.nodeName}
                        </button>
                      </td>
                      <td className="py-2.5 text-dark-500">{proc.pid}</td>
                      <td className="py-2.5 text-right font-bold text-brand-400">
                        {formatPercent(proc.cpu)}
                      </td>
                      <td className="py-2.5 text-right text-emerald-400 font-bold">
                        {formatPercent(proc.mem)}
                      </td>
                      <td className="py-2.5 text-right text-dark-300">
                        {proc.memBytes ? formatBytes(proc.memBytes) : '—'}
                      </td>
                      <td className="py-2.5 text-right text-dark-500">
                        {proc.threads || 1}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Active Alerts"
          meta={`${summary?.recent_alerts?.length || 0} incidents`}
          actions={
            onNavigateToAlerts ? (
              <button
                onClick={onNavigateToAlerts}
                className="text-[11px] text-brand-400 hover:text-brand-300 flex items-center gap-1 font-medium font-mono"
              >
                View all <ArrowUpRight size={13} />
              </button>
            ) : null
          }
        >
          {!summary?.recent_alerts || summary.recent_alerts.length === 0 ? (
            <div className="py-8 text-center text-dark-400 text-xs font-mono">
              <CheckCircle2 size={26} className="mx-auto text-emerald-400 mb-2 opacity-80" />
              All monitored thresholds optimal. Zero active triggers.
            </div>
          ) : (
            <div className="space-y-2">
              {summary.recent_alerts.slice(0, 4).map((alert) => (
                <div
                  key={alert.id}
                  className="p-2.5 bg-dark-950 border border-dark-800 rounded-xl text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white truncate">
                      {alert.rule_name || 'System Alert'}
                    </span>
                    <button
                      onClick={() => handleAck(alert.id)}
                      className="px-2 py-0.5 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded text-[10px] font-medium transition-colors shrink-0"
                    >
                      Ack
                    </button>
                  </div>
                  <p className="text-[11px] text-dark-400">{alert.message}</p>
                  <div className="text-[10px] text-dark-500 font-mono flex justify-between gap-2">
                    <span className="truncate">{alert.node_name}</span>
                    <span className="shrink-0">{timeAgo(alert.triggered_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-dark-800 mt-4 flex items-center justify-between text-[11px] text-dark-500 font-mono">
            <span>Kernel Telemetry</span>
            <span className={clusterFreshness.isLive ? 'text-emerald-400' : 'text-amber-400'}>
              {clusterFreshness.text}
            </span>
          </div>
        </Panel>
      </div>

      {isAddNodeOpen && (
        <AddNodeModal
          isOpen={isAddNodeOpen}
          onClose={() => setIsAddNodeOpen(false)}
          onNodeCreated={() => loadData(true)}
        />
      )}
    </div>
  );
}
