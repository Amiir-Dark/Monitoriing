import { useState, useEffect } from 'react';
import {
  getNode,
  getNodeMetrics,
  getNodeServices,
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
import {
  formatPercent,
  formatBytes,
  formatNetworkSpeed,
  formatNumber,
  formatDurationUS,
  formatUptime,
  timeAgo,
  formatDate,
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
  Sliders,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';

export default function NodeDetail({ nodeId, onBack }) {
  const [node, setNode] = useState(null);
  const [services, setServices] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Active Tab: overview, cpu, memory, disk, network, diagnostics, services, alerts, install
  const [activeTab, setActiveTab] = useState('overview');

  // Chart series and time window
  const [chartWindow, setChartWindow] = useState('1h');
  const [cpuSeries, setCpuSeries] = useState([]);
  const [memSeries, setMemSeries] = useState([]);
  const [diskSeries, setDiskSeries] = useState([]);
  const [netRxSeries, setNetRxSeries] = useState([]);
  const [netTxSeries, setNetTxSeries] = useState([]);
  const [chartsLoading, setChartsLoading] = useState(false);

  // Rotate token result modal state
  const [rotatedTokenData, setRotatedTokenData] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const loadNodeDetails = async () => {
    try {
      const [n, s, a] = await Promise.all([
        getNode(nodeId),
        getNodeServices(nodeId),
        getNodeAlerts(nodeId),
      ]);
      setNode(n);
      setServices(s || []);
      setAlerts(a || []);
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
      const [cpu, mem, disk, rx, tx] = await Promise.all([
        getNodeMetrics(nodeId, 'cpu', window),
        getNodeMetrics(nodeId, 'memory', window),
        getNodeMetrics(nodeId, 'disk', window),
        getNodeMetrics(nodeId, 'network_rx', window),
        getNodeMetrics(nodeId, 'network_tx', window),
      ]);
      setCpuSeries(cpu || []);
      setMemSeries(mem || []);
      setDiskSeries(disk || []);
      setNetRxSeries(rx || []);
      setNetTxSeries(tx || []);
    } catch {
      // metric load error handled gracefully
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

  // Real-time live metric ingestion over WebSocket
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
            last_seen: new Date().toISOString(),
            latest_payload: m,
            latest_metrics: {
              ...prev.latest_metrics,
              cpu: m.cpu,
              memory: m.memory,
              disk: m.disk,
              load1: m.load1 || m.load?.load1,
              network_rx: m.network_rx,
              network_tx: m.network_tx,
              temperature: m.temperature,
              uptime_seconds: m.uptime_seconds,
              is_thermal_available: m.temperature !== null && m.temperature !== undefined,
              is_load_available: m.load?.available ?? true,
            },
          };
        });

        // Append to 1h real-time chart
        if (chartWindow === '1h') {
          setCpuSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.cpu }]);
          setMemSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.memory }]);
          setNetRxSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.network_rx }]);
          setNetTxSeries((prev) => [...prev.slice(-119), { timestamp: now, value: m.network_tx }]);
        }

        if (m.services && m.services.length > 0) {
          setServices(m.services);
        }
      }
    });

    return unsub;
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
        <h3 className="text-white font-semibold">Node Not Found</h3>
        <p className="text-xs text-dark-400 mt-1 mb-4">{error}</p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-dark-800 text-white rounded-lg text-xs"
        >
          Return to Nodes
        </button>
      </div>
    );
  }

  const p = node.latest_payload;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'cpu', label: `CPU (${p?.cpu_count || node.architecture || 'Cores'})` },
    { id: 'memory', label: 'Memory & Swap' },
    { id: 'disk', label: `Disks & I/O (${p?.mounts?.length || 0})` },
    { id: 'network', label: `Network (${p?.interfaces?.length || 0})` },
    { id: 'diagnostics', label: 'System & Diagnostics' },
    { id: 'services', label: `Services (${services.length})` },
    { id: 'alerts', label: `Alerts (${alerts.length})` },
    { id: 'install', label: 'Agent Command' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xs">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-white mb-3 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Nodes
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-white tracking-tight">{node.name}</h2>
            <NodeStatusBadge status={node.status} disabled={node.disabled} size="lg" />
            {node.group_name && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-dark-800 text-dark-300 font-mono">
                {node.group_name}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-dark-400 font-mono mt-2.5">
            <span>IP: <strong className="text-dark-200">{node.ip_address || 'Unassigned'}</strong></span>
            <span>Host: <strong className="text-dark-200">{node.hostname || '-'}</strong></span>
            <span>OS: <strong className="text-dark-200">{node.operating_system || '-'} ({node.architecture || '-'})</strong></span>
            <span>Kernel: <strong className="text-dark-200">{node.kernel || '-'}</strong></span>
            <span>Last Seen: <strong className="text-dark-200">{timeAgo(node.last_seen)}</strong></span>
            {p?.uptime_seconds ? (
              <span>Uptime: <strong className="text-emerald-400">{formatUptime(p.uptime_seconds)}</strong></span>
            ) : null}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
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

      {/* Tabs Bar */}
      <div className="flex border-b border-dark-800 overflow-x-auto gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === t.id
                ? 'border-brand-500 text-white font-bold'
                : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ========================================================= */}
      {/* TAB 1: OVERVIEW */}
      {/* ========================================================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* CPU */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4.5 shadow-xs">
              <div className="flex items-center justify-between text-dark-400 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu size={14} className="text-blue-400" /> CPU Usage
                </span>
                <span className="text-[10px] font-mono text-dark-500">{p?.cpu_count || 1} Cores</span>
              </div>
              <p className="text-2xl font-bold text-white mt-1 tabular-nums font-mono">
                {formatPercent(p?.cpu ?? node.latest_metrics?.cpu)}
              </p>
              <div className="mt-2 text-[11px] font-mono text-dark-400 flex items-center justify-between">
                <span>User: <strong className="text-dark-200">{p?.cpu_user !== undefined ? `${p.cpu_user}%` : '-'}</strong></span>
                <span>Sys: <strong className="text-dark-200">{p?.cpu_system !== undefined ? `${p.cpu_system}%` : '-'}</strong></span>
                <span>Wait: <strong className="text-dark-200">{p?.cpu_iowait !== undefined ? `${p.cpu_iowait}%` : '-'}</strong></span>
              </div>
            </div>

            {/* RAM */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4.5 shadow-xs">
              <div className="flex items-center justify-between text-dark-400 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={14} className="text-emerald-400" /> RAM Usage
                </span>
                <span className="text-[10px] font-mono text-dark-500">
                  {p?.mem_total_bytes ? formatBytes(p.mem_total_bytes) : '-'}
                </span>
              </div>
              <p className="text-2xl font-bold text-white mt-1 tabular-nums font-mono">
                {formatPercent(p?.memory ?? node.latest_metrics?.memory)}
              </p>
              <div className="mt-2 text-[11px] font-mono text-dark-400 flex items-center justify-between">
                <span>Used: <strong className="text-dark-200">{p?.mem_used_bytes ? formatBytes(p.mem_used_bytes) : '-'}</strong></span>
                <span>Avail: <strong className="text-dark-200">{p?.mem_avail_bytes ? formatBytes(p.mem_avail_bytes) : '-'}</strong></span>
              </div>
            </div>

            {/* Root Disk */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4.5 shadow-xs">
              <div className="flex items-center justify-between text-dark-400 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <HardDrive size={14} className="text-purple-400" /> Root Disk (/)
                </span>
                <span className="text-[10px] font-mono text-dark-500">
                  {p?.disk_total_bytes ? formatBytes(p.disk_total_bytes) : '-'}
                </span>
              </div>
              <p className="text-2xl font-bold text-white mt-1 tabular-nums font-mono">
                {formatPercent(p?.disk ?? node.latest_metrics?.disk)}
              </p>
              <div className="mt-2 text-[11px] font-mono text-dark-400 flex items-center justify-between">
                <span>Used: <strong className="text-dark-200">{p?.disk_used_bytes ? formatBytes(p.disk_used_bytes) : '-'}</strong></span>
                <span>Mounts: <strong className="text-dark-200">{p?.mounts?.length || 1}</strong></span>
              </div>
            </div>

            {/* Network */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4.5 shadow-xs">
              <div className="flex items-center justify-between text-dark-400 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <Activity size={14} className="text-amber-400" /> Network Rate
                </span>
                <span className="text-[10px] font-mono text-dark-500">
                  {p?.interfaces?.length || 1} Ifaces
                </span>
              </div>
              <p className="text-xl font-bold text-white mt-1 font-mono tabular-nums truncate">
                ↓ {formatNetworkSpeed(p?.network_rx ?? node.latest_metrics?.network_rx)}
              </p>
              <div className="mt-2 text-[11px] font-mono text-dark-400 flex items-center justify-between">
                <span>TX: <strong className="text-dark-200 font-mono">↑ {formatNetworkSpeed(p?.network_tx ?? node.latest_metrics?.network_tx)}</strong></span>
              </div>
            </div>
          </div>

          {/* Load, Thermal, TCP, Process Summary Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Load Avg */}
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <span className="text-[11px] text-dark-400 font-medium uppercase">Load Average</span>
              {p?.load?.available === false ? (
                <div className="mt-2">
                  <span className="px-2 py-0.5 rounded bg-dark-800 text-dark-400 text-xs font-mono">Unavailable</span>
                  <p className="text-[10px] text-dark-500 mt-1">Non-Linux or not available</p>
                </div>
              ) : (
                <div className="mt-1">
                  <div className="text-lg font-bold text-white font-mono">
                    {(p?.load1 ?? p?.load?.load1 ?? 0).toFixed(2)}
                  </div>
                  <p className="text-[10px] font-mono text-dark-400 mt-0.5">
                    5m: {(p?.load5 ?? p?.load?.load5 ?? 0).toFixed(2)} | 15m: {(p?.load15 ?? p?.load?.load15 ?? 0).toFixed(2)}
                  </p>
                </div>
              )}
            </div>

            {/* Temperature */}
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <span className="text-[11px] text-dark-400 font-medium uppercase flex items-center gap-1">
                <Thermometer size={13} /> Temperature
              </span>
              {p?.temperature !== undefined && p?.temperature !== null ? (
                <div className="mt-1">
                  <div className="text-lg font-bold text-white font-mono">
                    {p.temperature.toFixed(1)}°C
                  </div>
                  <p className="text-[10px] text-emerald-400 mt-0.5">
                    {p.thermal_sensors?.length || 1} sensor(s) reading
                  </p>
                </div>
              ) : (
                <div className="mt-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-mono">
                    Unavailable
                  </span>
                  <p className="text-[10px] text-dark-500 mt-1" title="No thermal hardware in VMs/containers">
                    Virtual environment
                  </p>
                </div>
              )}
            </div>

            {/* Processes */}
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <span className="text-[11px] text-dark-400 font-medium uppercase">Processes</span>
              <div className="mt-1">
                <div className="text-lg font-bold text-white font-mono">
                  {p?.processes?.total ? formatNumber(p.processes.total) : 'Unavailable'}
                </div>
                <p className="text-[10px] font-mono text-dark-400 mt-0.5">
                  Running: <strong className="text-emerald-400">{p?.processes?.running ?? 0}</strong> | Zombie: <strong className="text-rose-400">{p?.processes?.zombie ?? 0}</strong>
                </p>
              </div>
            </div>

            {/* TCP Sockets */}
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <span className="text-[11px] text-dark-400 font-medium uppercase">TCP Sockets</span>
              <div className="mt-1">
                <div className="text-lg font-bold text-white font-mono">
                  {p?.tcp?.total ? formatNumber(p.tcp.total) : 'Unavailable'}
                </div>
                <p className="text-[10px] font-mono text-dark-400 mt-0.5">
                  Est: <strong className="text-blue-400">{p?.tcp?.established ?? 0}</strong> | Listen: <strong className="text-purple-400">{p?.tcp?.listen ?? 0}</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Mini CPU & Memory charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricChart
              title="CPU Usage (Real-time)"
              data={cpuSeries}
              unit="%"
              color="blue"
              loading={chartsLoading}
            />
            <MetricChart
              title="Memory Usage (Real-time)"
              data={memSeries}
              unit="%"
              color="emerald"
              loading={chartsLoading}
            />
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: CPU */}
      {/* ========================================================= */}
      {activeTab === 'cpu' && (
        <div className="space-y-6">
          {/* Hardware CPU Spec Card */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Cpu size={16} className="text-blue-400" /> Processor Hardware Specifications
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
              <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                <span className="text-dark-500 block text-[10px] uppercase">Model</span>
                <span className="text-white font-medium">{p?.cpu_model || 'Standard Linux CPU'}</span>
              </div>
              <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                <span className="text-dark-500 block text-[10px] uppercase">Cores / Threads</span>
                <span className="text-white font-medium">{p?.cpu_count || node.architecture || '1'} Cores</span>
              </div>
              <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                <span className="text-dark-500 block text-[10px] uppercase">Frequency</span>
                <span className="text-white font-medium">{p?.cpu_freq_mhz ? `${p.cpu_freq_mhz.toFixed(1)} MHz` : 'Dynamic'}</span>
              </div>
              <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                <span className="text-dark-500 block text-[10px] uppercase">Architecture</span>
                <span className="text-white font-medium">{node.architecture || 'x86_64'}</span>
              </div>
            </div>

            {/* Breakdown of CPU states */}
            {p && (
              <div className="mt-4 pt-4 border-t border-dark-800/80">
                <span className="text-[11px] font-semibold text-dark-400 uppercase tracking-wider block mb-2">
                  Instantaneous OS CPU Time Breakdown
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
                  <div className="bg-dark-950/60 p-2.5 rounded-lg border border-dark-800">
                    <span className="text-dark-500 text-[10px] block">User Space</span>
                    <strong className="text-blue-400 text-sm">{p.cpu_user?.toFixed(1) ?? '0.0'}%</strong>
                  </div>
                  <div className="bg-dark-950/60 p-2.5 rounded-lg border border-dark-800">
                    <span className="text-dark-500 text-[10px] block">System Kernel</span>
                    <strong className="text-purple-400 text-sm">{p.cpu_system?.toFixed(1) ?? '0.0'}%</strong>
                  </div>
                  <div className="bg-dark-950/60 p-2.5 rounded-lg border border-dark-800">
                    <span className="text-dark-500 text-[10px] block">Idle</span>
                    <strong className="text-emerald-400 text-sm">{p.cpu_idle?.toFixed(1) ?? '0.0'}%</strong>
                  </div>
                  <div className="bg-dark-950/60 p-2.5 rounded-lg border border-dark-800">
                    <span className="text-dark-500 text-[10px] block">IO Wait</span>
                    <strong className="text-amber-400 text-sm">{p.cpu_iowait?.toFixed(1) ?? '0.0'}%</strong>
                  </div>
                  <div className="bg-dark-950/60 p-2.5 rounded-lg border border-dark-800">
                    <span className="text-dark-500 text-[10px] block">Hypervisor Steal</span>
                    <strong className="text-rose-400 text-sm">{p.cpu_steal?.toFixed(1) ?? '0.0'}%</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Per-Core Matrix */}
          {p?.cpu_per_core && p.cpu_per_core.length > 0 && (
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
              <h3 className="text-sm font-semibold text-white mb-3">Individual Core Utilization</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {p.cpu_per_core.map((core) => (
                  <div key={core.core_index} className="bg-dark-950 border border-dark-800 rounded-xl p-3 font-mono text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-dark-300">Core #{core.core_index}</span>
                      <span className="font-bold text-white">{core.total.toFixed(1)}%</span>
                    </div>
                    {/* Bar */}
                    <div className="w-full bg-dark-800 h-1.5 rounded-full overflow-hidden mb-2">
                      <div
                        className="bg-blue-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(core.total, 100)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-dark-400 flex justify-between">
                      <span>Usr: {core.user?.toFixed(1) || '0'}%</span>
                      <span>Sys: {core.system?.toFixed(1) || '0'}%</span>
                      <span>Wait: {core.iowait?.toFixed(1) || '0'}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historical Chart */}
          <MetricChart
            title="CPU Usage History"
            data={cpuSeries}
            unit="%"
            color="blue"
            activeWindow={chartWindow}
            onWindowChange={setChartWindow}
            loading={chartsLoading}
            height={260}
          />
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: MEMORY & SWAP */}
      {/* ========================================================= */}
      {activeTab === 'memory' && (
        <div className="space-y-6">
          {/* Detailed Memory Table */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Layers size={16} className="text-emerald-400" /> Physical RAM & Swap Breakdown
            </h3>

            {/* Visual RAM & Swap Bars */}
            <div className="space-y-4 mb-6">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-dark-300">Physical Memory (RAM)</span>
                  <span className="text-white font-bold">
                    {formatBytes(p?.mem_used_bytes)} / {formatBytes(p?.mem_total_bytes)} ({formatPercent(p?.memory)})
                  </span>
                </div>
                <div className="w-full bg-dark-950 h-3 rounded-full overflow-hidden border border-dark-800 flex">
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: `${Math.min(p?.memory || 0, 100)}%` }}
                    title="Used Memory"
                  />
                  <div
                    className="bg-blue-500/50 h-full"
                    style={{ width: `${p?.mem_total_bytes ? Math.min(((p?.mem_buffers_bytes || 0) + (p?.mem_cached_bytes || 0)) / p.mem_total_bytes * 100, 100) : 0}%` }}
                    title="Buffers & Cached"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-dark-300">Swap Space</span>
                  <span className="text-white font-bold">
                    {p?.swap_total_bytes ? `${formatBytes(p.swap_used_bytes)} / ${formatBytes(p.swap_total_bytes)} (${formatPercent(p.swap)})` : 'None Configured'}
                  </span>
                </div>
                <div className="w-full bg-dark-950 h-3 rounded-full overflow-hidden border border-dark-800">
                  <div
                    className="bg-purple-500 h-full"
                    style={{ width: `${Math.min(p?.swap || 0, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Exact Bytes Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-dark-800 text-dark-500 text-[10px] uppercase">
                    <th className="pb-2">Metric</th>
                    <th className="pb-2">Human Readable</th>
                    <th className="pb-2">Exact Bytes</th>
                    <th className="pb-2">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800/60 text-dark-300">
                  <tr>
                    <td className="py-2.5 text-white font-semibold">Total Memory</td>
                    <td className="py-2.5">{formatBytes(p?.mem_total_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.mem_total_bytes)} B</td>
                    <td className="py-2.5">100.0%</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-rose-400">Used Memory</td>
                    <td className="py-2.5">{formatBytes(p?.mem_used_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.mem_used_bytes)} B</td>
                    <td className="py-2.5">{formatPercent(p?.memory)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-emerald-400">Available Memory</td>
                    <td className="py-2.5">{formatBytes(p?.mem_avail_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.mem_avail_bytes)} B</td>
                    <td className="py-2.5">{p?.mem_total_bytes ? formatPercent((p.mem_avail_bytes / p.mem_total_bytes) * 100) : '-'}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5">Free (Unallocated)</td>
                    <td className="py-2.5">{formatBytes(p?.mem_free_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.mem_free_bytes)} B</td>
                    <td className="py-2.5">{p?.mem_total_bytes ? formatPercent((p.mem_free_bytes / p.mem_total_bytes) * 100) : '-'}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5">Buffers</td>
                    <td className="py-2.5">{formatBytes(p?.mem_buffers_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.mem_buffers_bytes)} B</td>
                    <td className="py-2.5">{p?.mem_total_bytes ? formatPercent((p.mem_buffers_bytes / p.mem_total_bytes) * 100) : '-'}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5">Cached Memory</td>
                    <td className="py-2.5">{formatBytes(p?.mem_cached_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.mem_cached_bytes)} B</td>
                    <td className="py-2.5">{p?.mem_total_bytes ? formatPercent((p.mem_cached_bytes / p.mem_total_bytes) * 100) : '-'}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5">Active / Inactive</td>
                    <td className="py-2.5">{formatBytes(p?.mem_active_bytes)} / {formatBytes(p?.mem_inactive_bytes)}</td>
                    <td className="py-2.5 text-dark-400">-</td>
                    <td className="py-2.5">-</td>
                  </tr>
                  <tr>
                    <td className="py-2.5">Kernel Slab / Dirty</td>
                    <td className="py-2.5">{formatBytes(p?.mem_slab_bytes)} / {formatBytes(p?.mem_dirty_bytes)}</td>
                    <td className="py-2.5 text-dark-400">-</td>
                    <td className="py-2.5">-</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-purple-400">Total Swap</td>
                    <td className="py-2.5">{formatBytes(p?.swap_total_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.swap_total_bytes)} B</td>
                    <td className="py-2.5">-</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-purple-400">Used Swap</td>
                    <td className="py-2.5">{formatBytes(p?.swap_used_bytes)}</td>
                    <td className="py-2.5 text-dark-400">{formatNumber(p?.swap_used_bytes)} B</td>
                    <td className="py-2.5">{formatPercent(p?.swap)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Historical Memory Chart */}
          <MetricChart
            title="Memory Usage History"
            data={memSeries}
            unit="%"
            color="emerald"
            activeWindow={chartWindow}
            onWindowChange={setChartWindow}
            loading={chartsLoading}
            height={260}
          />
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 4: DISKS & I/O */}
      {/* ========================================================= */}
      {activeTab === 'disk' && (
        <div className="space-y-6">
          {/* Mount Points Table */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <HardDrive size={16} className="text-purple-400" /> Filesystem Mount Points & Inodes
            </h3>

            {(!p?.mounts || p.mounts.length === 0) ? (
              <div className="py-8 text-center text-xs text-dark-500 font-mono">
                No mount points reported from /proc/mounts.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[10px] uppercase">
                      <th className="pb-2">Mount Point</th>
                      <th className="pb-2">Device</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Used / Total</th>
                      <th className="pb-2">Usage %</th>
                      <th className="pb-2">Inodes (Used/Total)</th>
                      <th className="pb-2">Inodes %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/60 text-dark-300">
                    {p.mounts.map((m, idx) => (
                      <tr key={idx}>
                        <td className="py-3 font-semibold text-white">{m.mount_point}</td>
                        <td className="py-3 text-dark-400">{m.device}</td>
                        <td className="py-3 uppercase text-[11px] text-dark-400">{m.fs_type}</td>
                        <td className="py-3">
                          {formatBytes(m.used_bytes)} / {formatBytes(m.total_bytes)}
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <span className={m.percent > 85 ? 'text-rose-400 font-bold' : 'text-white'}>
                              {m.percent.toFixed(1)}%
                            </span>
                            <div className="w-16 bg-dark-950 h-1.5 rounded-full overflow-hidden border border-dark-800 hidden sm:block">
                              <div
                                className={`h-full ${m.percent > 85 ? 'bg-rose-500' : 'bg-purple-500'}`}
                                style={{ width: `${Math.min(m.percent, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-dark-400">
                          {m.inodes_total ? `${formatNumber(m.inodes_used)} / ${formatNumber(m.inodes_total)}` : 'N/A'}
                        </td>
                        <td className="py-3 text-dark-400">
                          {m.inodes_percent !== undefined ? `${m.inodes_percent.toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Block Devices I/O Table */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Activity size={16} className="text-blue-400" /> Block Device Throughput & IOPS (/proc/diskstats)
            </h3>

            {(!p?.disk_io_devices || p.disk_io_devices.length === 0) ? (
              <div className="py-8 text-center text-xs text-dark-500 font-mono">
                No block devices detected or non-Linux system.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[10px] uppercase">
                      <th className="pb-2">Device</th>
                      <th className="pb-2">Read Rate</th>
                      <th className="pb-2">Write Rate</th>
                      <th className="pb-2">Read IOPS</th>
                      <th className="pb-2">Write IOPS</th>
                      <th className="pb-2">Total Read</th>
                      <th className="pb-2">Total Written</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/60 text-dark-300">
                    {p.disk_io_devices.map((dev, idx) => (
                      <tr key={idx}>
                        <td className="py-3 font-semibold text-white">{dev.device_name}</td>
                        <td className="py-3 text-emerald-400 font-bold">{formatNetworkSpeed(dev.read_bytes_sec)}</td>
                        <td className="py-3 text-blue-400 font-bold">{formatNetworkSpeed(dev.write_bytes_sec)}</td>
                        <td className="py-3 text-dark-300">{dev.read_ops_sec.toFixed(1)} ops/s</td>
                        <td className="py-3 text-dark-300">{dev.write_ops_sec.toFixed(1)} ops/s</td>
                        <td className="py-3 text-dark-400">{formatBytes(dev.total_read_bytes)}</td>
                        <td className="py-3 text-dark-400">{formatBytes(dev.total_write_bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Historical Disk Chart */}
          <MetricChart
            title="Primary Filesystem Usage History"
            data={diskSeries}
            unit="%"
            color="purple"
            activeWindow={chartWindow}
            onWindowChange={setChartWindow}
            loading={chartsLoading}
            height={240}
          />
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 5: NETWORK */}
      {/* ========================================================= */}
      {activeTab === 'network' && (
        <div className="space-y-6">
          {/* Interfaces Table */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Network size={16} className="text-blue-400" /> Network Adapters (/proc/net/dev)
            </h3>

            {(!p?.interfaces || p.interfaces.length === 0) ? (
              <div className="py-8 text-center text-xs text-dark-500 font-mono">
                No network interfaces detected.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[10px] uppercase">
                      <th className="pb-2">Interface</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">IP Addresses</th>
                      <th className="pb-2">MAC Address</th>
                      <th className="pb-2">RX Throughput</th>
                      <th className="pb-2">TX Throughput</th>
                      <th className="pb-2">Packets / s</th>
                      <th className="pb-2">Errors (RX/TX)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/60 text-dark-300">
                    {p.interfaces.map((iface, idx) => (
                      <tr key={idx}>
                        <td className="py-3 font-semibold text-white">{iface.name}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            iface.status === 'up'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-dark-800 text-dark-400 border border-dark-700'
                          }`}>
                            {iface.status}
                          </span>
                        </td>
                        <td className="py-3 text-dark-200">
                          {iface.ip_addresses?.length > 0 ? iface.ip_addresses.join(', ') : '-'}
                        </td>
                        <td className="py-3 text-dark-400">{iface.mac || '-'}</td>
                        <td className="py-3 text-emerald-400 font-bold">
                          ↓ {formatNetworkSpeed(iface.rx_bytes_sec)}
                        </td>
                        <td className="py-3 text-blue-400 font-bold">
                          ↑ {formatNetworkSpeed(iface.tx_bytes_sec)}
                        </td>
                        <td className="py-3 text-dark-400">
                          {iface.rx_packets_sec !== undefined ? `${(iface.rx_packets_sec + iface.tx_packets_sec).toFixed(0)} pkts/s` : '-'}
                        </td>
                        <td className="py-3 text-dark-400">
                          {iface.total_rx_errors || iface.total_tx_errors ? (
                            <span className="text-rose-400 font-bold">
                              {iface.total_rx_errors} / {iface.total_tx_errors}
                            </span>
                          ) : (
                            '0 / 0'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Historical RX and TX Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricChart
              title="Network Received (RX Throughput)"
              data={netRxSeries}
              unit="bytes"
              color="emerald"
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              loading={chartsLoading}
              height={220}
            />
            <MetricChart
              title="Network Transmitted (TX Throughput)"
              data={netTxSeries}
              unit="bytes"
              color="blue"
              activeWindow={chartWindow}
              onWindowChange={setChartWindow}
              loading={chartsLoading}
              height={220}
            />
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 6: SYSTEM & DIAGNOSTICS */}
      {/* ========================================================= */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          {/* Collector Execution & Reliability Status */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
              <Sliders size={16} className="text-brand-400" /> Subsystem Metric Collectors Diagnostic Report
            </h3>
            <p className="text-xs text-dark-400 mb-4">
              Direct verification of Linux /proc, /sys and hardware sensor readers on this server:
            </p>

            {(!p?.collectors || Object.keys(p.collectors).length === 0) ? (
              <div className="py-6 text-center text-xs text-dark-500 font-mono">
                No collector diagnostics available yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-dark-800 text-dark-500 text-[10px] uppercase">
                      <th className="pb-2">Collector Domain</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Duration</th>
                      <th className="pb-2">Diagnostic Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/60 text-dark-300">
                    {Object.entries(p.collectors).map(([name, rep]) => (
                      <tr key={name}>
                        <td className="py-2.5 font-semibold text-white capitalize">{name}</td>
                        <td className="py-2.5">
                          {rep.status === 'ok' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                              <CheckCircle2 size={12} /> OK
                            </span>
                          ) : rep.status === 'unavailable' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 inline-flex items-center gap-1">
                              <HelpCircle size={12} /> UNAVAILABLE
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 inline-flex items-center gap-1">
                              <XCircle size={12} /> ERROR
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-dark-400">{formatDurationUS(rep.duration_us)}</td>
                        <td className="py-2.5 text-dark-300">{rep.message || 'Operational'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Real Thermal Sensors List */}
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
              <Thermometer size={16} className="text-amber-400" /> Physical Hardware Thermal Sensors
            </h3>

            {(!p?.thermal_sensors || p.thermal_sensors.length === 0) ? (
              <div className="p-4 bg-dark-950 border border-dark-800 rounded-xl text-xs text-dark-400">
                <span className="font-semibold text-amber-400 block mb-1">No Hardware Sensors Found</span>
                No thermal zones exist in <code className="text-dark-300">/sys/class/thermal</code> or <code className="text-dark-300">/sys/class/hwmon</code>.
                This is completely normal on virtual machines (KVM/QEMU/Xen), container environments (LXC/Docker), and cloud servers (AWS, Hetzner, DigitalOcean) where the hypervisor does not expose raw motherboard diodes.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {p.thermal_sensors.map((sensor, idx) => (
                  <div key={idx} className="bg-dark-950 border border-dark-800 rounded-xl p-3 font-mono text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-dark-300 font-semibold">{sensor.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        sensor.status === 'ok'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : sensor.status === 'warning'
                          ? 'bg-amber-500/10 text-amber-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {sensor.status}
                      </span>
                    </div>
                    <p className="text-xl font-bold text-white mt-1">
                      {sensor.temperature_c.toFixed(1)}°C
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Processes & TCP State Matrices */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Process States */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
              <h3 className="text-sm font-semibold text-white mb-3">Process States (/proc/[pid]/stat)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Total</span>
                  <span className="text-lg font-bold text-white">{p?.processes?.total ? formatNumber(p.processes.total) : 'N/A'}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Running (R)</span>
                  <span className="text-lg font-bold text-emerald-400">{p?.processes?.running ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Sleeping (S/I)</span>
                  <span className="text-lg font-bold text-blue-400">{p?.processes?.sleeping ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Disk Sleep (D)</span>
                  <span className="text-lg font-bold text-amber-400">{p?.processes?.disk_sleep ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Zombie (Z)</span>
                  <span className="text-lg font-bold text-rose-400">{p?.processes?.zombie ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Stopped (T)</span>
                  <span className="text-lg font-bold text-dark-300">{p?.processes?.stopped ?? 0}</span>
                </div>
              </div>
            </div>

            {/* TCP Sockets */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs">
              <h3 className="text-sm font-semibold text-white mb-3">TCP Connection Matrix (/proc/net/tcp)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Total TCP</span>
                  <span className="text-lg font-bold text-white">{p?.tcp?.total ? formatNumber(p.tcp.total) : 'N/A'}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Established</span>
                  <span className="text-lg font-bold text-emerald-400">{p?.tcp?.established ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Listening</span>
                  <span className="text-lg font-bold text-purple-400">{p?.tcp?.listen ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Time Wait</span>
                  <span className="text-lg font-bold text-amber-400">{p?.tcp?.time_wait ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">Close Wait</span>
                  <span className="text-lg font-bold text-rose-400">{p?.tcp?.close_wait ?? 0}</span>
                </div>
                <div className="bg-dark-950 p-3 rounded-xl border border-dark-800">
                  <span className="text-dark-500 text-[10px] uppercase block">UDP Sockets</span>
                  <span className="text-lg font-bold text-blue-400">{p?.tcp?.udp_total ?? 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 7: SERVICES */}
      {/* ========================================================= */}
      {activeTab === 'services' && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-dark-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Monitored Host Daemons</h3>
            <span className="text-xs text-dark-400">Inspected automatically via /proc/[pid]/comm</span>
          </div>

          {services.length === 0 ? (
            <div className="py-12 text-center text-xs text-dark-500 font-mono">
              No services reported yet.
            </div>
          ) : (
            <div className="divide-y divide-dark-800">
              {services.map((svc) => (
                <div key={svc.id || svc.name} className="px-6 py-3.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-medium text-white">{svc.name}</span>
                    {svc.pid ? (
                      <span className="text-[10px] text-dark-500 font-mono">PID {svc.pid}</span>
                    ) : null}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${
                    svc.status === 'running'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : svc.status === 'stopped'
                      ? 'bg-dark-800 text-dark-400 border border-dark-700'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {svc.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 8: ALERTS */}
      {/* ========================================================= */}
      {activeTab === 'alerts' && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-dark-800">
            <h3 className="text-sm font-semibold text-white">Alert Events for {node.name}</h3>
          </div>

          {alerts.length === 0 ? (
            <div className="py-12 text-center text-xs text-dark-500 font-mono">
              No alert incidents recorded for this server.
            </div>
          ) : (
            <div className="divide-y divide-dark-800">
              {alerts.map((al) => (
                <div key={al.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        al.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'
                      }`} />
                      <span className="font-semibold text-white">{al.rule_name || 'System Alert'}</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-dark-800 text-dark-400 uppercase">
                        {al.status}
                      </span>
                    </div>
                    <p className="text-dark-400">{al.message}</p>
                    <p className="text-[10px] text-dark-500 font-mono mt-1">{formatDate(al.triggered_at)}</p>
                  </div>

                  {al.status !== 'resolved' && (
                    <div className="flex items-center gap-2 shrink-0">
                      {al.status === 'triggered' && (
                        <button
                          onClick={() => handleAckAlert(al.id)}
                          className="px-2.5 py-1 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg text-xs"
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => handleResolveAlert(al.id)}
                        className="px-2.5 py-1 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded-lg text-xs"
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
      {/* TAB 9: INSTALL / AGENT */}
      {/* ========================================================= */}
      {activeTab === 'install' && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-semibold text-white">Agent Installation Instructions</h3>
          <p className="text-xs text-dark-400">
            If you need to redeploy or reconfigure the monitoring agent on this server, execute the curl installer:
          </p>

          <div className="p-4 bg-dark-950 border border-dark-800 rounded-xl font-mono text-xs text-dark-300">
            <code>curl -fsSL {window.location.origin}/install.sh | sudo bash -s -- --token "NODE_TOKEN"</code>
          </div>

          <p className="text-xs text-dark-400">
            Click <strong>Rotate Token</strong> above to generate a fresh one-line installer command with your node's token.
          </p>
        </div>
      )}

      {/* Rotated Token Modal */}
      {rotatedTokenData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Token Rotated Successfully</h3>
            <p className="text-xs text-dark-400">
              Update your remote server with the new install command below:
            </p>
            <div className="relative">
              <textarea
                readOnly
                rows={3}
                value={rotatedTokenData.install_command}
                className="w-full font-mono text-xs bg-dark-950 border border-dark-800 rounded-xl p-3 text-dark-200 resize-none select-all focus:outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(rotatedTokenData.install_command);
                  setCopiedToken(true);
                  setTimeout(() => setCopiedToken(false), 2000);
                }}
                className="absolute top-2.5 right-2.5 px-3 py-1 bg-dark-800 hover:bg-dark-700 text-xs text-white rounded-lg flex items-center gap-1"
              >
                {copiedToken ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copiedToken ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setRotatedTokenData(null)}
                className="px-4 py-2 bg-brand-600 text-white rounded-xl text-xs font-semibold"
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
