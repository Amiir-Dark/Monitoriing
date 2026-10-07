import { useState, useEffect, useMemo } from 'react';
import {
  getNode,
  getNodeMetrics,
  getNodeProcesses,
  getNodeNetwork,
  getNodeServices,
  getNodeDocker,
  getNodeLogs,
  getNodeAlerts,
  rotateNodeToken,
  disableNode,
  enableNode,
  deleteNode,
  acknowledgeAlert,
  resolveAlert,
} from '../services/api';
import { wsService } from '../services/ws';
import NodeStatusBadge from '../components/common/NodeStatusBadge';
import MetricChart from '../components/charts/MetricChart';
import Panel from '../components/common/Panel';
import Readout from '../components/common/Readout';
import { RadialSpeedometer, MiniRadialGauge, SegmentBar } from '../components/gauge';
import {
  formatPercent,
  formatBytes,
  formatNetworkSpeed,
  formatNumber,
  formatUptime,
  timeAgo,
  formatDate,
  formatLatency,
  formatIOPS,
  formatPacketRate,
  formatDataFreshness,
} from '../utils/formatters';
import {
  ArrowLeft,
  Power,
  Trash2,
  Cpu,
  Layers,
  HardDrive,
  Activity,
  Check,
  Copy,
  AlertTriangle,
  Key,
  Thermometer,
  Server,
  Network,
  Clock,
  ShieldAlert,
  Terminal,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Box,
  FileText,
  Search,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Gauge,
  Info,
  Sliders,
} from 'lucide-react';

export default function NodeDetail({ nodeId, onBack }) {
  const [node, setNode] = useState(null);
  const [processesData, setProcessesData] = useState({ top_processes: [], breakdown: {} });
  const [networkData, setNetworkData] = useState(null);
  const [services, setServices] = useState([]);
  const [dockerData, setDockerData] = useState({ available: false, message: 'Loading Docker status...', containers: [] });
  const [logs, setLogs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedToken, setCopiedToken] = useState(false);
  const [rotatedTokenData, setRotatedTokenData] = useState(null);
  const [showInstallModal, setShowInstallModal] = useState(false);

  // 10 Tabs: Overview, Metrics, Processes, Network, Disks, Services, Docker, Logs, Alerts, System
  const [activeTab, setActiveTab] = useState('overview');

  // Historical Charts State across 8 ranges
  const [chartWindow, setChartWindow] = useState('1h');
  const [chartsLoading, setChartsLoading] = useState(false);
  const [cpuSeries, setCpuSeries] = useState([]);
  const [memSeries, setMemSeries] = useState([]);
  const [diskSeries, setDiskSeries] = useState([]);
  const [netRxSeries, setNetRxSeries] = useState([]);
  const [netTxSeries, setNetTxSeries] = useState([]);
  const [loadSeries, setLoadSeries] = useState([]);
  const [tcpSeries, setTcpSeries] = useState([]);
  const [dropsSeries, setDropsSeries] = useState([]);
  const [procCountSeries, setProcCountSeries] = useState([]);

  // Filters for sub-tabs
  const [processSearch, setProcessSearch] = useState('');
  const [processSort, setProcessSort] = useState('cpu'); // cpu, mem, read, write, pid
  const [serviceFilter, setServiceFilter] = useState('all'); // all, running, stopped, failed
  const [logLevelFilter, setLogLevelFilter] = useState('all'); // all, error, warning, info
  const [logSearch, setLogSearch] = useState('');

  const loadNodeDetails = async () => {
    try {
      const [n, p, net, s, d, l, a] = await Promise.all([
        getNode(nodeId),
        getNodeProcesses(nodeId).catch(() => ({ top_processes: [], breakdown: {} })),
        getNodeNetwork(nodeId).catch(() => null),
        getNodeServices(nodeId).catch(() => []),
        getNodeDocker(nodeId).catch(() => ({ available: false, message: 'Docker not detected', containers: [] })),
        getNodeLogs(nodeId, 100).catch(() => []),
        getNodeAlerts(nodeId).catch(() => []),
      ]);
      setNode(n);
      setProcessesData(p || { top_processes: [], breakdown: {} });
      setNetworkData(net);
      setServices(Array.isArray(s) ? s : []);
      setDockerData(d || { available: false, message: 'Docker not detected', containers: [] });
      setLogs(Array.isArray(l) ? l : []);
      setAlerts(Array.isArray(a) ? a : []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to fetch node details');
    } finally {
      setLoading(false);
    }
  };

  const loadMetrics = async (window) => {
    setChartsLoading(true);
    try {
      const [cpu, mem, disk, rx, tx, ld, tcp, drops, procs] = await Promise.all([
        getNodeMetrics(nodeId, 'cpu', window).catch(() => []),
        getNodeMetrics(nodeId, 'memory', window).catch(() => []),
        getNodeMetrics(nodeId, 'disk', window).catch(() => []),
        getNodeMetrics(nodeId, 'network_rx', window).catch(() => []),
        getNodeMetrics(nodeId, 'network_tx', window).catch(() => []),
        getNodeMetrics(nodeId, 'load1', window).catch(() => []),
        getNodeMetrics(nodeId, 'tcp_conns', window).catch(() => []),
        getNodeMetrics(nodeId, 'network_drops', window).catch(() => []),
        getNodeMetrics(nodeId, 'processes', window).catch(() => []),
      ]);
      setCpuSeries(cpu || []);
      setMemSeries(mem || []);
      setDiskSeries(disk || []);
      setNetRxSeries(rx || []);
      setNetTxSeries(tx || []);
      setLoadSeries(ld || []);
      setTcpSeries(tcp || []);
      setDropsSeries(drops || []);
      setProcCountSeries(procs || []);
    } catch {
      // metric load errors handled gracefully
    } finally {
      setChartsLoading(false);
    }
  };

  useEffect(() => {
    loadNodeDetails();
    loadMetrics(chartWindow);
  }, [nodeId]);

  useEffect(() => {
    loadMetrics(chartWindow);
  }, [chartWindow]);

  // Live WebSocket Telemetry Stream
  useEffect(() => {
    const unsub = wsService.subscribe('node_metrics', (event) => {
      if (event?.node_id === nodeId && event.metrics) {
        const m = event.metrics;
        const now = m.timestamp || Math.floor(Date.now() / 1000);

        setNode((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: 'online',
            connection_state: 'ONLINE',
            last_seen: new Date().toISOString(),
            latest_payload: { ...prev.latest_payload, ...m },
            latest_metrics: {
              ...prev.latest_metrics,
              cpu: m.cpu,
              memory: m.memory,
              disk: m.disk,
              load1: m.load1 ?? m.load?.load1,
              network_rx: m.network_rx,
              network_tx: m.network_tx,
              temperature: m.temperature,
              uptime_seconds: m.uptime_seconds,
              is_thermal_available: m.temperature !== null && m.temperature !== undefined,
              is_load_available: m.load?.available ?? true,
            },
          };
        });

        // Update real-time 1h buffer without full reload
        if (chartWindow === '1h' || chartWindow === '1m' || chartWindow === '5m') {
          if (m.cpu !== undefined) setCpuSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.cpu }]);
          if (m.memory !== undefined) setMemSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.memory }]);
          if (m.disk !== undefined) setDiskSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.disk }]);
          if (m.network_rx !== undefined) setNetRxSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.network_rx }]);
          if (m.network_tx !== undefined) setNetTxSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.network_tx }]);
          if (m.load1 !== undefined || m.load?.load1 !== undefined) {
            setLoadSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.load1 ?? m.load?.load1 }]);
          }
        }

        // Live update services & processes if present in payload
        if (m.services && Array.isArray(m.services) && m.services.length > 0) {
          setServices(m.services);
        }
        if (m.top_processes && Array.isArray(m.top_processes)) {
          setProcessesData((prev) => ({ ...prev, top_processes: m.top_processes }));
        }
        if (m.docker) {
          setDockerData(m.docker);
        }
      }
    });

    const unsubAlert = wsService.subscribe('alert_triggered', (ev) => {
      if (ev?.node_id === nodeId) loadNodeDetails();
    });
    const unsubResolved = wsService.subscribe('alert_resolved', (ev) => {
      if (ev?.node_id === nodeId) loadNodeDetails();
    });

    return () => {
      unsub();
      unsubAlert();
      unsubResolved();
    };
  }, [nodeId, chartWindow]);

  const handleRotateToken = async () => {
    if (!window.confirm('Rotate agent authentication token? The previous token will be revoked immediately.')) {
      return;
    }
    try {
      const data = await rotateNodeToken(nodeId);
      setRotatedTokenData(data);
    } catch (err) {
      alert('Error rotating token: ' + err.message);
    }
  };

  const handleToggleDisabled = async () => {
    try {
      if (node.disabled) {
        await enableNode(nodeId);
      } else {
        await disableNode(nodeId);
      }
      loadNodeDetails();
    } catch (err) {
      alert('Error changing node status: ' + err.message);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete server ${node.name}? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteNode(nodeId);
      onBack();
    } catch (err) {
      alert('Error deleting node: ' + err.message);
    }
  };

  const handleAckAlert = async (id) => {
    await acknowledgeAlert(id);
    loadNodeDetails();
  };

  const handleResolveAlert = async (id) => {
    await resolveAlert(id);
    loadNodeDetails();
  };

  // Filtered and sorted processes
  const sortedProcesses = useMemo(() => {
    const list = processesData?.top_processes || node?.latest_payload?.top_processes || [];
    const filtered = list.filter((p) => {
      if (!processSearch) return true;
      const q = processSearch.toLowerCase();
      return (
        p.name?.toLowerCase().includes(q) ||
        p.command?.toLowerCase().includes(q) ||
        String(p.pid).includes(q)
      );
    });

    return filtered.sort((a, b) => {
      if (processSort === 'cpu') return (b.cpu_percent || 0) - (a.cpu_percent || 0);
      if (processSort === 'mem') return (b.memory_bytes || 0) - (a.memory_bytes || 0);
      if (processSort === 'read') return (b.read_bytes_sec || 0) - (a.read_bytes_sec || 0);
      if (processSort === 'write') return (b.write_bytes_sec || 0) - (a.write_bytes_sec || 0);
      if (processSort === 'pid') return a.pid - b.pid;
      return 0;
    });
  }, [processesData, node, processSearch, processSort]);

  // Filtered services
  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      if (serviceFilter === 'all') return true;
      if (serviceFilter === 'running') return s.status === 'RUNNING';
      if (serviceFilter === 'stopped') return s.status === 'STOPPED';
      if (serviceFilter === 'failed') return s.status === 'FAILED';
      return true;
    });
  }, [services, serviceFilter]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    const list = logs.length > 0 ? logs : (node?.latest_payload?.logs || []);
    return list.filter((l) => {
      const matchesLevel = logLevelFilter === 'all' || l.level?.toLowerCase() === logLevelFilter.toLowerCase();
      const matchesQuery = !logSearch || l.message?.toLowerCase().includes(logSearch.toLowerCase()) || l.unit?.toLowerCase().includes(logSearch.toLowerCase());
      return matchesLevel && matchesQuery;
    });
  }, [logs, node, logLevelFilter, logSearch]);

  if (loading && !node) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 bg-dark-900 rounded-2xl border border-dark-800" />
        <div className="h-64 bg-dark-900 rounded-2xl border border-dark-800" />
      </div>
    );
  }

  if (error || !node) {
    return (
      <div className="p-8 bg-dark-900 border border-dark-800 rounded-2xl text-center">
        <AlertTriangle className="mx-auto text-rose-400 mb-2" size={32} />
        <h3 className="text-white font-semibold">Node Telemetry Unavailable</h3>
        <p className="text-xs text-dark-400 mt-1 mb-4 font-mono">{error}</p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-dark-800 text-white rounded-lg text-xs hover:bg-dark-700"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const p = node.latest_payload || {};
  const m = node.latest_metrics || {};

  // Truthful data freshness calculation
  const nodeTimestamp = p.timestamp || (node.last_seen ? Math.floor(new Date(node.last_seen).getTime() / 1000) : null);
  const freshness = formatDataFreshness(nodeTimestamp);

  // Exact 10 Tabs requested by specification
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'metrics', label: 'Metrics', icon: Activity },
    { id: 'processes', label: `Processes (${sortedProcesses.length})`, icon: Terminal },
    { id: 'network', label: `Network (${p.interfaces?.length || 0})`, icon: Network },
    { id: 'disks', label: `Disks (${p.mounts?.length || 0})`, icon: HardDrive },
    { id: 'services', label: `Services (${services.length})`, icon: Sliders },
    { id: 'docker', label: `Docker ${dockerData.available ? `(${dockerData.containers?.length || 0})` : ''}`, icon: Box },
    { id: 'logs', label: `Logs (${filteredLogs.length})`, icon: FileText },
    { id: 'alerts', label: `Alerts (${alerts.length})`, icon: ShieldAlert },
    { id: 'system', label: 'System', icon: Server },
  ];

  // CPU time split segments
  const cpuSplitSegments = p.cpu_user !== undefined
    ? [
        { label: 'User', value: p.cpu_user, color: '#3b82f6', display: `${p.cpu_user.toFixed(1)}%` },
        { label: 'System', value: p.cpu_system, color: '#06b6d4', display: `${p.cpu_system.toFixed(1)}%` },
        { label: 'I/O Wait', value: p.cpu_iowait || 0, color: '#f59e0b', display: `${(p.cpu_iowait || 0).toFixed(1)}%` },
        { label: 'Steal', value: p.cpu_steal || 0, color: '#a855f7', display: `${(p.cpu_steal || 0).toFixed(1)}%` },
        { label: 'Idle', value: p.cpu_idle, color: '#475569', display: `${p.cpu_idle.toFixed(1)}%` },
      ]
    : [];

  // Memory distribution segments
  const memSegments = p.mem_total_bytes
    ? [
        { label: 'Used', value: p.mem_used_bytes, color: '#60a5fa', display: formatBytes(p.mem_used_bytes) },
        { label: 'Cached', value: p.mem_cached_bytes || 0, color: '#22d3ee', display: formatBytes(p.mem_cached_bytes) },
        { label: 'Buffers', value: p.mem_buffers_bytes || 0, color: '#a78bfa', display: formatBytes(p.mem_buffers_bytes) },
        { label: 'Free', value: p.mem_free_bytes || 0, color: '#475569', display: formatBytes(p.mem_free_bytes) },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* 1. Server Detail Header: SERVER, IP, OS, STATUS, UPTIME, LAST SEEN */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xs">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-white mb-3 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Overview
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-white tracking-tight">SERVER: {node.name}</h2>
            <NodeStatusBadge status={node.status} disabled={node.disabled} size="lg" />
            {/* Freshness Badge */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border font-mono ${
                freshness.isLive
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : freshness.isStale
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${freshness.isLive ? 'bg-emerald-400 animate-pulse' : freshness.isStale ? 'bg-amber-400' : 'bg-rose-400'}`} />
              {freshness.lastKnown ? `LAST KNOWN DATA (${freshness.text})` : freshness.text}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-dark-400 font-mono mt-3">
            <span>IP: <strong className="text-dark-200">{node.ip_address || 'Unassigned'}</strong></span>
            <span>OS: <strong className="text-dark-200">{node.operating_system || node.distribution || 'Linux'}</strong></span>
            <span>STATUS: <strong className={freshness.isLive ? 'text-emerald-400' : 'text-amber-400'}>{node.connection_state || node.status?.toUpperCase()}</strong></span>
            <span>UPTIME: <strong className="text-emerald-400">{p.uptime_seconds ? formatUptime(p.uptime_seconds) : m.uptime_seconds ? formatUptime(m.uptime_seconds) : 'Unavailable'}</strong></span>
            <span>LAST SEEN: <strong className="text-dark-200">{freshness.text}</strong></span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
          <button
            onClick={() => setShowInstallModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-glow-brand transition-all"
          >
            <Terminal size={14} /> Agent Command
          </button>
          <button
            onClick={handleRotateToken}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl text-xs font-medium border border-dark-700 transition-colors"
          >
            <Key size={14} /> Rotate Token
          </button>
          <button
            onClick={handleToggleDisabled}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl text-xs font-medium border border-dark-700 transition-colors"
          >
            <Power size={14} /> {node.disabled ? 'Enable Node' : 'Disable Node'}
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl text-xs font-medium border border-rose-500/20 transition-colors"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* 2. Navigation Tabs (Exact 10 Tabs) */}
      <div className="flex border-b border-dark-800 overflow-x-auto gap-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                isActive
                  ? 'border-brand-500 text-white font-bold'
                  : 'border-transparent text-dark-400 hover:text-dark-200'
              }`}
            >
              <Icon size={14} className={isActive ? 'text-brand-400' : 'text-dark-500'} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================= */}
      {/* TAB 1: OVERVIEW */}
      {/* ========================================================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Cockpit Gauges */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-dark-800/80">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-cyan-400 animate-pulse" />
                <h3 className="text-sm font-bold text-white tracking-wide">
                  Real-Time Telemetry Gauges
                </h3>
              </div>
              <span className="text-[11px] font-mono text-dark-400">
                {freshness.text} · Source: {p.collectors ? 'Linux Virtual Filesystem' : 'Node Agent'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <RadialSpeedometer
                value={p.cpu ?? m.cpu ?? null}
                max={100}
                unit="%"
                title="CPU Util"
                sub={p.cpu_count ? `${p.cpu_count} Cores` : 'Kernel /proc/stat'}
                tone="blue"
              />
              <RadialSpeedometer
                value={p.memory ?? m.memory ?? null}
                max={100}
                unit="%"
                title="RAM Util"
                sub={p.mem_total_bytes ? formatBytes(p.mem_total_bytes) : 'Exact Bytes'}
                tone="cyan"
              />
              <RadialSpeedometer
                value={p.disk ?? m.disk ?? null}
                max={100}
                unit="%"
                title="Root Disk"
                sub={p.disk_total_bytes ? formatBytes(p.disk_total_bytes) : 'Root Filesystem'}
                tone="purple"
              />
              <RadialSpeedometer
                value={p.network_rx ?? m.network_rx ?? 0}
                max={Math.max((p.network_rx || 0) * 1.5, 1024 * 1024)}
                unit="bytes/s"
                title="Network In"
                sub="RX Bandwidth"
                tone="emerald"
              />
              <RadialSpeedometer
                value={p.network_tx ?? m.network_tx ?? 0}
                max={Math.max((p.network_tx || 0) * 1.5, 1024 * 1024)}
                unit="bytes/s"
                title="Network Out"
                sub="TX Bandwidth"
                tone="amber"
              />
            </div>
          </div>

          {/* Quick Metrics Readout */}
          <Panel title="Kernel Telemetry Overview" meta="Direct kernel telemetries">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-3">
              <Readout
                label="1m / 5m / 15m Load"
                icon={Gauge}
                value={p.load ? `${p.load.load1.toFixed(2)} · ${p.load.load5.toFixed(2)}` : (m.load1 !== undefined ? m.load1.toFixed(2) : 'Unavailable')}
                sub={p.load ? `15m: ${p.load.load15.toFixed(2)}` : 'Load averages'}
                tone="text-white"
              />
              <Readout
                label="CPU Frequency"
                icon={Cpu}
                value={p.cpu_freq_mhz ? `${(p.cpu_freq_mhz / 1000).toFixed(2)} GHz` : (node.cpu_freq_mhz ? `${(node.cpu_freq_mhz / 1000).toFixed(2)} GHz` : 'Unavailable')}
                sub={p.cpu_count ? `${p.cpu_count} logical cores` : 'Hardware frequency'}
                tone="text-blue-400"
              />
              <Readout
                label="Core Temp"
                icon={Thermometer}
                value={p.temperature !== null && p.temperature !== undefined ? `${p.temperature.toFixed(1)}°C` : 'Unavailable'}
                sub={p.temperature ? 'Thermal zone 0' : 'No hardware sensor'}
                tone="text-amber-400"
              />
              <Readout
                label="Disk I/O"
                icon={HardDrive}
                value={p.disk_read_bytes_sec !== undefined ? `${formatNetworkSpeed(p.disk_read_bytes_sec)} R` : 'Unavailable'}
                sub={p.disk_write_bytes_sec !== undefined ? `${formatNetworkSpeed(p.disk_write_bytes_sec)} W` : 'Throughput'}
                tone="text-purple-400"
              />
              <Readout
                label="TCP Sockets"
                icon={Network}
                value={p.tcp?.total !== undefined ? `${p.tcp.total} total` : 'Unavailable'}
                sub={p.tcp?.established !== undefined ? `${p.tcp.established} established` : 'Socket stats'}
                tone="text-emerald-400"
              />
              <Readout
                label="Active Alerts"
                icon={ShieldAlert}
                value={alerts.filter((a) => a.status === 'triggered').length}
                sub="Triggered on this node"
                tone={alerts.some((a) => a.status === 'triggered') ? 'text-rose-400' : 'text-emerald-400'}
              />
            </div>
          </Panel>

          {/* Allocation Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="CPU Time Split (/proc/stat)">
              <SegmentBar
                segments={cpuSplitSegments}
                unavailableText="CPU split telemetry unavailable"
              />
            </Panel>
            <Panel title="Memory Allocation (/proc/meminfo)">
              <SegmentBar
                segments={memSegments}
                unavailableText="Memory telemetry unavailable"
              />
            </Panel>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: METRICS (HISTORICAL TELEMETRY) */}
      {/* ========================================================= */}
      {activeTab === 'metrics' && (
        <div className="space-y-6">
          {/* Time Window Selector (All 8 ranges supported) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-dark-900 border border-dark-800 rounded-2xl">
            <div>
              <h3 className="text-sm font-bold text-white">Historical Telemetry Engine</h3>
              <p className="text-xs text-dark-400 font-mono mt-0.5">
                Stored samples and downsampled telemetry. Never fabricated or estimated.
              </p>
            </div>

            <div className="flex items-center gap-1 bg-dark-950 p-1 rounded-xl border border-dark-800 overflow-x-auto">
              {['1m', '5m', '15m', '1h', '6h', '24h', '7d', '30d'].map((w) => (
                <button
                  key={w}
                  onClick={() => setChartWindow(w)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded-lg transition-colors ${
                    chartWindow === w
                      ? 'bg-brand-600 text-white font-bold'
                      : 'text-dark-400 hover:text-white'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {/* 9 Major Historical Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricChart
              title="CPU Utilization"
              data={cpuSeries}
              unit="%"
              color="blue"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <MetricChart
              title="Memory Utilization"
              data={memSeries}
              unit="%"
              color="cyan"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <MetricChart
              title="Disk Utilization"
              data={diskSeries}
              unit="%"
              color="purple"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <MetricChart
              title="1-Minute Load Average"
              data={loadSeries}
              unit="load"
              color="amber"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <MetricChart
              title="Network RX Throughput"
              data={netRxSeries}
              unit="bytes"
              color="emerald"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <MetricChart
              title="Network TX Throughput"
              data={netTxSeries}
              unit="bytes"
              color="blue"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <MetricChart
              title="TCP Connections"
              data={tcpSeries}
              unit="sockets"
              color="cyan"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <MetricChart
              title="Packet Drops / Errors"
              data={dropsSeries}
              unit="drops/s"
              color="rose"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={200}
            />
            <div className="lg:col-span-2">
              <MetricChart
                title="Active Process Count"
                data={procCountSeries}
                unit="procs"
                color="purple"
                loading={chartsLoading}
                activeWindow={chartWindow}
                onWindowChange={setChartWindow}
                height={200}
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: PROCESSES */}
      {/* ========================================================= */}
      {activeTab === 'processes' && (
        <div className="space-y-4">
          {/* Top Consuming Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-dark-900 border border-dark-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-dark-500">Top CPU Consumer</span>
                <h4 className="text-base font-bold text-white mt-0.5 truncate max-w-[200px]">
                  {sortedProcesses[0]?.name || 'Unavailable'}
                </h4>
                <p className="text-xs text-dark-400 font-mono">PID {sortedProcesses[0]?.pid || '-'}</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold font-mono text-brand-400">
                  {formatPercent(sortedProcesses[0]?.cpu_percent)}
                </div>
                <div className="text-[11px] text-dark-500 font-mono">
                  {sortedProcesses[0]?.threads || 1} threads
                </div>
              </div>
            </div>

            <div className="p-4 bg-dark-900 border border-dark-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-dark-500">Top Memory Consumer</span>
                {(() => {
                  const topMem = [...sortedProcesses].sort((a, b) => (b.memory_bytes || 0) - (a.memory_bytes || 0))[0];
                  return (
                    <>
                      <h4 className="text-base font-bold text-white mt-0.5 truncate max-w-[200px]">
                        {topMem?.name || 'Unavailable'}
                      </h4>
                      <p className="text-xs text-dark-400 font-mono">PID {topMem?.pid || '-'}</p>
                    </>
                  );
                })()}
              </div>
              <div className="text-right">
                {(() => {
                  const topMem = [...sortedProcesses].sort((a, b) => (b.memory_bytes || 0) - (a.memory_bytes || 0))[0];
                  return (
                    <>
                      <div className="text-xl font-bold font-mono text-emerald-400">
                        {topMem?.memory_bytes ? formatBytes(topMem.memory_bytes) : formatPercent(topMem?.memory_percent)}
                      </div>
                      <div className="text-[11px] text-dark-500 font-mono">
                        {formatPercent(topMem?.memory_percent)} RAM
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Controls: Search & Sort */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-dark-900 border border-dark-800 rounded-2xl">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                type="text"
                placeholder="Search processes by name, command, PID..."
                value={processSearch}
                onChange={(e) => setProcessSearch(e.target.value)}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-dark-500 font-mono focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-dark-500">Sort by:</span>
              {[
                { id: 'cpu', label: 'CPU %' },
                { id: 'mem', label: 'Memory' },
                { id: 'read', label: 'Disk R' },
                { id: 'write', label: 'Disk W' },
                { id: 'pid', label: 'PID' },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setProcessSort(s.id)}
                  className={`px-2.5 py-1 rounded-lg border transition-colors ${
                    processSort === s.id
                      ? 'bg-brand-600/20 text-brand-400 border-brand-500/30 font-bold'
                      : 'bg-dark-950 text-dark-400 border-dark-800 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Process Table */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs">
            {sortedProcesses.length === 0 ? (
              <div className="py-12 text-center text-dark-500 text-xs font-mono">
                <Terminal size={32} className="mx-auto text-dark-600 mb-2 opacity-60" />
                No process telemetry reported for this node.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[11px] bg-dark-950/60">
                      <th className="py-2.5 px-4 font-medium">Process</th>
                      <th className="py-2.5 px-3 font-medium">PID</th>
                      <th className="py-2.5 px-3 font-medium text-right">CPU %</th>
                      <th className="py-2.5 px-3 font-medium text-right">MEM %</th>
                      <th className="py-2.5 px-3 font-medium text-right">RSS</th>
                      <th className="py-2.5 px-3 font-medium text-right">Threads</th>
                      <th className="py-2.5 px-3 font-medium text-right">Disk Read</th>
                      <th className="py-2.5 px-3 font-medium text-right">Disk Write</th>
                      <th className="py-2.5 px-4 font-medium">Command</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/40">
                    {sortedProcesses.map((proc, idx) => (
                      <tr key={`${proc.pid}-${idx}`} className="hover:bg-dark-950/40 transition-colors">
                        <td className="py-2.5 px-4 font-bold text-white">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0" />
                            <span className="truncate max-w-[160px]">{proc.name}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-dark-400">{proc.pid}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-brand-400">
                          {formatPercent(proc.cpu_percent)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                          {formatPercent(proc.memory_percent)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-dark-300">
                          {proc.memory_bytes ? formatBytes(proc.memory_bytes) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-dark-400">
                          {proc.threads || 1}
                        </td>
                        <td className="py-2.5 px-3 text-right text-dark-400">
                          {proc.read_bytes_sec ? formatNetworkSpeed(proc.read_bytes_sec) : '0 B/s'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-dark-400">
                          {proc.write_bytes_sec ? formatNetworkSpeed(proc.write_bytes_sec) : '0 B/s'}
                        </td>
                        <td className="py-2.5 px-4 text-dark-500 truncate max-w-[220px]" title={proc.command}>
                          {proc.command || proc.name}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 4: NETWORK */}
      {/* ========================================================= */}
      {activeTab === 'network' && (
        <div className="space-y-6">
          {/* Socket Summary & Retransmission Strip */}
          <div className="p-4 bg-dark-900 border border-dark-800 rounded-2xl grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <div className="text-dark-500">TCP Total / Established</div>
              <div className="text-base font-bold text-white mt-1">
                {p.tcp?.total ?? 'Unavailable'} / {p.tcp?.established ?? '-'}
              </div>
            </div>
            <div>
              <div className="text-dark-500">UDP Sockets</div>
              <div className="text-base font-bold text-cyan-400 mt-1">
                {p.tcp?.udp_total ?? 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="text-dark-500">TCP Retransmission Rate</div>
              <div className="text-base font-bold text-amber-400 mt-1">
                {p.tcp?.retrans_rate !== undefined ? `${p.tcp.retrans_rate.toFixed(2)}%` : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="text-dark-500">Total Retrans Segments</div>
              <div className="text-base font-bold text-dark-200 mt-1">
                {p.tcp?.retrans_total ? formatNumber(p.tcp.retrans_total) : '0'}
              </div>
            </div>
          </div>

          {/* Interfaces Table */}
          <Panel title="Network Interfaces" meta="Per-interface bandwidth and drops from /sys/class/net">
            {!p.interfaces || p.interfaces.length === 0 ? (
              <div className="py-8 text-center text-dark-500 text-xs font-mono">
                No per-interface telemetry available.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[11px]">
                      <th className="pb-2 font-medium">Interface</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Speed</th>
                      <th className="pb-2 font-medium text-right">RX Speed</th>
                      <th className="pb-2 font-medium text-right">TX Speed</th>
                      <th className="pb-2 font-medium text-right">RX Pkts/s</th>
                      <th className="pb-2 font-medium text-right">TX Pkts/s</th>
                      <th className="pb-2 font-medium text-right">Drops/s</th>
                      <th className="pb-2 font-medium text-right">Errors/s</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/40">
                    {p.interfaces.map((iface) => (
                      <tr key={iface.name} className="hover:bg-dark-950/40">
                        <td className="py-2.5 font-bold text-white flex items-center gap-2">
                          <Network size={14} className="text-brand-400" />
                          <span>{iface.name}</span>
                        </td>
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            iface.status === 'up' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-dark-800 text-dark-400'
                          }`}>
                            {iface.status?.toUpperCase() || 'UP'}
                          </span>
                        </td>
                        <td className="py-2.5 text-dark-400">
                          {iface.speed_mbps ? `${iface.speed_mbps} Mbps` : 'Virtual / Auto'}
                        </td>
                        <td className="py-2.5 text-right font-bold text-emerald-400">
                          {formatNetworkSpeed(iface.rx_bytes_sec)}
                        </td>
                        <td className="py-2.5 text-right font-bold text-blue-400">
                          {formatNetworkSpeed(iface.tx_bytes_sec)}
                        </td>
                        <td className="py-2.5 text-right text-dark-300">
                          {formatPacketRate(iface.rx_packets_sec)}
                        </td>
                        <td className="py-2.5 text-right text-dark-300">
                          {formatPacketRate(iface.tx_packets_sec)}
                        </td>
                        <td className="py-2.5 text-right">
                          <span className={(iface.rx_drops_sec || 0) + (iface.tx_drops_sec || 0) > 0 ? 'text-amber-400 font-bold' : 'text-dark-500'}>
                            {((iface.rx_drops_sec || 0) + (iface.tx_drops_sec || 0)).toFixed(0)}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className={(iface.rx_errors_sec || 0) + (iface.tx_errors_sec || 0) > 0 ? 'text-rose-400 font-bold' : 'text-dark-500'}>
                            {((iface.rx_errors_sec || 0) + (iface.tx_errors_sec || 0)).toFixed(0)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Historical RX/TX Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricChart
              title="Interface RX Historical Bandwidth"
              data={netRxSeries}
              unit="bytes"
              color="emerald"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={180}
            />
            <MetricChart
              title="Interface TX Historical Bandwidth"
              data={netTxSeries}
              unit="bytes"
              color="blue"
              loading={chartsLoading}
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              height={180}
            />
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 5: DISKS */}
      {/* ========================================================= */}
      {activeTab === 'disks' && (
        <div className="space-y-6">
          {/* Mounted Filesystems */}
          <Panel title="Mounted Filesystems" meta="All mounted storage partitions (/ , /home, /var, /tmp, etc.)">
            {!p.mounts || p.mounts.length === 0 ? (
              <div className="py-8 text-center text-dark-500 text-xs font-mono">
                No filesystem mount telemetry detected.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[11px]">
                      <th className="pb-2 font-medium">Mount Point</th>
                      <th className="pb-2 font-medium">Device</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium text-right">Total</th>
                      <th className="pb-2 font-medium text-right">Used</th>
                      <th className="pb-2 font-medium text-right">Available</th>
                      <th className="pb-2 font-medium text-right">Usage %</th>
                      <th className="pb-2 font-medium text-right">Inodes %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/40">
                    {p.mounts.map((m) => (
                      <tr key={m.mount_point} className="hover:bg-dark-950/40">
                        <td className="py-2.5 font-bold text-white flex items-center gap-2">
                          <HardDrive size={14} className="text-purple-400" />
                          <span>{m.mount_point}</span>
                        </td>
                        <td className="py-2.5 text-dark-400">{m.device}</td>
                        <td className="py-2.5 text-dark-500">{m.fs_type}</td>
                        <td className="py-2.5 text-right text-dark-300">{formatBytes(m.total_bytes)}</td>
                        <td className="py-2.5 text-right font-medium text-white">{formatBytes(m.used_bytes)}</td>
                        <td className="py-2.5 text-right text-dark-300">{formatBytes(m.avail_bytes)}</td>
                        <td className="py-2.5 text-right font-bold">
                          <span className={m.percent > 90 ? 'text-rose-400' : m.percent > 80 ? 'text-amber-400' : 'text-purple-400'}>
                            {formatPercent(m.percent)}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-dark-400">
                          {m.inodes_percent !== undefined ? formatPercent(m.inodes_percent) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Block Devices / Disk I/O */}
          <Panel title="Block Storage Devices & I/O" meta="IOPS and latency per physical block device (/proc/diskstats)">
            {!p.disk_io_devices || p.disk_io_devices.length === 0 ? (
              <div className="py-6 text-center text-dark-500 text-xs font-mono">
                No block device I/O telemetry reported.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[11px]">
                      <th className="pb-2 font-medium">Device</th>
                      <th className="pb-2 font-medium text-right">Read Speed</th>
                      <th className="pb-2 font-medium text-right">Write Speed</th>
                      <th className="pb-2 font-medium text-right">Read Ops/s</th>
                      <th className="pb-2 font-medium text-right">Write Ops/s</th>
                      <th className="pb-2 font-medium text-right">IOPS</th>
                      <th className="pb-2 font-medium text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/40">
                    {p.disk_io_devices.map((d) => (
                      <tr key={d.device_name} className="hover:bg-dark-950/40">
                        <td className="py-2.5 font-bold text-white">{d.device_name}</td>
                        <td className="py-2.5 text-right text-emerald-400">{formatNetworkSpeed(d.read_bytes_sec)}</td>
                        <td className="py-2.5 text-right text-purple-400">{formatNetworkSpeed(d.write_bytes_sec)}</td>
                        <td className="py-2.5 text-right text-dark-300">{d.read_ops_sec?.toFixed(1) || '0'}</td>
                        <td className="py-2.5 text-right text-dark-300">{d.write_ops_sec?.toFixed(1) || '0'}</td>
                        <td className="py-2.5 text-right font-bold text-white">{formatIOPS(d.iops)}</td>
                        <td className="py-2.5 text-right text-amber-400">{formatLatency(d.latency_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 6: SERVICES */}
      {/* ========================================================= */}
      {activeTab === 'services' && (
        <div className="space-y-4">
          {/* Service Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-dark-900 border border-dark-800 rounded-2xl">
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-dark-500">Filter:</span>
              {['all', 'running', 'stopped', 'failed'].map((sf) => (
                <button
                  key={sf}
                  onClick={() => setServiceFilter(sf)}
                  className={`px-3 py-1 rounded-lg border capitalize transition-colors ${
                    serviceFilter === sf
                      ? 'bg-brand-600/20 text-brand-400 border-brand-500/30 font-bold'
                      : 'bg-dark-950 text-dark-400 border-dark-800 hover:text-white'
                  }`}
                >
                  {sf}
                </button>
              ))}
            </div>

            <div className="text-xs font-mono text-dark-500">
              {filteredServices.length} of {services.length} services
            </div>
          </div>

          {/* Failed Services Alert Banner */}
          {services.some((s) => s.status === 'FAILED') && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-300 text-xs font-mono">
              <AlertTriangle size={18} className="text-rose-400 shrink-0" />
              <div>
                <strong>Warning:</strong> One or more systemd services on this server are in a FAILED state.
              </div>
            </div>
          )}

          {/* Services Table */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs">
            {filteredServices.length === 0 ? (
              <div className="py-12 text-center text-dark-500 text-xs font-mono">
                <Sliders size={32} className="mx-auto text-dark-600 mb-2 opacity-60" />
                No services match the current filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[11px] bg-dark-950/60">
                      <th className="py-2.5 px-4 font-medium">Service Name</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      <th className="py-2.5 px-3 font-medium text-right">CPU %</th>
                      <th className="py-2.5 px-3 font-medium text-right">Memory</th>
                      <th className="py-2.5 px-3 font-medium text-right">Uptime</th>
                      <th className="py-2.5 px-3 font-medium text-right">Restarts</th>
                      <th className="py-2.5 px-4 font-medium">Last Restart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/40">
                    {filteredServices.map((svc) => (
                      <tr key={svc.name} className="hover:bg-dark-950/40 transition-colors">
                        <td className="py-2.5 px-4 font-bold text-white flex items-center gap-2">
                          <Sliders size={13} className="text-dark-500" />
                          <span>{svc.name}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            svc.status === 'RUNNING'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : svc.status === 'FAILED'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-dark-800 text-dark-400 border border-dark-700'
                          }`}>
                            {svc.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-brand-400 font-semibold">
                          {svc.cpu_percent ? formatPercent(svc.cpu_percent) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-dark-300">
                          {svc.memory_bytes ? formatBytes(svc.memory_bytes) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">
                          {svc.uptime_seconds ? formatUptime(svc.uptime_seconds) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-dark-400">
                          {svc.restart_count ?? 0}
                        </td>
                        <td className="py-2.5 px-4 text-dark-500">
                          {svc.last_restart || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 7: DOCKER */}
      {/* ========================================================= */}
      {activeTab === 'docker' && (
        <div className="space-y-4">
          {!dockerData.available ? (
            <div className="p-8 bg-dark-900 border border-dark-800 rounded-2xl text-center space-y-2">
              <Box size={36} className="mx-auto text-dark-600 mb-1 opacity-70" />
              <h3 className="text-base font-semibold text-white">Docker Not Detected</h3>
              <p className="text-xs text-dark-400 font-mono max-w-md mx-auto">
                {dockerData.message || 'The Docker daemon socket (/var/run/docker.sock) was not found or is inaccessible on this server.'}
              </p>
              <p className="text-[11px] text-dark-500 font-mono pt-2">
                Docker metrics are never faked or simulated. Once Docker is installed and running, container telemetry will automatically appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-dark-900 border border-dark-800 rounded-2xl flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-bold text-white">Docker Daemon Active</span>
                </div>
                <div className="text-dark-400">
                  {dockerData.containers?.length || 0} container(s) detected
                </div>
              </div>

              <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-dark-800 text-dark-500 text-[11px] bg-dark-950/60">
                        <th className="py-2.5 px-4 font-medium">Container Name</th>
                        <th className="py-2.5 px-3 font-medium">State</th>
                        <th className="py-2.5 px-3 font-medium text-right">CPU %</th>
                        <th className="py-2.5 px-3 font-medium text-right">Memory</th>
                        <th className="py-2.5 px-3 font-medium text-right">Net RX</th>
                        <th className="py-2.5 px-3 font-medium text-right">Net TX</th>
                        <th className="py-2.5 px-3 font-medium text-right">Restarts</th>
                        <th className="py-2.5 px-4 font-medium">Uptime / Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-800/40">
                      {dockerData.containers.map((c) => (
                        <tr key={c.id || c.name} className="hover:bg-dark-950/40 transition-colors">
                          <td className="py-2.5 px-4 font-bold text-white">
                            <div>{c.name}</div>
                            <div className="text-[10px] text-dark-500 font-normal">{c.image}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              c.state === 'running'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}>
                              {c.state?.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-brand-400">
                            {formatPercent(c.cpu_percent)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-400">
                            {formatBytes(c.memory_bytes)}
                            {c.memory_limit > 0 && <span className="text-dark-500 text-[10px]"> / {formatBytes(c.memory_limit)}</span>}
                          </td>
                          <td className="py-2.5 px-3 text-right text-dark-300">
                            {formatNetworkSpeed(c.network_rx)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-dark-300">
                            {formatNetworkSpeed(c.network_tx)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-dark-400">
                            {c.restart_count || 0}
                          </td>
                          <td className="py-2.5 px-4 text-dark-400">
                            {c.status || formatUptime(c.uptime_seconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 8: LOGS */}
      {/* ========================================================= */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-dark-900 border border-dark-800 rounded-2xl">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                type="text"
                placeholder="Search log messages or units..."
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-dark-500 font-mono focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-dark-500">Level:</span>
              {['all', 'error', 'warning', 'info'].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setLogLevelFilter(lvl)}
                  className={`px-2.5 py-1 rounded-lg border capitalize transition-colors ${
                    logLevelFilter === lvl
                      ? 'bg-brand-600/20 text-brand-400 border-brand-500/30 font-bold'
                      : 'bg-dark-950 text-dark-400 border-dark-800 hover:text-white'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 shadow-xs font-mono text-xs space-y-2 max-h-[500px] overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center text-dark-500">
                <FileText size={32} className="mx-auto text-dark-600 mb-2 opacity-60" />
                No log entries matching filter.
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div key={idx} className="p-2.5 rounded-xl bg-dark-950 border border-dark-800/80 hover:border-dark-700 transition-colors flex items-start gap-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                    log.level === 'error'
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      : log.level === 'warning'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}>
                    {log.level || 'INFO'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[10px] text-dark-500 mb-0.5">
                      <span className="text-dark-300 font-semibold">{log.unit || 'system'}</span>
                      <span>{formatDate(log.timestamp)}</span>
                    </div>
                    <p className="text-dark-200 text-xs break-all leading-relaxed">{log.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 9: ALERTS */}
      {/* ========================================================= */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-dark-900 border border-dark-800 rounded-2xl">
            <div>
              <h3 className="text-sm font-bold text-white">Server Alerts & Incidents</h3>
              <p className="text-xs text-dark-400 font-mono mt-0.5">
                Active and historical threshold alerts configured for {node.name}
              </p>
            </div>
            <div className="text-xs font-mono text-dark-400">
              {alerts.length} total incident(s)
            </div>
          </div>

          {alerts.length === 0 ? (
            <div className="py-16 bg-dark-900 border border-dark-800 rounded-2xl text-center">
              <CheckCircle2 size={36} className="mx-auto text-emerald-400 mb-2 opacity-80" />
              <h4 className="text-sm font-semibold text-white">All Nominal</h4>
              <p className="text-xs text-dark-400 mt-1 font-mono">
                No active threshold violations on this server.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-4 bg-dark-900 border border-dark-800 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-mono"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        alert.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'
                      }`} />
                      <span className="font-bold text-white text-sm">{alert.rule_name || 'System Alert'}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        alert.status === 'triggered'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : alert.status === 'acknowledged'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {alert.status}
                      </span>
                    </div>

                    <p className="text-dark-300 font-sans text-xs">{alert.message}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dark-500 pt-1">
                      <span>Current: <strong className="text-white">{alert.value !== undefined ? alert.value : '—'}</strong></span>
                      <span>Threshold: <strong className="text-white">{alert.threshold !== undefined ? alert.threshold : '—'}</strong></span>
                      <span>Triggered: <strong className="text-dark-300">{formatDate(alert.triggered_at)}</strong></span>
                      {alert.duration && <span>Duration: <strong className="text-dark-300">{alert.duration}</strong></span>}
                    </div>
                  </div>

                  {alert.status !== 'resolved' && (
                    <div className="flex items-center gap-2 shrink-0">
                      {alert.status === 'triggered' && (
                        <button
                          onClick={() => handleAckAlert(alert.id)}
                          className="px-3 py-1.5 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl text-xs font-medium border border-dark-700 transition-colors"
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => handleResolveAlert(alert.id)}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-xl text-xs font-semibold border border-emerald-500/30 transition-colors"
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 10: SYSTEM */}
      {/* ========================================================= */}
      {activeTab === 'system' && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xs space-y-6">
          <div>
            <h3 className="text-base font-bold text-white">Linux Host System Specifications</h3>
            <p className="text-xs text-dark-400 font-mono mt-0.5">
              Hardware and operating system telemetry gathered directly from /proc/cpuinfo, uname, and host system.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="space-y-3 p-4 bg-dark-950 rounded-xl border border-dark-800">
              <h4 className="text-[11px] uppercase tracking-wider text-dark-400 font-bold border-b border-dark-800 pb-2">
                Operating System & Platform
              </h4>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">Hostname</span>
                <span className="text-white font-bold">{node.hostname || p.hostname || '-'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">Operating System</span>
                <span className="text-white">{node.operating_system || node.distribution || 'Ubuntu Linux'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">Kernel Version</span>
                <span className="text-white">{node.kernel || '-'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">Architecture</span>
                <span className="text-white">{node.architecture || 'x86_64'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">System Boot Time</span>
                <span className="text-white">{p.boot_time ? formatDate(p.boot_time) : 'Unavailable'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">System Uptime</span>
                <span className="text-emerald-400 font-bold">
                  {p.uptime_seconds ? formatUptime(p.uptime_seconds) : 'Unavailable'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-dark-500">Agent Version</span>
                <span className="text-white">v{node.agent_version || '2.0.0'}</span>
              </div>
            </div>

            <div className="space-y-3 p-4 bg-dark-950 rounded-xl border border-dark-800">
              <h4 className="text-[11px] uppercase tracking-wider text-dark-400 font-bold border-b border-dark-800 pb-2">
                Processor & Hardware Architecture
              </h4>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">CPU Model</span>
                <span className="text-white font-bold truncate max-w-[220px]" title={p.cpu_model || node.cpu_model}>
                  {p.cpu_model || node.cpu_model || 'Standard Linux Processor'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">CPU Cores</span>
                <span className="text-white">{p.cpu_count || node.cpu_cores || '-'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">CPU Frequency</span>
                <span className="text-white">
                  {p.cpu_freq_mhz ? `${(p.cpu_freq_mhz / 1000).toFixed(2)} GHz` : 'Unavailable'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">Total Installed RAM</span>
                <span className="text-white">
                  {p.mem_total_bytes ? formatBytes(p.mem_total_bytes) : (node.ram_total ? formatBytes(node.ram_total) : 'Unavailable')}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">Total Swap Space</span>
                <span className="text-white">
                  {p.swap_total_bytes ? formatBytes(p.swap_total_bytes) : 'No Swap Configured'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-dark-900">
                <span className="text-dark-500">IP Addresses</span>
                <span className="text-white">{node.ip_address || 'Unassigned'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-dark-500">Heartbeat Interval</span>
                <span className="text-white">{node.heartbeat_interval || 5}s</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Command Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-dark-800">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-brand-400" />
                <h3 className="text-base font-bold text-white">Monitoring Agent Install Command</h3>
              </div>
              <button
                onClick={() => setShowInstallModal(false)}
                className="text-dark-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-dark-300">
              Run this single command with root privileges on <strong>{node.name}</strong> to install or reconnect the NodeWatch monitoring agent:
            </p>

            <div className="p-3 bg-dark-950 border border-dark-800 rounded-xl font-mono text-xs text-brand-300 break-all select-all">
              curl -fsSL {window.location.origin}/install.sh | sudo bash -s -- --token "{node.id}"
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`curl -fsSL ${window.location.origin}/install.sh | sudo bash -s -- --token "${node.id}"`);
                  setCopiedToken(true);
                  setTimeout(() => setCopiedToken(false), 2000);
                }}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                {copiedToken ? <Check size={14} /> : <Copy size={14} />}
                {copiedToken ? 'Copied Command!' : 'Copy Command'}
              </button>
              <button
                onClick={() => setShowInstallModal(false)}
                className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotated Token Result Modal */}
      {rotatedTokenData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Key size={18} className="text-amber-400" /> New Agent Authentication Token Generated
            </h3>
            <p className="text-xs text-dark-300">
              The old token was revoked. Run the following command on the server to update the agent credentials:
            </p>
            <div className="p-3 bg-dark-950 border border-dark-800 rounded-xl font-mono text-xs text-amber-300 break-all select-all">
              {rotatedTokenData.install_command}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(rotatedTokenData.install_command);
                  setCopiedToken(true);
                  setTimeout(() => setCopiedToken(false), 2000);
                }}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                {copiedToken ? <Check size={14} /> : <Copy size={14} />}
                {copiedToken ? 'Copied!' : 'Copy Command'}
              </button>
              <button
                onClick={() => setRotatedTokenData(null)}
                className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
