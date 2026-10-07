import { useState } from 'react';
import { createNode } from '../../services/api';
import { X, Copy, Check, Terminal, Server, ShieldCheck } from 'lucide-react';

export default function AddNodeModal({ isOpen, onClose, onNodeCreated, groups = [] }) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Result state after creation
  const [createdData, setCreatedData] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError('');

    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await createNode({
        name: name.trim(),
        group_id: groupId || null,
        tags,
      });

      setCreatedData(res);
      if (onNodeCreated) onNodeCreated(res.node);
    } catch (err) {
      setError(err.message || 'Failed to create node');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setName('');
    setGroupId('');
    setTagsInput('');
    setCreatedData(null);
    setError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-brand-500/10 text-brand-400 rounded-lg border border-brand-500/20">
              <Server size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                {createdData ? 'Node Created Successfully' : 'Add New Server Node'}
              </h3>
              <p className="text-xs text-dark-400">
                {createdData ? 'Execute the install command on your Linux server' : 'Register a new server to monitor with NodeWatch'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-dark-400 hover:text-white p-1 rounded-lg hover:bg-dark-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {error}
            </div>
          )}

          {!createdData ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-dark-300 mb-1.5">
                  Server Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Frankfurt-Worker-01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-dark-300 mb-1.5">
                  Server Group (Optional)
                </label>
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                >
                  <option value="">No Group</option>
                  {safeGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-dark-300 mb-1.5">
                  Tags (Comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. production, docker, germany"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-dark-300 hover:text-white bg-dark-800 hover:bg-dark-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50 transition-colors shadow-glow-brand"
                >
                  {loading ? 'Creating...' : 'Create & Generate Command'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3">
                <ShieldCheck className="text-emerald-400 shrink-0" size={20} />
                <div className="text-xs text-dark-200">
                  Node token generated securely. Copy the command below and execute it with root / sudo permissions on your remote Linux server.
                </div>
              </div>

              {(() => {
                const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8765';
                const rawCmd = createdData.install_command || `curl -fsSL ${origin}/install.sh | sudo bash -s -- --token "${createdData.token}"`;
                const finalCmd = rawCmd.replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/gi, origin);

                return (
                  <div>
                    <label className="block text-xs font-medium text-dark-400 mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><Terminal size={14} /> One-Line Installation Command</span>
                      <span className="text-[11px] text-brand-400 font-mono">Target Server: {typeof window !== 'undefined' ? window.location.host : 'localhost:8765'}</span>
                    </label>
                    <div className="relative">
                      <textarea
                        readOnly
                        rows={3}
                        value={finalCmd}
                        className="w-full font-mono text-xs bg-dark-950 border border-dark-800 rounded-xl p-3 text-dark-200 resize-none select-all focus:outline-none focus:border-brand-500"
                      />
                      <button
                        onClick={() => handleCopy(finalCmd)}
                        className="absolute top-2.5 right-2.5 px-3 py-1.5 bg-dark-800 hover:bg-dark-700 border border-dark-700 text-xs font-medium text-white rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        {copied ? (
                          <>
                            <Check size={14} className="text-emerald-400" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy size={14} /> Copy Command
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3 text-xs bg-dark-950 p-3 rounded-xl border border-dark-800 font-mono">
                <div>
                  <span className="text-dark-500">Node Name:</span>{' '}
                  <span className="text-dark-200">{createdData.node.name}</span>
                </div>
                <div>
                  <span className="text-dark-500">Node ID:</span>{' '}
                  <span className="text-dark-200 truncate">{createdData.node.id}</span>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 transition-colors shadow-glow-brand"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
