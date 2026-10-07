import { useState, useEffect, useMemo } from 'react';
import { getDashboardSummary, getNodes, acknowledgeAlert } from '../services/api';
import { wsService } from '../services/ws';
import StatCard from '../components/common/StatCard';
import MetricChart from '../components/charts/MetricChart';
import AddNodeModal from '../components/nodes/AddNodeModal';
import { RadialSpeedometer, MiniRadialGauge } from '../components/gauge';
import {
  formatNetworkSpeed,
  formatPercent,
  formatBytes,
  formatUptime,
  timeAgo,
} from '../utils/formatters';
import {
  Server,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  Layers,
  HardDrive,
  Activity,
  ArrowUpRight,
  ShieldAlert,
  History,
  Check,
  Plus,
  Search,
  RefreshCw,
  Clock,
  ArrowDown,
  ArrowUp,
  Thermometer,
  Terminal,
  SlidersHorizontal,
  Radio,
  Copy,
  ExternalLink,
  Zap,
} from 'lucide-react';

export default function Dashboard({ onNavigateToNode, onNavigateToAlerts }) {
  const [summary, setSummary] = useState(null);
  const [nodesList, setNodesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Filter & Search states for node fleet
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, online, offline, warning

  // Modal state
  const [isAddNodeOpen, setIsAddNodeOpen] = useState(false);

  // Time window for trend charts
  const [activeWindow, setActiveWindow] = useState('1h');

  // Real-time chart buffers
  const [cpuTrend, setCpuTrend] = useState([]);
  const [memTrend, setMemTrend] = useState([]);
  const [netRxTrend, setNetRxTrend] = useState([]);
  const [netTxTrend, setNetTxTrend] = useState([]);

  // Copy notification state
  const [copiedIp, setCopiedIp] = useState(null);

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

      // Add data point to live trend buffers
      const now = Math.floor(Date.now() / 1000);
      setCpuTrend((prev) => {
        const next = [...prev, { timestamp: now, value: summaryData.avg_cpu || 0 }];
        return next.slice(-30);
      });
      setMemTrend((prev) => {
        const next = [...prev, { timestamp: now, value: summaryData.avg_memory || 0 }];
        return next.slice(-30);
      });
      setNetRxTrend((prev) => {
        const next = [...prev, { timestamp: now, value: summaryData.total_network_rx || 0 }];
        return next.slice(-30);
      });
      setNetTxTrend((prev) => {
        const next = [...prev, { timestamp: now, value: summaryData.total_network_tx || 0 }];
        return next.slice(-30);
      });
    } catch (err) {
      setError(err.message || 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen to real-time events via WebSocket
    const unsubMetrics = wsService.subscribe('node_metrics', (event) => {
      if (!event || !event.metrics) return;
      const m = event.metrics;
      const now = m.timestamp || Math.floor(Date.now() / 1000);

      // Update real-time buffers
      setCpuTrend((prev) => {
        const next = [...prev, { timestamp: now, value: m.cpu }];
        return next.slice(-30);
      });
      setMemTrend((prev) => {
        const next = [...prev, { timestamp: now, value: m.memory }];
        return next.slice(-30);
      });
      if (m.network_rx !== undefined) {
        setNetRxTrend((prev) => {
          const next = [...prev, { timestamp: now, value: m.network_rx }];
          return next.slice(-30);
        });
      }
      if (m.network_tx !== undefined) {
        setNetTxTrend((prev) => {
          const next = [...prev, { timestamp: now, value: m.network_tx }];
          return next.slice(-30);
        });
      }

      // Update node in list dynamically
      setNodesList((prev) =>
        prev.map((node) => {
          if (node.id === event.node_id) {
            return {
              ...node,
              status: 'online',
              last_seen: new Date().toISOString(),
              latest_metrics: {
                ...node.latest_metrics,
                cpu: m.cpu,
                memory: m.memory,
                disk: m.disk || node.latest_metrics?.disk,
                network_rx_bytes_sec: m.network_rx,
                network_tx_bytes_sec: m.network_tx,
                load_1: m.load_1 || node.latest_metrics?.load_1,
                load_5: m.load_5 || node.latest_metrics?.load_5,
                load_15: m.load_15 || node.latest_metrics?.load_15,
                temperature: m.temperature || node.latest_metrics?.temperature,
              },
            };
          }
          return node;
        })
      );
    });

    const unsubAlert = wsService.subscribe('alert_triggered', () => {
      loadData();
    });

    const unsubResolved = wsService.subscribe('alert_resolved', () => {
      loadData();
    });

    const unsubStatus = wsService.subscribe('node_status', (event) => {
      if (!event) return;
      setNodesList((prev) =>
        prev.map((n) => (n.id === event.node_id ? { ...n, status: event.status } : n))
      );
    });

    // Auto-refresh poll every 10 seconds as backup
    const interval = setInterval(() => {
      loadData();
    }, 10000);

    return () => {
      clearInterval(interval);
      unsubMetrics();
      unsubAlert();
      unsubResolved();
      unsubStatus();
    };
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

  // Filtered nodes
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

  // Aggregate top processes across nodes
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
      <div className="space-y-6 animate-pulse">
        <div className="h-32 bg-dark-900 rounded-2xl border border-dark-800" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-dark-900 rounded-xl border border-dark-800" />
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
        <p className="text-xs text-dark-400 mt-1 mb-4">{error}</p>
        <button
          onClick={() => loadData(true)}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-semibold hover:bg-brand-500 transition-colors"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const isHealthy = (summary?.offline_nodes || 0) === 0 && (summary?.active_alerts || 0) === 0;

  return (
    <div className="space-y-6">
      {/* 1. Header Command Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-dark-900/80 backdrop-blur-md rounded-2xl border border-dark-800/80 shadow-lg">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg md:text-xl font-bold text-white tracking-tight">
              Infrastructure Command Center
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Stream Active
            </span>
          </div>
          <p className="text-xs text-dark-400 mt-0.5">
            Real-time telemetry, core utilization, and cluster health monitoring
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-end md:self-auto">
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Refresh Metrics"
            className="p-2.5 rounded-xl bg-dark-800/80 hover:bg-dark-700 text-dark-300 hover:text-white border border-dark-700/60 transition-colors flex items-center gap-1 text-xs font-medium"
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

      {/* 2. Cluster Health Banner */}
      <div
        className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors ${
          isHealthy
            ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300'
            : 'bg-rose-950/20 border-rose-500/20 text-rose-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-xl border ${
              isHealthy
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-glow-emerald'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-glow-rose'
            }`}
          >
            {isHealthy ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {isHealthy
                ? 'All Monitored Infrastructure Systems Operational'
                : 'Infrastructure Requires Attention'}
            </h3>
            <p className="text-xs text-dark-400 mt-0.5">
              {summary?.online_nodes || 0} active server nodes sending heartbeats regularly.
              {summary?.active_alerts > 0 && ` (${summary.active_alerts} active alert triggered)`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-dark-400">Status:</span>
          <span
            className={`px-2.5 py-0.5 rounded-full font-semibold border text-[11px] ${
              isHealthy
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
          >
            {isHealthy ? 'Healthy' : 'Degraded'}
          </span>
        </div>
      </div>

      {/* 3. Primary Cluster KPI Grid (6 Cards) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <StatCard
          title="Total Servers"
          value={summary?.total_nodes || 0}
          icon={Server}
          subvalue={`${summary?.online_nodes || 0} online`}
        />
        <StatCard
          title="Online Servers"
          value={summary?.online_nodes || 0}
          icon={CheckCircle2}
          badge="Healthy"
          badgeColor="emerald"
        />
        <StatCard
          title="Cluster Avg CPU"
          value={formatPercent(summary?.avg_cpu)}
          icon={Cpu}
          subvalue="Real-time load"
        />
        <StatCard
          title="Cluster Avg RAM"
          value={formatPercent(summary?.avg_memory)}
          icon={Layers}
          subvalue="Memory footprint"
        />
        <StatCard
          title="Storage Usage"
          value={formatPercent(summary?.avg_disk)}
          icon={HardDrive}
          subvalue="Primary volumes"
        />
        <StatCard
          title="Network Traffic"
          value={formatNetworkSpeed(summary?.total_network_rx)}
          icon={Activity}
          subvalue={`TX: ${formatNetworkSpeed(summary?.total_network_tx)}`}
        />
      </div>

      {/* 3.5 Gauge UI Cluster Telemetry Cockpit */}
      <div className="bg-dark-900/90 backdrop-blur-md border border-dark-800 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-dark-800/80">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-cyan-400 animate-pulse" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Cluster Telemetry Cockpit
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
              Gauge UI
            </span>
          </div>
          <span className="text-[11px] font-mono text-dark-400">
            Precision needle speedometer & radial arc telemetries
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          <RadialSpeedometer
            title="Cluster CPU"
            value={Number((summary?.avg_cpu || 0).toFixed(1))}
            subtitle="Fleet Avg"
            variant="cyan"
            size={185}
          />
          <RadialSpeedometer
            title="Cluster RAM"
            value={Number((summary?.avg_memory || 0).toFixed(1))}
            subtitle="Fleet Avg"
            variant="emerald"
            size={185}
          />
          <RadialSpeedometer
            title="Cluster Storage"
            value={Number((summary?.avg_disk || 0).toFixed(1))}
            subtitle="Primary Mounts"
            variant="purple"
            size={185}
          />
          <RadialSpeedometer
            title="Fleet Health Rate"
            value={summary?.total_nodes ? Number(((summary.online_nodes / summary.total_nodes) * 100).toFixed(1)) : 100}
            subtitle={`${summary?.online_nodes || 0} / ${summary?.total_nodes || 0} Online`}
            variant="emerald"
            size={185}
          />
        </div>
      </div>

      {/* 4. Live Server Fleet Section (The Core Monitoring Matrix) */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-sm space-y-4">
        {/* Controls Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-dark-800">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-brand-400 animate-pulse" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Live Server Fleet ({filteredNodes.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Input */}
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500"
              />
              <input
                type="text"
                placeholder="Search server, IP, tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 sm:w-56 bg-dark-950 border border-dark-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-dark-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center bg-dark-950 p-1 rounded-xl border border-dark-800 text-[11px] font-medium">
              {[
                { id: 'all', label: 'All' },
                { id: 'online', label: 'Online' },
                { id: 'offline', label: 'Offline' },
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
        </div>

        {/* Fleet Grid */}
        {filteredNodes.length === 0 ? (
          <div className="py-12 text-center text-dark-400 text-xs">
            <Server size={32} className="mx-auto text-dark-600 mb-2 opacity-50" />
            No server nodes match the current filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredNodes.map((node) => {
              const isOnline = node.status === 'online';
              const cpuVal = node.latest_metrics?.cpu || 0;
              const memVal = node.latest_metrics?.memory || 0;
              const diskVal = node.latest_metrics?.disk || 0;
              const isMaster =
                node.tags?.includes('master') || node.name?.toLowerCase().includes('master');

              // Color for gauges
              const getGaugeColor = (val) => {
                if (val > 85) return 'bg-rose-500';
                if (val > 70) return 'bg-amber-500';
                return 'bg-brand-500';
              };

              return (
                <div
                  key={node.id}
                  onClick={() => onNavigateToNode && onNavigateToNode(node.id)}
                  className="bg-dark-950/70 hover:bg-dark-950 border border-dark-800/80 hover:border-brand-500/40 rounded-2xl p-4 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-glow-brand group relative overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative">
                        <span
                          className={`w-3 h-3 rounded-full block ${
                            isOnline ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        {isOnline && (
                          <span className="w-3 h-3 rounded-full bg-emerald-400 absolute inset-0 animate-ping opacity-75" />
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
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        isOnline
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {isOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>

                  {/* Metadata Chips: IP & OS */}
                  <div className="flex items-center gap-2 mb-3.5 text-[11px] font-mono">
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
                    {node.operatingSystem && (
                      <span className="px-2 py-0.5 rounded-md bg-dark-900 text-dark-400 border border-dark-800 truncate">
                        {node.operatingSystem}
                      </span>
                    )}
                  </div>

                  {/* Gauge UI Mini Radial Gauges */}
                  <div className="grid grid-cols-3 gap-2 py-2.5 px-2 bg-dark-900/60 rounded-xl border border-dark-800/80 mb-3 shadow-inner">
                    <MiniRadialGauge
                      value={Number(cpuVal.toFixed(1))}
                      label="CPU"
                      size={54}
                    />
                    <MiniRadialGauge
                      value={Number(memVal.toFixed(1))}
                      label="RAM"
                      size={54}
                    />
                    <MiniRadialGauge
                      value={Number(diskVal.toFixed(1))}
                      label="DISK"
                      size={54}
                    />
                  </div>

                  {/* Card Footer: Real-time network speed & Uptime */}
                  <div className="mt-3.5 pt-2.5 border-t border-dark-800/60 flex items-center justify-between text-[11px] text-dark-400">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="flex items-center gap-0.5 text-emerald-400">
                        <ArrowDown size={11} />
                        {formatNetworkSpeed(node.latest_metrics?.network_rx_bytes_sec || 0)}
                      </span>
                      <span className="flex items-center gap-0.5 text-blue-400">
                        <ArrowUp size={11} />
                        {formatNetworkSpeed(node.latest_metrics?.network_tx_bytes_sec || 0)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 font-mono text-dark-500 group-hover:text-brand-400 transition-colors">
                      <span>Inspect</span>
                      <ArrowUpRight size={12} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Real-Time Multi-Metric Analytics Studio (4 Dedicated Charts) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-brand-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Cluster Analytics Studio
            </h2>
          </div>

          <div className="flex items-center bg-dark-900 p-1 rounded-xl border border-dark-800 text-[11px] font-medium">
            {['1m Live', '1h', '6h', '24h'].map((w) => (
              <button
                key={w}
                onClick={() => setActiveWindow(w)}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  activeWindow === w
                    ? 'bg-brand-600 text-white font-semibold'
                    : 'text-dark-400 hover:text-white'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MetricChart
            title="Compute Utilization (Cluster CPU %)"
            data={cpuTrend}
            unit="%"
            color="blue"
            height={170}
            activeWindow={activeWindow}
          />
          <MetricChart
            title="Physical Memory Footprint (RAM %)"
            data={memTrend}
            unit="%"
            color="emerald"
            height={170}
            activeWindow={activeWindow}
          />
          <MetricChart
            title="Inbound Network Throughput (Rx)"
            data={netRxTrend}
            unit="bytes"
            color="purple"
            height={170}
            activeWindow={activeWindow}
          />
          <MetricChart
            title="Outbound Network Throughput (Tx)"
            data={netTxTrend}
            unit="bytes"
            color="amber"
            height={170}
            activeWindow={activeWindow}
          />
        </div>
      </div>

      {/* 6. Deep Telemetry Breakdown: Top Processes & Active Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Processes Table (Span 2 cols) */}
        <div className="lg:col-span-2 bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <Terminal size={17} className="text-brand-400" />
              <h3 className="text-sm font-semibold text-white">Top Resource-Heavy Processes</h3>
            </div>
            <span className="text-[11px] text-dark-500 font-mono">
              Live snapshot from active nodes
            </span>
          </div>

          {topProcesses.length === 0 ? (
            <div className="py-8 text-center text-dark-500 text-xs">
              Waiting for process telemetry from nodes...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-dark-800 text-dark-500 text-[11px]">
                    <th className="pb-2 font-medium">Process Name</th>
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
                      <td className="py-2.5 font-bold text-white flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                        <span className="truncate max-w-[140px] sm:max-w-[200px]">
                          {proc.name}
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
        </div>

        {/* Active Alerts Feed (Span 1 col) */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <ShieldAlert size={17} className="text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Active Alerts</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-dark-800 text-dark-300 font-mono">
                  {summary?.recent_alerts?.length || 0}
                </span>
              </div>
              {onNavigateToAlerts && (
                <button
                  onClick={onNavigateToAlerts}
                  className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 font-medium"
                >
                  View All <ArrowUpRight size={13} />
                </button>
              )}
            </div>

            {!summary?.recent_alerts || summary.recent_alerts.length === 0 ? (
              <div className="py-8 text-center text-dark-400 text-xs">
                <CheckCircle2 size={26} className="mx-auto text-emerald-400 mb-2 opacity-80" />
                All cluster thresholds optimal. No active triggers.
              </div>
            ) : (
              <div className="space-y-2">
                {summary.recent_alerts.slice(0, 4).map((alert) => (
                  <div
                    key={alert.id}
                    className="p-2.5 bg-dark-950 border border-dark-800 rounded-xl text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white truncate max-w-[160px]">
                        {alert.rule_name || 'System Alert'}
                      </span>
                      <button
                        onClick={() => handleAck(alert.id)}
                        className="px-2 py-0.5 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded text-[10px] font-medium transition-colors"
                      >
                        Ack
                      </button>
                    </div>
                    <p className="text-[11px] text-dark-400 truncate">{alert.message}</p>
                    <div className="text-[10px] text-dark-500 font-mono flex justify-between">
                      <span>{alert.node_name}</span>
                      <span>{timeAgo(alert.triggered_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-dark-800 mt-4 flex items-center justify-between text-[11px] text-dark-500">
            <span>Uptime Check Rate: 5s</span>
            <span className="text-emerald-400 font-mono">Real-time</span>
          </div>
        </div>
      </div>

      {/* Add Node Modal */}
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
