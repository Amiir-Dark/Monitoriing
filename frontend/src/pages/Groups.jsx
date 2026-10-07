import { useState, useEffect } from 'react';
import { getGroups, createGroup, deleteGroup } from '../services/api';
import { FolderKanban, Plus, Trash2, Server, X } from 'lucide-react';

export default function Groups({ onSelectGroup }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const fetchGroups = async () => {
    try {
      const data = await getGroups();
      setGroups(data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createGroup({ name, description });
    setName('');
    setDescription('');
    setModalOpen(false);
    fetchGroups();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this server group? Nodes inside will remain unassigned.')) return;
    await deleteGroup(id);
    fetchGroups();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Server Groups</h2>
          <p className="text-xs text-dark-400 mt-0.5">
            Organize servers by region, environment, or cluster
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-glow-brand transition-all self-start md:self-auto"
        >
          <Plus size={16} /> Create Group
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-dark-900 rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 bg-dark-900 border border-dark-800 rounded-2xl text-center p-6">
          <FolderKanban size={36} className="mx-auto text-dark-500 mb-2" />
          <h3 className="text-base font-semibold text-white">No Groups Created</h3>
          <p className="text-xs text-dark-400 mt-1 max-w-sm mx-auto mb-4">
            Group your Linux nodes by location (e.g., Europe, US) or tier (e.g., Database, Web).
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl text-xs font-semibold shadow-glow-brand"
          >
            Create Group
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <div
              key={g.id}
              className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-bold text-white">{g.name}</h3>
                  <button
                    onClick={() => handleDelete(g.id)}
                    className="text-dark-500 hover:text-rose-400 p-1 rounded transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <p className="text-xs text-dark-400 line-clamp-2">
                  {g.description || 'No description provided.'}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-dark-800/80 flex items-center justify-between text-xs font-mono text-dark-400">
                <span className="flex items-center gap-1.5">
                  <Server size={14} className="text-dark-500" />
                  {g.node_count || 0} Nodes
                </span>
                {onSelectGroup && (
                  <button
                    onClick={() => onSelectGroup(g.id)}
                    className="text-brand-400 hover:text-brand-300 font-sans"
                  >
                    View Nodes →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Create Server Group</h3>
              <button onClick={() => setModalOpen(false)} className="text-dark-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-dark-300 mb-1">Group Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production US-East"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-lg p-2.5 text-white"
                />
              </div>

              <div>
                <label className="block font-medium text-dark-300 mb-1">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Notes about this cluster"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-lg p-2.5 text-white resize-none"
                />
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
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
