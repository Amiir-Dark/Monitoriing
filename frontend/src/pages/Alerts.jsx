import { useState, useEffect } from 'react';
import {
  getAlerts,
  acknowledgeAlert,
  resolveAlert,
  getAlertRules,
  saveAlertRule,
  deleteAlertRule,
} from '../services/api';
import { formatDate, timeAgo } from '../utils/formatters';
import {
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Plus,
  Trash2,
  Check,
  ShieldAlert,
  X,
  ExternalLink,
  Server,
} from 'lucide-react';

export default function Alerts({ onSelectNode }) {
  const [activeTab, setActiveTab] = useState('active'); // active, rules
  const [alerts, setAlerts] = useState([]);
  const [rules, setRules] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // New Rule Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [metricType, setMetricType] = useState('cpu');
  const [operator, setOperator] = useState('>');
  const [threshold, setThreshold] = useState(90);
  const [duration, setDuration] = useState(120);
  const [severity, setSeverity] = useState('critical');

  const fetchData = async () => {
    try {
      const [alertsData, rulesData] = await Promise.all([
        getAlerts(statusFilter),
        getAlertRules(),
      ]);
      setAlerts(alertsData || []);
      setRules(rulesData || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const handleAck = async (id) => {
    await acknowledgeAlert(id);
    fetchData();
  };

  const handleResolve = async (id) => {
    await resolveAlert(id);
    fetchData();
  };

  const handleToggleRule = async (rule) => {
    await saveAlertRule({ ...rule, enabled: !rule.enabled });
    fetchData();
  };

  const handleDeleteRule = async (id) => {
    if (!window.confirm('Delete this alert rule?')) return;
    await deleteAlertRule(id);
    fetchData();
  };

  const handleSaveNewRule = async (e) => {
    e.preventDefault();
    await saveAlertRule({
      name: ruleName,
      metric_type: metricType,
      operator,
      threshold: parseFloat(threshold),
      duration_seconds: parseInt(duration, 10),
      severity,
      enabled: true,
    });
    setModalOpen(false);
    setRuleName('');
    fetchData();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Alerts & Engine Rules</h2>
          <p className="text-xs text-dark-400 mt-0.5">
            Monitor infrastructure incidents and configure automated kernel metric thresholds
          </p>
        </div>

        {activeTab === 'rules' && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-glow-brand transition-all self-start md:self-auto"
          >
            <Plus size={16} /> New Alert Rule
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-800 gap-4">
        <button
          onClick={() => setActiveTab('active')}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 -mb-px transition-colors ${
            activeTab === 'active'
              ? 'border-brand-500 text-white'
              : 'border-transparent text-dark-400 hover:text-dark-200'
          }`}
        >
          <ShieldAlert size={16} /> Active & Past Incidents ({alerts.length})
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 -mb-px transition-colors ${
            activeTab === 'rules'
              ? 'border-brand-500 text-white'
              : 'border-transparent text-dark-400 hover:text-dark-200'
          }`}
        >
          <Sliders size={16} /> Configured Threshold Rules ({rules.length})
        </button>
      </div>

      {/* ACTIVE ALERTS TAB */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          {/* Status filters */}
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-dark-500 mr-1">Filter:</span>
            {['', 'triggered', 'acknowledged', 'resolved'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg font-medium capitalize border transition-colors ${
                  statusFilter === st
                    ? 'bg-brand-600/20 text-brand-400 border-brand-500/30'
                    : 'bg-dark-950 text-dark-400 border-dark-800 hover:text-dark-200'
                }`}
              >
                {st || 'All'}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="h-44 bg-dark-900 rounded-2xl animate-pulse" />
          ) : alerts.length === 0 ? (
            <div className="py-16 bg-dark-900 border border-dark-800 rounded-2xl text-center">
              <CheckCircle2 size={36} className="mx-auto text-emerald-400 mb-2 opacity-80" />
              <h3 className="text-base font-semibold text-white">No incidents found</h3>
              <p className="text-xs text-dark-400 mt-1 font-mono">
                All infrastructure telemetry is operating within nominal thresholds.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => {
                const isCrit = alert.severity === 'critical';
                const isWarn = alert.severity === 'warning';

                return (
                  <div
                    key={alert.id}
                    className="p-5 bg-dark-900 border border-dark-800 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs font-mono shadow-xs transition-colors hover:border-dark-700"
                  >
                    <div className="space-y-2 flex-1">
                      {/* Severity & Issue Header */}
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            isCrit
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : isWarn
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {alert.severity?.toUpperCase() || 'ALERT'}
                        </span>

                        <span className="text-sm font-bold text-white">
                          Issue: {alert.rule_name || alert.message || 'Infrastructure Alert'}
                        </span>

                        <span className="text-dark-500">•</span>

                        <div className="flex items-center gap-1.5 text-brand-400">
                          <Server size={13} />
                          <span className="font-semibold">{alert.node_name || 'Server'}</span>
                        </div>

                        <span
                          className={`ml-auto lg:ml-2 px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            alert.status === 'triggered'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : alert.status === 'acknowledged'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {alert.status}
                        </span>
                      </div>

                      {/* Message / Description */}
                      <p className="text-dark-300 font-sans text-xs leading-relaxed">
                        {alert.message}
                      </p>

                      {/* Required Metadata: Server, Metric, Current Value, Threshold, Started At, Duration, Last Update */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 pt-2 border-t border-dark-800/80 text-[11px] text-dark-400">
                        <div>
                          <span className="text-dark-500 block text-[10px] uppercase">Metric</span>
                          <span className="text-dark-200 font-semibold">{alert.metric || 'cpu_usage'}</span>
                        </div>
                        <div>
                          <span className="text-dark-500 block text-[10px] uppercase">Current</span>
                          <span className="text-white font-bold">{alert.value !== undefined ? `${alert.value}%` : '—'}</span>
                        </div>
                        <div>
                          <span className="text-dark-500 block text-[10px] uppercase">Threshold</span>
                          <span className="text-dark-200 font-semibold">{alert.threshold !== undefined ? `${alert.threshold}%` : '—'}</span>
                        </div>
                        <div>
                          <span className="text-dark-500 block text-[10px] uppercase">Started At</span>
                          <span className="text-dark-200">{formatDate(alert.triggered_at)}</span>
                        </div>
                        <div>
                          <span className="text-dark-500 block text-[10px] uppercase">Duration</span>
                          <span className="text-amber-400 font-semibold">{alert.duration || timeAgo(alert.triggered_at)}</span>
                        </div>
                        <div>
                          <span className="text-dark-500 block text-[10px] uppercase">Last Update</span>
                          <span className="text-dark-300">{alert.last_update ? timeAgo(alert.last_update) : 'just now'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons: Acknowledge, Resolve, View Server */}
                    <div className="flex items-center gap-2 self-end lg:self-center shrink-0 pt-2 lg:pt-0">
                      {onSelectNode && alert.node_id && (
                        <button
                          onClick={() => onSelectNode(alert.node_id)}
                          className="px-3 py-1.5 bg-dark-800 hover:bg-dark-700 text-dark-200 hover:text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors border border-dark-700"
                        >
                          <ExternalLink size={13} /> View Server
                        </button>
                      )}

                      {alert.status === 'triggered' && (
                        <button
                          onClick={() => handleAck(alert.id)}
                          className="px-3 py-1.5 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors border border-dark-700"
                        >
                          <Check size={14} /> Acknowledge
                        </button>
                      )}

                      {alert.status !== 'resolved' && (
                        <button
                          onClick={() => handleResolve(alert.id)}
                          className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-emerald-500/30"
                        >
                          <CheckCircle2 size={14} /> Resolve
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* RULES TAB */}
      {activeTab === 'rules' && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs divide-y divide-dark-800">
          <div className="px-6 py-4 bg-dark-950 border-b border-dark-800 flex items-center justify-between text-xs text-dark-400 font-medium font-mono">
            <span>Configured Kernel Metric Threshold Rule</span>
            <span>State & Actions</span>
          </div>

          {rules.map((rule) => (
            <div key={rule.id} className="p-4 md:px-6 flex items-center justify-between gap-4 text-xs font-mono">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      rule.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'
                    }`}
                  />
                  <h4 className="font-semibold text-white">{rule.name}</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-dark-950 border border-dark-800 text-brand-300">
                    {rule.metric_type} {rule.operator} {rule.threshold}
                  </span>
                </div>
                <p className="text-[11px] text-dark-400 mt-1 font-sans">
                  Sustained for {rule.duration_seconds}s before trigger • Severity: {rule.severity}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggleRule(rule)}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                    rule.enabled ? 'bg-brand-600 justify-end' : 'bg-dark-800 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-xs" />
                </button>

                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="p-1.5 text-dark-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NEW RULE MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-dark-800">
              <h3 className="text-base font-bold text-white">Create Metric Alert Trigger</h3>
              <button onClick={() => setModalOpen(false)} className="text-dark-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveNewRule} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-dark-400 mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Critical High RAM"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-white placeholder-dark-600 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-dark-400 mb-1">Metric</label>
                  <select
                    value={metricType}
                    onChange={(e) => setMetricType(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="cpu">CPU Usage (%)</option>
                    <option value="memory">Memory Usage (%)</option>
                    <option value="disk">Disk Usage (%)</option>
                    <option value="load1">1m Load Average</option>
                    <option value="temperature">Core Temp (°C)</option>
                    <option value="network_drops">Packet Drops/s</option>
                    <option value="network_errors">Packet Errors/s</option>
                  </select>
                </div>

                <div>
                  <label className="block text-dark-400 mb-1">Operator & Threshold</label>
                  <div className="flex gap-2">
                    <select
                      value={operator}
                      onChange={(e) => setOperator(e.target.value)}
                      className="w-16 bg-dark-950 border border-dark-800 rounded-xl px-2 py-2 text-white focus:outline-none"
                    >
                      <option value=">">&gt;</option>
                      <option value=">=">&gt;=</option>
                      <option value="<">&lt;</option>
                    </select>
                    <input
                      type="number"
                      step="any"
                      required
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      className="flex-1 bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-dark-400 mb-1">Sustained Duration (s)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-dark-400 mb-1">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-dark-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 bg-dark-800 text-dark-300 rounded-xl hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-semibold shadow-glow-brand"
                >
                  Save Trigger Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
