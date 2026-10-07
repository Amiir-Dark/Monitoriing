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
} from 'lucide-react';

export default function Alerts() {
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
            Monitor real-time infrastructure incidents and configure automated alert triggers
          </p>
        </div>

        {activeTab === 'rules' && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-glow-brand transition-all self-start md:self-auto"
          >
            <Plus size={16} /> New Rule
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
          <Sliders size={16} /> Configured Rules ({rules.length})
        </button>
      </div>

      {/* ACTIVE ALERTS TAB */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          {/* Status filters */}
          <div className="flex items-center gap-1.5 text-xs">
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
              <p className="text-xs text-dark-400 mt-1">Infrastructure thresholds are operating within nominal range.</p>
            </div>
          ) : (
            <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs divide-y divide-dark-800">
              {alerts.map((alert) => (
                <div key={alert.id} className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        alert.severity === 'critical' ? 'bg-rose-500 shadow-glow-rose' : 'bg-amber-500'
                      }`} />
                      <h4 className="font-bold text-white text-sm">{alert.rule_name || 'System Alert'}</h4>
                      <span className="text-dark-500">•</span>
                      <span className="font-mono text-brand-400">{alert.node_name}</span>
                      <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        alert.status === 'triggered'
                          ? 'bg-rose-500/20 text-rose-300'
                          : alert.status === 'acknowledged'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}>
                        {alert.status}
                      </span>
                    </div>

                    <p className="text-dark-300">{alert.message}</p>
                    <p className="text-[10px] text-dark-500 font-mono">
                      Triggered: {formatDate(alert.triggered_at)} ({timeAgo(alert.triggered_at)})
                    </p>
                  </div>

                  {alert.status !== 'resolved' && (
                    <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                      {alert.status === 'triggered' && (
                        <button
                          onClick={() => handleAck(alert.id)}
                          className="px-3 py-1.5 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors border border-dark-700"
                        >
                          <Check size={14} /> Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => handleResolve(alert.id)}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-emerald-500/30"
                      >
                        <CheckCircle2 size={14} /> Resolve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* RULES TAB */}
      {activeTab === 'rules' && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs divide-y divide-dark-800">
          <div className="px-6 py-4 bg-dark-950 border-b border-dark-800 flex items-center justify-between text-xs text-dark-400 font-medium">
            <span>Configured Rule & Threshold</span>
            <span>State & Actions</span>
          </div>

          {rules.map((rule) => (
            <div key={rule.id} className="p-4 md:px-6 flex items-center justify-between gap-4 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    rule.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'
                  }`} />
                  <h4 className="font-semibold text-white">{rule.name}</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-dark-950 border border-dark-800 font-mono text-dark-300">
                    {rule.metric_type} {rule.operator} {rule.threshold}
                  </span>
                </div>
                <p className="text-[11px] text-dark-400 mt-1">
                  Triggers after sustained for {rule.duration_seconds}s • Severity: {rule.severity}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggleRule(rule)}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                    rule.enabled ? 'bg-brand-600 justify-end' : 'bg-dark-800 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 bg-white rounded-full shadow-md" />
                </button>

                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="p-1.5 text-dark-400 hover:text-rose-400 rounded-lg hover:bg-dark-800 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Rule Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Create Alert Rule</h3>
              <button onClick={() => setModalOpen(false)} className="text-dark-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveNewRule} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-dark-300 mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Critical RAM Spike"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-lg p-2.5 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-dark-300 mb-1">Metric Type</label>
                  <select
                    value={metricType}
                    onChange={(e) => setMetricType(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-lg p-2.5 text-white"
                  >
                    <option value="cpu">CPU (%)</option>
                    <option value="memory">Memory (%)</option>
                    <option value="disk">Disk (%)</option>
                    <option value="load1">System Load 1m</option>
                    <option value="temperature">Temperature (°C)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-dark-300 mb-1">Threshold</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-lg p-2.5 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-dark-300 mb-1">Duration (Seconds)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-dark-300 mb-1">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-lg p-2.5 text-white"
                  >
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 bg-dark-800 text-dark-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 text-white rounded-lg font-semibold"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
