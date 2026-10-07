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
} from 'lucide-react';

const SAMPLE_MS = 5000;
const TREND_LIMIT = 120; // 5s x 120 = rolling 10 minute buffer
const FRESH_WINDOW_S = 180;

const mean = (values) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

const fmtLoad = (v) => (v === null || v === undefined ? 'Unavailable' : v.toFixed(2));

export default function Dashboard({ onNavigateToNode, onNavigateToAlerts }) {
  const [summary, setSummary] = useState(null);
  const [nodesList, setNodesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isLive, setIsLive] = useState(wsService.isConnected);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [isAddNodeOpen, setIsAddNodeOpen] = useState(false);
  const [copiedIp, setCopiedIp] = useState(null);

  // Real-time trend buffers fed by the sampler below
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

  // Rolling cluster-average sampler: every point is the real mean of the
  // nodes that are online at that moment, never an invented value.
  const sampleCluster = () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = (m) => !m.timestamp || now - m.timestamp <= FRESH_WINDOW_S;
    const online = nodesRef.current.filter(
      (n) => n.status === 'online' && n.latest_metrics && fresh(n.latest_metrics)
    );

    if (online.length === 0) return;

    const cpu = mean(online.map((n) => n.latest_metrics.cpu));
    const mem = mean(online.map((n) => n.latest_metrics.memory));
    const rx = online.reduce((s, n) => s + (n.latest_metrics.network_rx || 0), 0);
    const tx = online.reduce((s, n) => s + (n.latest_metrics.network_tx || 0), 0);

    setCpuTrend((prev) => [...prev, { timestamp: now, value: cpu }].slice(-TREND_LIMIT));
    setMemTrend((prev) => [...prev, { timestamp: now, value: mem }].slice(-TREND_LIMIT));
    setNetRxTrend((prev) => [...prev, { timestamp: now, value: rx }].slice(-TREND_LIMIT));
    setNetTxTrend((prev) => [...prev, { timestamp: now, value: tx }].slice(-TREND_LIMIT));
  };

  useEffect(() => {
    loadData();

    const sampleInterval = setInterval(sampleCluster, SAMPLE_MS);
    const pollInterval = setInterval(() => loadData(), 10000);

    const unsubLive = wsService.subscribe('connection_status', (data) => {
      setIsLive(Boolean(data && data.connected));
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
            last_seen: new Date().toISOString(),
            latest_payload: { ...node.latest_payload, ...p },
            latest_metrics: {
              ...prevMetrics,
              cpu: p.cpu,
              memory: p.memory,
              disk: p.disk,
              load1: p.load1,
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
        prev.map((n) => (n.id === event.node_id ? { ...n, status: event.status } : n))
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

  const filteredNodes = useMemo(() => {
    return nodesList.filter((node) => {
      const matchesSearch =
        !searchQuery ||
        node.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.hostname?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.ip_address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (node.tags && node.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'online' && node.status === 'online') ||
        (statusFilter === 'offline' && node.status === 'offline') ||
        (statusFilter === 'warning' && node.status === 'warning');

      return matchesSearch && matchesStatus;
    });
  }, [nodesList, searchQuery, statusFilter]);

  // Everything below is derived exclusively from the real agent payloads of
  // online nodes. Missing collectors resolve to `null` -> "Unavailable".
  const fleet = useMemo(() => {
    const statusCount = (status) =>
      nodesList.filter((n) => n.status === status).length;

    const onlineNodes = nodesList.filter((n) => n.status === 'online');
    const payloads = onlineNodes
      .filter((n) => n.latest_payload)
      .map((n) => ({ name: n.name, p: n.latest_payload }));

    const collectorOk =
      (name) =>
      ({ p }) =>
        p.collectors?.[name]?.status === 'ok';
    const sum = (items, pick) => items.reduce((s, item) => s + (pick(item) || 0), 0);

    // CPU ---------------------------------------------------------------
    const cpuNodes = payloads.filter(collectorOk('cpu'));
    const cores = sum(cpuNodes, ({ p }) => p.cpu_count);
    const splitOf = (p) =>
      (p.cpu_user || 0) +
      (p.cpu_system || 0) +
      (p.cpu_idle || 0) +
      (p.cpu_iowait || 0) +
      (p.cpu_steal || 0);
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

    const withMetrics = onlineNodes.filter((n) => n.latest_metrics);
    const peakCpu =
      withMetrics
        .map((n) => ({ name: n.name, value: n.latest_metrics.cpu }))
        .sort((a, b) => b.value - a.value)[0] || null;

    // Memory ------------------------------------------------------------
    const memNodes = payloads.filter(({ p }) => (p.mem_total_bytes || 0) > 0);
    const memTotal = sum(memNodes, ({ p }) => p.mem_total_bytes);
    const memUsed = sum(memNodes, ({ p }) => p.mem_used_bytes);
    const memFree = sum(memNodes, ({ p }) => p.mem_free_bytes);
    const memAvail = sum(memNodes, ({ p }) => p.mem_avail_bytes);
    const memReclaim = Math.max(memAvail - memFree, 0);
    const swapTotal = sum(memNodes, ({ p }) => p.swap_total_bytes);
    const swapUsed = sum(memNodes, ({ p }) => p.swap_used_bytes);

    // Storage -----------------------------------------------------------
    const diskNodes = payloads.filter(({ p }) => (p.disk_total_bytes || 0) > 0);
    const diskTotal = sum(diskNodes, ({ p }) => p.disk_total_bytes);
    const diskUsed = sum(diskNodes, ({ p }) => p.disk_used_bytes);
    const ioNodes = payloads.filter(collectorOk('disk'));
    const diskRead = sum(ioNodes, ({ p }) => p.disk_read_bytes_sec);
    const diskWrite = sum(ioNodes, ({ p }) => p.disk_write_bytes_sec);

    // Load --------------------------------------------------------------
    const loadNodes = payloads.filter(({ p }) => p.load?.available);
    const load1 = mean(loadNodes.map(({ p }) => p.load.load1));
    const load5 = mean(loadNodes.map(({ p }) => p.load.load5));
    const load15 = mean(loadNodes.map(({ p }) => p.load.load15));

    // Thermal -----------------------------------------------------------
    const thermalReadings = withMetrics
      .filter((n) => n.latest_metrics.is_thermal_available && n.latest_metrics.temperature != null)
      .map((n) => ({ name: n.name, value: n.latest_metrics.temperature }));
    const peakTemp = thermalReadings.length
      ? thermalReadings.sort((a, b) => b.value - a.value)[0]
      : null;
    const thermalReason =
      payloads
        .find(
          ({ p }) =>
            p.collectors?.temperature?.status &&
            p.collectors.temperature.status !== 'ok'
        )
        ?.p.collectors.temperature.message || 'No hardware sensor reported';

    // Processes ---------------------------------------------------------
    const procNodes = payloads
      .filter(collectorOk('processes'))
      .filter(({ p }) => (p.processes?.total || 0) > 0);
    const procsTotal = sum(procNodes, ({ p }) => p.processes.total);
    const procsRunning = sum(procNodes, ({ p }) => p.processes.running);

    // Uptime ------------------------------------------------------------
    const upNodes = payloads.filter(({ p }) => (p.uptime_seconds || 0) > 0);
    const longestUptime = upNodes.length
      ? upNodes
          .map(({ name, p }) => ({ name, value: p.uptime_seconds }))
          .sort((a, b) => b.value - a.value)[0]
      : null;

    return {
      total: nodesList.length,
      online: statusCount('online'),
      offline: statusCount('offline'),
      warning: statusCount('warning'),
      disabled: nodesList.filter((n) => n.disabled).length,
      cores,
      cpuSplit,
      peakCpu,
      memNodes: memNodes.length,
      memTotal,
      memUsed,
      memFree,
      memReclaim,
      swapTotal,
      swapUsed,
      diskNodes: diskNodes.length,
      diskTotal,
      diskUsed,
      diskRead,
      diskWrite,
      loadNodes: loadNodes.length,
      load1,
      load5,
      load15,
      peakTemp,
      thermalReason,
      procsTotal,
      procsRunning,
      procNodes: procNodes.length,
      longestUptime,
    };
  }, [nodesList]);

  const topProcesses = useMemo(() => {
    const list = [];
    nodesList.forEach((node) => {
      const payload = node.latest_payload;
      if (payload && payload.processes && Array.isArray(payload.processes.top_cpu)) {
        payload.processes.top_cpu.slice(0, 3).forEach((proc) => {
          list.push({
            nodeName: node.name,
            nodeId: node.id,
            pid: proc.pid,
            name: proc.name,
            user: proc.user,
            cpu: proc.cpu_percent,
            mem: proc.memory_percent,
            state: proc.state,
          });
        });
      }
    });
    return list.sort((a, b) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 6);
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
        <h3 className="text-base font-semibold text-white">Dashboard Offline</h3>
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

  const onlineNodes = summary?.online_nodes || 0;
  const noTelemetry = onlineNodes === 0;
  const isHealthy =
    (summary?.offline_nodes || 0) === 0 &&
    (summary?.warning_nodes || 0) === 0 &&
    (summary?.active_alerts || 0) === 0;

  const activeTotal = (summary?.total_nodes || 0) - (summary?.disabled_nodes || 0);
  const healthPct =
    activeTotal > 0 ? (onlineNodes / activeTotal) * 100 : null;
  const healthVariant =
    (summary?.offline_nodes || 0) > 0 && (summary?.warning_nodes || 0) > 0
      ? 'rose'
      : (summary?.offline_nodes || 0) > 0 ||
          (summary?.warning_nodes || 0) > 0 ||
          (summary?.active_alerts || 0) > 0
        ? 'amber'
        : 'emerald';

  const cpuSplitSegments = fleet.cpuSplit
    ? [
        { label: 'User', value: fleet.cpuSplit.user, color: '#3b82f6', display: `${fleet.cpuSplit.user.toFixed(1)}%` },
        { label: 'System', value: fleet.cpuSplit.system, color: '#06b6d4', display: `${fleet.cpuSplit.system.toFixed(1)}%` },
        { label: 'I/O wait', value: fleet.cpuSplit.iowait, color: '#f59e0b', display: `${fleet.cpuSplit.iowait.toFixed(1)}%` },
        { label: 'Steal', value: fleet.cpuSplit.steal, color: '#a855f7', display: `${fleet.cpuSplit.steal.toFixed(1)}%` },
        { label: 'Idle', value: fleet.cpuSplit.idle, color: '#475569', display: `${fleet.cpuSplit.idle.toFixed(1)}%` },
      ]
    : [];

  const memSegments = fleet.memTotal
    ? [
        { label: 'Used', value: fleet.memUsed, color: '#60a5fa', display: formatBytes(fleet.memUsed) },
        { label: 'Reclaimable', value: fleet.memReclaim, color: '#22d3ee', display: formatBytes(fleet.memReclaim) },
        { label: 'Free', value: fleet.memFree, color: '#475569', display: formatBytes(fleet.memFree) },
      ]
    : [];

  const statusChips = [
    { label: 'Online', value: summary?.online_nodes ?? 0, tone: 'text-emerald-400' },
    { label: 'Offline', value: summary?.offline_nodes ?? 0, tone: 'text-rose-400' },
    { label: 'Warning', value: summary?.warning_nodes ?? 0, tone: 'text-amber-400' },
    { label: 'Disabled', value: summary?.disabled_nodes ?? 0, tone: 'text-dark-300' },
    { label: 'Alerts', value: summary?.active_alerts ?? 0, tone: 'text-amber-400' },
  ];

  return (
    <div className="space-y-5">
      {/* 1. Command header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-5 py-4 rounded-2xl border border-dark-800/80 bg-dark-900 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg font-bold text-white tracking-tight">
              Infrastructure Command Center
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border font-mono ${
                isLive
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              {isLive ? 'LIVE STREAM' : 'RECONNECTING'}
            </span>
          </div>
          <p className="text-xs text-dark-400 mt-1 font-mono">
            Direct agent telemetry · no synthetic or estimated values
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

      {/* 2. Cluster health strip */}
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
              {isHealthy
                ? 'All monitored systems operational'
                : 'Infrastructure requires attention'}
            </h3>
            <p className="text-xs text-dark-400 mt-0.5 font-mono truncate">
              {onlineNodes} of {summary?.total_nodes || 0} nodes reporting heartbeats
              {summary?.active_alerts > 0 && ` · ${summary.active_alerts} active alert(s)`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-6 gap-y-2">
          {statusChips.map((chip) => (
            <div key={chip.label} className="text-right sm:text-center">
              <div className={`text-lg font-bold font-mono tabular-nums leading-none ${chip.tone}`}>
                {chip.value}
              </div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-dark-500 mt-1">
                {chip.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Primary gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GaugeCard
          title="Cluster CPU"
          meta={fleet.cores > 0 ? `${fleet.cores} cores` : `${fleet.online} nodes`}
          value={noTelemetry ? null : summary?.avg_cpu ?? null}
          unit="%"
          caption="FLEET AVG"
          variant="blue"
          thresholds={{ warn: 70, crit: 85 }}
          unavailable={noTelemetry}
          unavailableNote="NO NODES ONLINE"
          rows={[
            {
              label: 'Peak node',
              value: fleet.peakCpu
                ? `${fleet.peakCpu.name} · ${formatPercent(fleet.peakCpu.value)}`
                : 'Unavailable',
              tone: fleet.peakCpu ? 'text-amber-400' : 'text-dark-500',
            },
            {
              label: 'Reporting',
              value: `${fleet.online} / ${fleet.total} nodes`,
            },
          ]}
        />

        <GaugeCard
          title="Memory"
          meta={fleet.memNodes > 0 ? `${fleet.memNodes} nodes` : 'no payload'}
          value={noTelemetry ? null : summary?.avg_memory ?? null}
          unit="%"
          caption="FLEET AVG"
          variant="cyan"
          thresholds={{ warn: 75, crit: 90 }}
          unavailable={noTelemetry}
          unavailableNote="NO NODES ONLINE"
          rows={[
            {
              label: 'Used / Total',
              value: fleet.memTotal
                ? `${formatBytes(fleet.memUsed)} / ${formatBytes(fleet.memTotal)}`
                : 'Unavailable',
            },
            {
              label: 'Swap',
              value: fleet.swapTotal
                ? `${formatBytes(fleet.swapUsed)} / ${formatBytes(fleet.swapTotal)}`
                : 'Not configured',
              tone: fleet.swapTotal ? 'text-dark-100' : 'text-dark-500',
            },
          ]}
        />

        <GaugeCard
          title="Storage"
          meta={fleet.diskNodes > 0 ? `${fleet.diskNodes} nodes` : 'no payload'}
          value={noTelemetry ? null : summary?.avg_disk ?? null}
          unit="%"
          caption="FLEET AVG"
          variant="purple"
          thresholds={{ warn: 75, crit: 90 }}
          unavailable={noTelemetry}
          unavailableNote="NO NODES ONLINE"
          rows={[
            {
              label: 'Used / Total',
              value: fleet.diskTotal
                ? `${formatBytes(fleet.diskUsed)} / ${formatBytes(fleet.diskTotal)}`
                : 'Unavailable',
            },
            {
              label: 'Disk read',
              value: fleet.diskNodes ? formatNetworkSpeed(fleet.diskRead) : 'Unavailable',
            },
            {
              label: 'Disk write',
              value: fleet.diskNodes ? formatNetworkSpeed(fleet.diskWrite) : 'Unavailable',
            },
          ]}
        />

        <GaugeCard
          title="Fleet health"
          meta={`${summary?.disabled_nodes || 0} disabled`}
          value={healthPct}
          unit="%"
          caption="ONLINE RATIO"
          variant={healthVariant}
          thresholds={null}
          zones={false}
          unavailable={healthPct === null}
          unavailableNote="NO ACTIVE NODES"
          rows={[
            {
              label: 'Offline',
              value: `${summary?.offline_nodes || 0} node(s)`,
              tone: (summary?.offline_nodes || 0) > 0 ? 'text-rose-400' : 'text-emerald-400',
            },
            {
              label: 'Active alerts',
              value: `${summary?.active_alerts || 0}`,
              tone: (summary?.active_alerts || 0) > 0 ? 'text-amber-400' : 'text-emerald-400',
            },
          ]}
        />
      </div>

      {/* 4. Cluster telemetry readouts */}
      <Panel
        title="Cluster telemetry"
        meta="summed / averaged across online agent payloads"
        bodyClassName="px-3 sm:px-5"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-6">
          <Readout
            label="Network in"
            icon={ArrowDown}
            value={noTelemetry ? 'Unavailable' : formatNetworkSpeed(summary?.total_network_rx)}
            sub="aggregate rx"
            tone="text-emerald-400"
          />
          <Readout
            label="Network out"
            icon={ArrowUp}
            value={noTelemetry ? 'Unavailable' : formatNetworkSpeed(summary?.total_network_tx)}
            sub="aggregate tx"
            tone="text-blue-400"
          />
          <Readout
            label="Load avg 1m"
            icon={Gauge}
            value={fmtLoad(fleet.load1)}
            sub={
              fleet.loadNodes
                ? `5m ${fleet.load5.toFixed(2)} · 15m ${fleet.load15.toFixed(2)} · ${fleet.loadNodes} nodes`
                : 'no node reports load'
            }
            tone="text-white"
          />
          <Readout
            label="Peak temp"
            icon={Thermometer}
            value={fleet.peakTemp ? `${fleet.peakTemp.value.toFixed(1)}°C` : 'Unavailable'}
            sub={fleet.peakTemp ? fleet.peakTemp.name : fleet.thermalReason}
            tone="text-amber-400"
          />
          <Readout
            label="Processes"
            icon={Cpu}
            value={fleet.procNodes ? formatNumber(fleet.procsTotal) : 'Unavailable'}
            sub={fleet.procNodes ? `${formatNumber(fleet.procsRunning)} running` : 'no process data'}
            tone="text-white"
          />
          <Readout
            label="Active alerts"
            icon={ShieldAlert}
            value={summary?.active_alerts ?? 0}
            sub="triggered, not yet resolved"
            tone={(summary?.active_alerts || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}
          />
        </div>
      </Panel>

      {/* 5. Breakdown bars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="CPU time split"
          meta={fleet.cpuSplit ? `mean of ${fleet.cpuSplit.nodes} nodes` : 'awaiting sample'}
        >
          <SegmentBar
            segments={cpuSplitSegments}
            unavailableText="Unavailable — no node has reported a complete CPU delta yet"
          />
          <p className="mt-4 text-[10px] font-mono text-dark-500 leading-relaxed">
            user + system + iowait + steal + idle = 100% per node, computed from /proc/stat
            counter deltas since each agent started.
          </p>
        </Panel>

        <Panel
          title="Memory distribution"
          meta={fleet.memNodes ? `exact bytes · ${fleet.memNodes} nodes` : 'no payload'}
        >
          <SegmentBar
            segments={memSegments}
            unavailableText="Unavailable — no memory payload received yet"
          />
          <p className="mt-4 text-[10px] font-mono text-dark-500 leading-relaxed">
            used = total − available · reclaimable = available − free (buffers, cache, slab) ·
            values are byte sums from /proc/meminfo.
          </p>
        </Panel>
      </div>

      {/* 6. Live server fleet */}
      <Panel
        title={`Server fleet`}
        meta={`${filteredNodes.length} / ${nodesList.length} nodes`}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                type="text"
                placeholder="Search server, IP, tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 sm:w-56 bg-dark-950 border border-dark-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-dark-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex items-center bg-dark-950 p-1 rounded-xl border border-dark-800 text-[11px] font-medium">
              {[
                { id: 'all', label: 'All' },
                { id: 'online', label: 'Online' },
                { id: 'offline', label: 'Offline' },
                { id: 'warning', label: 'Warning' },
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
              const isOnline = node.status === 'online';
              const m = node.latest_metrics || {};
              const cpuVal = m.cpu ?? 0;
              const memVal = m.memory ?? 0;
              const diskVal = m.disk ?? 0;
              const isMaster =
                node.tags?.includes('master') || node.name?.toLowerCase().includes('master');

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
                            isOnline ? 'bg-emerald-500' : 'bg-rose-500'
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
                          {isMaster && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              MASTER
                            </span>
                          )}
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
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {node.status?.toUpperCase()}
                    </span>
                  </div>

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

                  <div className="pt-2.5 border-t border-dark-800/60 flex items-center justify-between gap-2 text-[11px] text-dark-400 font-mono">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex items-center gap-0.5 text-emerald-400">
                        <ArrowDown size={11} />
                        {formatNetworkSpeed(m.network_rx ?? 0)}
                      </span>
                      <span className="flex items-center gap-0.5 text-blue-400">
                        <ArrowUp size={11} />
                        {formatNetworkSpeed(m.network_tx ?? 0)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-dark-500">
                        {m.uptime_seconds ? formatUptime(m.uptime_seconds) : '—'}
                      </span>
                      <span className="flex items-center gap-0.5 text-dark-500 group-hover:text-brand-400 transition-colors">
                        Inspect <ArrowUpRight size={12} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* 7. Live telemetry charts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dark-400">
              Live cluster telemetry
            </h2>
            <span className="text-[10px] font-mono text-dark-500">
              5s sampling · rolling {Math.round((SAMPLE_MS / 1000) * TREND_LIMIT / 60)} min buffer
            </span>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
              isLive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-dark-800 text-dark-400 border-dark-700'
            }`}
          >
            {isLive ? 'STREAMING' : 'PAUSED'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MetricChart
            title="Cluster CPU utilization"
            data={cpuTrend}
            unit="%"
            color="blue"
            height={170}
          />
          <MetricChart
            title="Cluster RAM utilization"
            data={memTrend}
            unit="%"
            color="emerald"
            height={170}
          />
          <MetricChart
            title="Network RX"
            data={netRxTrend}
            unit="bytes"
            color="purple"
            height={170}
          />
          <MetricChart
            title="Network TX"
            data={netTxTrend}
            unit="bytes"
            color="amber"
            height={170}
          />
        </div>
      </div>

      {/* 8. Processes & alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel
          title="Top resource-heavy processes"
          meta="live payload snapshot"
          className="lg:col-span-2"
          bodyClassName="px-3 sm:px-5"
        >
          {topProcesses.length === 0 ? (
            <div className="py-8 text-center text-dark-500 text-xs font-mono">
              <Terminal size={26} className="mx-auto mb-2 opacity-60" />
              Waiting for process telemetry from online nodes...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-dark-800 text-dark-500 text-[11px]">
                    <th className="pb-2 font-medium">Process</th>
                    <th className="pb-2 font-medium">Server</th>
                    <th className="pb-2 font-medium">PID</th>
                    <th className="pb-2 font-medium">User</th>
                    <th className="pb-2 font-medium text-right">CPU %</th>
                    <th className="pb-2 font-medium text-right">MEM %</th>
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
                          <span className="truncate max-w-[140px] sm:max-w-[200px]">
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
                      <td className="py-2.5 text-dark-400">{proc.user || 'root'}</td>
                      <td className="py-2.5 text-right font-bold text-brand-400">
                        {formatPercent(proc.cpu)}
                      </td>
                      <td className="py-2.5 text-right text-emerald-400 font-bold">
                        {formatPercent(proc.mem)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Active alerts"
          meta={`${summary?.recent_alerts?.length || 0} recent`}
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
              All thresholds optimal. No active triggers.
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
            <span>Heartbeat poll 10s</span>
            <span className={isLive ? 'text-emerald-400' : 'text-amber-400'}>
              {isLive ? 'WebSocket live' : 'Polling only'}
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
