import { useState, useEffect } from 'react';
import { getDashboardSummary, acknowledgeAlert } from '../services/api';
import { wsService } from '../services/ws';
import StatCard from '../components/common/StatCard';
import MetricChart from '../components/charts/MetricChart';
import { formatNetworkSpeed, timeAgo, formatPercent } from '../utils/formatters';
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
} from 'lucide-react';

export default function Dashboard({ onNavigateToNode, onNavigateToAlerts }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Live series buffer for quick real-time trend graphs on dashboard
  const [cpuTrend, setCpuTrend] = useState([]);
  const [memTrend, setMemTrend] = useState([]);

  const loadData = async () => {
    try {
      const data = await getDashboardSummary();
      setSummary(data);
      setError(null);

      // Initialize trend buffer
      const now = Math.floor(Date.now() / 1000);
      setCpuTrend((prev) => {
        const next = [...prev, { timestamp: now, value: data.avg_cpu || 0 }];
        return next.slice(-20);
      });
      setMemTrend((prev) => {
        const next = [...prev, { timestamp: now, value: data.avg_memory || 0 }];
        return next.slice(-20);
      });
    } catch (err) {
      setError(err.message || 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen to real-time events
    const unsubMetrics = wsService.subscribe('node_metrics', (event) => {
      if (!event || !event.metrics) return;
      const m = event.metrics;
      const now = m.timestamp || Math.floor(Date.now() / 1000);

      setCpuTrend((prev) => {
        const next = [...prev, { timestamp: now, value: m.cpu }];
        return next.slice(-25);
      });
      setMemTrend((prev) => {
        const next = [...prev, { timestamp: now, value: m.memory }];
        return next.slice(-25);
      });

      // Update summary averages
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          avg_cpu: m.cpu,
          avg_memory: m.memory,
          avg_disk: m.disk || prev.avg_disk,
          total_network_rx: m.network_rx || prev.total_network_rx,
          total_network_tx: m.network_tx || prev.total_network_tx,
        };
      });
    });

    const unsubAlert = wsService.subscribe('alert_triggered', () => {
      loadData();
    });

    const unsubResolved = wsService.subscribe('alert_resolved', () => {
      loadData();
    });

    return () => {
      unsubMetrics();
      unsubAlert();
      unsubResolved();
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

  if (loading && !summary) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-28 bg-dark-900 rounded-2xl border border-dark-800" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-dark-900 rounded-xl border border-dark-800" />
          ))}
        </div>
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
          onClick={loadData}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-semibold"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const isHealthy = (summary?.offline_nodes || 0) === 0 && (summary?.active_alerts || 0) === 0;

  return (
    <div className="space-y-6">
      {/* 1. Overall Health Banner */}
      <div className={`p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-colors ${
        isHealthy
          ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300'
          : 'bg-rose-950/20 border-rose-500/20 text-rose-300'
      }`}>
        <div className="flex items-center gap-3.5">
          <div className={`p-2.5 rounded-xl border ${
            isHealthy
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-glow-emerald'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-glow-rose'
          }`}>
            {isHealthy ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {isHealthy ? 'All Monitored Infrastructure Systems Operational' : 'Infrastructure Requires Attention'}
            </h3>
            <p className="text-xs text-dark-400 mt-0.5">
              {isHealthy
                ? `${summary?.online_nodes || 0} active server nodes sending heartbeats regularly.`
                : `${summary?.offline_nodes || 0} offline nodes and ${summary?.active_alerts || 0} triggered alerts.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto text-xs">
          <span className="font-mono text-dark-400">Status:</span>
          <span className={`px-2.5 py-1 rounded-full font-semibold border ${
            isHealthy
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
          }`}>
            {isHealthy ? 'Healthy' : 'Degraded'}
          </span>
        </div>
      </div>

      {/* 2. Nodes Online / Offline Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Nodes"
          value={summary?.total_nodes || 0}
          icon={Server}
          subvalue={`${summary?.disabled_nodes || 0} disabled`}
        />
        <StatCard
          title="Online Nodes"
          value={summary?.online_nodes || 0}
          icon={CheckCircle2}
          badge="Healthy"
          badgeColor="emerald"
        />
        <StatCard
          title="Offline Nodes"
          value={summary?.offline_nodes || 0}
          icon={XCircle}
          badge={summary?.offline_nodes > 0 ? "Requires Action" : "None"}
          badgeColor={summary?.offline_nodes > 0 ? "rose" : "gray"}
        />
        <StatCard
          title="Active Alerts"
          value={summary?.active_alerts || 0}
          icon={AlertTriangle}
          badge={summary?.active_alerts > 0 ? "Triggered" : "Resolved"}
          badgeColor={summary?.active_alerts > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* 3. Aggregate Resource Averages */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Cluster Avg CPU"
          value={formatPercent(summary?.avg_cpu)}
          icon={Cpu}
          subvalue="Across all online servers"
        />
        <StatCard
          title="Cluster Avg RAM"
          value={formatPercent(summary?.avg_memory)}
          icon={Layers}
          subvalue="Physical memory usage"
        />
        <StatCard
          title="Cluster Avg Disk"
          value={formatPercent(summary?.avg_disk)}
          icon={HardDrive}
          subvalue="Primary filesystem usage"
        />
        <StatCard
          title="Network Throughput"
          value={formatNetworkSpeed(summary?.total_network_rx)}
          icon={Activity}
          subvalue={`TX: ${formatNetworkSpeed(summary?.total_network_tx)}`}
        />
      </div>

      {/* 4. Real-Time Resource Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricChart
          title="Cluster Real-Time CPU Trend"
          data={cpuTrend}
          unit="%"
          color="blue"
          height={160}
        />
        <MetricChart
          title="Cluster Real-Time Memory Trend"
          data={memTrend}
          unit="%"
          color="emerald"
          height={160}
        />
      </div>

      {/* 5. Active Alerts & Recent Activity Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Alerts (Span 2 cols) */}
        <div className="lg:col-span-2 bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-amber-400" />
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
                View All <ArrowUpRight size={14} />
              </button>
            )}
          </div>

          {!summary?.recent_alerts || summary.recent_alerts.length === 0 ? (
            <div className="py-8 text-center text-dark-400 text-xs">
              <CheckCircle2 size={28} className="mx-auto text-emerald-400 mb-2 opacity-80" />
              No active alerts. All thresholds within normal boundaries.
            </div>
          ) : (
            <div className="space-y-2.5">
              {summary.recent_alerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className="p-3 bg-dark-950 border border-dark-800 rounded-xl flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        alert.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'
                      }`} />
                      <span className="font-semibold text-white truncate">{alert.rule_name || 'System Alert'}</span>
                      <span className="text-dark-500">•</span>
                      <span className="text-brand-400 font-mono truncate">{alert.node_name}</span>
                    </div>
                    <p className="text-dark-400 text-[11px] truncate">{alert.message}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-dark-500 font-mono">{timeAgo(alert.triggered_at)}</span>
                    <button
                      onClick={() => handleAck(alert.id)}
                      title="Acknowledge Alert"
                      className="px-2 py-1 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors"
                    >
                      <Check size={12} /> Ack
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity Log (Span 1 col) */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <History size={18} className="text-dark-400" />
            <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
          </div>

          {!summary?.recent_activity || summary.recent_activity.length === 0 ? (
            <div className="py-8 text-center text-dark-500 text-xs">
              No audit logs recorded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {summary.recent_activity.slice(0, 6).map((log) => (
                <div key={log.id} className="text-xs border-l-2 border-dark-700 pl-3 py-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-dark-200">{log.action}</span>
                    <span className="text-dark-500 font-mono">{timeAgo(log.created_at)}</span>
                  </div>
                  <p className="text-[11px] text-dark-400 truncate mt-0.5">{log.details}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
