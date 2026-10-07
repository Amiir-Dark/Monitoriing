import { useState, useEffect } from 'react';
import {
  getTelegramSettings,
  saveTelegramSettings,
  testTelegram,
  getRetentionSettings,
  saveRetentionSettings,
  triggerBackup,
} from '../services/api';
import {
  Send,
  Database,
  Clock,
  ShieldCheck,
  Check,
  AlertTriangle,
  Download,
  Save,
} from 'lucide-react';

export default function Settings() {
  // Telegram State
  const [botToken, setBotToken] = useState('');
  const [chatID, setChatID] = useState('');
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);
  const [tgSuccess, setTgSuccess] = useState('');
  const [tgError, setTgError] = useState('');
  const [testingTg, setTestingTg] = useState(false);

  // Retention State
  const [retention, setRetention] = useState({
    raw_days: 7,
    hourly_days: 90,
    daily_days: 365,
    offline_seconds: 30,
  });
  const [retSaving, setRetSaving] = useState(false);
  const [retSuccess, setRetSuccess] = useState('');

  // Backup State
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState(null);

  useEffect(() => {
    getTelegramSettings().then((data) => {
      if (data) {
        setBotToken(data.bot_token || '');
        setChatID(data.chat_id || '');
        setTgEnabled(data.enabled || false);
      }
    }).catch(() => {});

    getRetentionSettings().then((data) => {
      if (data) setRetention(data);
    }).catch(() => {});
  }, []);

  const handleSaveTelegram = async (e) => {
    e.preventDefault();
    setTgSaving(true);
    setTgSuccess('');
    setTgError('');
    try {
      await saveTelegramSettings({
        bot_token: botToken,
        chat_id: chatID,
        enabled: tgEnabled,
      });
      setTgSuccess('Telegram integration updated successfully.');
      setTimeout(() => setTgSuccess(''), 3000);
    } catch (err) {
      setTgError(err.message || 'Failed to save Telegram settings');
    } finally {
      setTgSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    setTestingTg(true);
    setTgSuccess('');
    setTgError('');
    try {
      await testTelegram({ bot_token: botToken, chat_id: chatID });
      setTgSuccess('Test alert message delivered successfully to your Telegram chat!');
    } catch (err) {
      setTgError(err.message || 'Telegram test failed. Please verify Bot Token and Chat ID.');
    } finally {
      setTestingTg(false);
    }
  };

  const handleSaveRetention = async (e) => {
    e.preventDefault();
    setRetSaving(true);
    setRetSuccess('');
    try {
      await saveRetentionSettings({
        raw_days: parseInt(retention.raw_days, 10),
        hourly_days: parseInt(retention.hourly_days, 10),
        daily_days: parseInt(retention.daily_days, 10),
        offline_seconds: parseInt(retention.offline_seconds, 10),
      });
      setRetSuccess('Retention policies saved.');
      setTimeout(() => setRetSuccess(''), 3000);
    } catch {
      // silent
    } finally {
      setRetSaving(false);
    }
  };

  const handleCreateBackup = async () => {
    setBackingUp(true);
    setBackupResult(null);
    try {
      const res = await triggerBackup();
      setBackupResult(res);
    } catch (err) {
      alert('Backup failed: ' + err.message);
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">System Settings</h2>
        <p className="text-xs text-dark-400 mt-0.5">
          Configure notifications, automated metric rollups, and SQLite maintenance
        </p>
      </div>

      {/* 1. TELEGRAM NOTIFICATIONS */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Send size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Telegram Notifications</h3>
            <p className="text-xs text-dark-400">
              Receive instant alerts when servers go offline, overheat, or breach CPU/RAM thresholds
            </p>
          </div>
        </div>

        {tgSuccess && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center gap-2">
            <Check size={16} /> {tgSuccess}
          </div>
        )}
        {tgError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle size={16} /> {tgError}
          </div>
        )}

        <form onSubmit={handleSaveTelegram} className="space-y-4 text-xs pt-2">
          <div className="flex items-center justify-between p-3 bg-dark-950 border border-dark-800 rounded-xl">
            <div>
              <p className="font-semibold text-white">Enable Telegram Alerts</p>
              <p className="text-dark-400 text-[11px]">Send notifications on incident events and resolutions</p>
            </div>
            <button
              type="button"
              onClick={() => setTgEnabled(!tgEnabled)}
              className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                tgEnabled ? 'bg-brand-600 justify-end' : 'bg-dark-800 justify-start'
              }`}
            >
              <div className="w-4 h-4 bg-white rounded-full shadow-md" />
            </button>
          </div>

          <div>
            <label className="block font-medium text-dark-300 mb-1">Telegram Bot Token</label>
            <input
              type="password"
              placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              className="w-full bg-dark-950 border border-dark-800 rounded-xl p-2.5 text-white placeholder-dark-600 font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-dark-300 mb-1">Target Chat ID</label>
            <input
              type="text"
              placeholder="e.g. -100123456789 or personal chat ID"
              value={chatID}
              onChange={(e) => setChatID(e.target.value)}
              className="w-full bg-dark-950 border border-dark-800 rounded-xl p-2.5 text-white placeholder-dark-600 font-mono"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              disabled={testingTg || !botToken || !chatID}
              onClick={handleTestTelegram}
              className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-xl font-medium transition-colors border border-dark-700 disabled:opacity-50"
            >
              {testingTg ? 'Sending...' : 'Test Connection'}
            </button>
            <button
              type="submit"
              disabled={tgSaving}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-semibold shadow-glow-brand transition-colors disabled:opacity-50"
            >
              {tgSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>

      {/* 2. METRIC RETENTION & DOWN-SAMPLING */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Clock size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Metric Retention & Aggregation</h3>
            <p className="text-xs text-dark-400">
              Configure automatic background roll-ups and storage limits to prevent indefinite growth
            </p>
          </div>
        </div>

        {retSuccess && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center gap-2">
            <Check size={16} /> {retSuccess}
          </div>
        )}

        <form onSubmit={handleSaveRetention} className="space-y-4 text-xs pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-dark-950 border border-dark-800 rounded-xl p-3.5">
              <label className="block font-medium text-dark-300 mb-1">Raw Metrics Retention</label>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={retention.raw_days}
                  onChange={(e) => setRetention({ ...retention, raw_days: e.target.value })}
                  className="w-20 bg-dark-900 border border-dark-700 rounded-lg p-1.5 text-center text-white font-mono"
                />
                <span className="text-dark-400">Days</span>
              </div>
              <p className="text-[10px] text-dark-500 mt-2">Default: 7 days. High frequency points.</p>
            </div>

            <div className="bg-dark-950 border border-dark-800 rounded-xl p-3.5">
              <label className="block font-medium text-dark-300 mb-1">Hourly Rollups Retention</label>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={retention.hourly_days}
                  onChange={(e) => setRetention({ ...retention, hourly_days: e.target.value })}
                  className="w-20 bg-dark-900 border border-dark-700 rounded-lg p-1.5 text-center text-white font-mono"
                />
                <span className="text-dark-400">Days</span>
              </div>
              <p className="text-[10px] text-dark-500 mt-2">Default: 90 days. Min/Max/Avg hourly.</p>
            </div>

            <div className="bg-dark-950 border border-dark-800 rounded-xl p-3.5">
              <label className="block font-medium text-dark-300 mb-1">Daily Rollups Retention</label>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  min="30"
                  max="1825"
                  value={retention.daily_days}
                  onChange={(e) => setRetention({ ...retention, daily_days: e.target.value })}
                  className="w-20 bg-dark-900 border border-dark-700 rounded-lg p-1.5 text-center text-white font-mono"
                />
                <span className="text-dark-400">Days</span>
              </div>
              <p className="text-[10px] text-dark-500 mt-2">Default: 365 days. 1-year historical trends.</p>
            </div>
          </div>

          <div className="bg-dark-950 border border-dark-800 rounded-xl p-3.5">
            <label className="block font-medium text-dark-300 mb-1">Node Heartbeat Offline Timeout</label>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="number"
                min="10"
                max="300"
                value={retention.offline_seconds}
                onChange={(e) => setRetention({ ...retention, offline_seconds: e.target.value })}
                className="w-24 bg-dark-900 border border-dark-700 rounded-lg p-1.5 text-center text-white font-mono"
              />
              <span className="text-dark-400">Seconds without heartbeat marks node offline</span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={retSaving}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-semibold shadow-glow-brand transition-colors"
            >
              <Save size={14} /> {retSaving ? 'Saving...' : 'Update Retention'}
            </button>
          </div>
        </form>
      </div>

      {/* 3. DATABASE MAINTENANCE & ATOMIC BACKUP */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Database size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">SQLite Database & Backups</h3>
            <p className="text-xs text-dark-400">
              Safe atomic snapshot using VACUUM INTO while WAL mode is active
            </p>
          </div>
        </div>

        <div className="p-4 bg-dark-950 border border-dark-800 rounded-xl space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-dark-400">Storage Engine:</span>
            <span className="font-mono text-white">SQLite 3 (WAL mode)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-dark-400">Path:</span>
            <span className="font-mono text-white">./data/nodewatch.db</span>
          </div>
        </div>

        {backupResult && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check size={16} />
              <span>Backup snapshot created: <strong className="font-mono">{backupResult.filename}</strong></span>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleCreateBackup}
            disabled={backingUp}
            className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-xl text-xs font-semibold border border-dark-700 transition-colors"
          >
            <Download size={14} /> {backingUp ? 'Creating Atomic Snapshot...' : 'Create Instant SQLite Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}
