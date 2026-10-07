import { useState, useEffect } from 'react';
import { getNodes, getGroups } from '../services/api';
import { wsService } from '../services/ws';
import NodeStatusBadge from '../components/common/NodeStatusBadge';
import AddNodeModal from '../components/nodes/AddNodeModal';
import { formatPercent, formatNetworkSpeed, timeAgo } from '../utils/formatters';
import {
  Server,
  Search,
  Filter,
  Plus,
  LayoutGrid,
  List,
  HardDrive,
  Cpu,
  Layers,
  Activity,
  Tag,
  ArrowRight,
} from 'lucide-react';

export default function Nodes({ onSelectNode }) {
  const [nodes, setNodes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters & View state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [sortBy, setSortBy] = useState('created'); // created, name, cpu, memory
  const [viewMode, setViewMode] = useState('grid'); // grid, table
  const [addModalOpen, setAddModalOpen] = useState(false);

  const fetchNodes = async () => {
    try {
      const [nodesData, groupsData] = await Promise.all([
        getNodes({ search, status: statusFilter, group: groupFilter, tag: selectedTag }),
        getGroups(),
      ]);
      setNodes(Array.isArray(nodesData) ? nodesData : []);
      setGroups(Array.isArray(groupsData) ? groupsData : []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load nodes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
    const handleNodeCreated = () => fetchNodes();
    window.addEventListener('node:created', handleNodeCreated);
    return () => window.removeEventListener('node:created', handleNodeCreated);
  }, [search, statusFilter, groupFilter, selectedTag]);

  // Real-time WebSocket live updates
  useEffect(() => {
    const unsubMetrics = wsService.subscribe('node_metrics', (event) => {
      if (!event || !event.node_id || !event.metrics) return;
      setNodes((prev) =>
        prev.map((node) => {
          if (node.id === event.node_id) {
            return {
              ...node,
              status: 'online',
              last_seen: new Date().toISOString(),
              latest_metrics: {
                ...node.latest_metrics,
                cpu: event.metrics.cpu,
                memory: event.metrics.memory,
                disk: event.metrics.disk,
                network_rx: event.metrics.network_rx,
                network_tx: event.metrics.network_tx,
              },
            };
          }
          return node;
        })
      );
    });

    const unsubStatus = wsService.subscribe('node_status', (event) => {
      if (!event || !event.id) return;
      setNodes((prev) =>
        prev.map((node) => (node.id === event.id ? { ...node, status: event.status } : node))
      );
    });

    return () => {
      unsubMetrics();
      unsubStatus();
    };
  }, []);

  // Collect all unique tags across nodes
  const allTags = Array.from(
    new Set(nodes.flatMap((n) => n.tags || []))
  );

  // Sorting
  const sortedNodes = [...nodes].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'cpu') {
      const aVal = a.latest_metrics?.cpu || 0;
      const bVal = b.latest_metrics?.cpu || 0;
      return bVal - aVal;
    }
    if (sortBy === 'memory') {
      const aVal = a.latest_metrics?.memory || 0;
      const bVal = b.latest_metrics?.memory || 0;
      return bVal - aVal;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Server Nodes</h2>
          <p className="text-xs text-dark-400 mt-0.5">
            Manage, inspect, and monitor all registered Linux instances
          </p>
        </div>

        <button
          onClick={() => setAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-glow-brand transition-all self-start md:self-auto"
        >
          <Plus size={16} /> Add Server
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              placeholder="Search by name, hostname, or IP address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-dark-950 border border-dark-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Group Filter */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full md:w-44 bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-xs text-dark-200 focus:outline-none focus:border-brand-500"
          >
            <option value="">All Groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          {/* Sort selector */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full md:w-36 bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-xs text-dark-200 focus:outline-none focus:border-brand-500"
          >
            <option value="created">Sort: Newest</option>
            <option value="name">Sort: Name</option>
            <option value="cpu">Sort: CPU Usage</option>
            <option value="memory">Sort: RAM Usage</option>
          </select>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-dark-950 border border-dark-800 rounded-xl p-1 shrink-0 self-end md:self-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-dark-800 text-white' : 'text-dark-400 hover:text-dark-200'
              }`}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'table' ? 'bg-dark-800 text-white' : 'text-dark-400 hover:text-dark-200'
              }`}
            >
              <List size={15} />
            </button>
          </div>
        </div>

        {/* Status Pill Filters */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-dark-800/80">
          <span className="text-[11px] font-medium text-dark-500 mr-2 flex items-center gap-1">
            <Filter size={12} /> Status:
          </span>
          {['', 'online', 'offline', 'warning', 'disabled'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30'
                  : 'bg-dark-950 text-dark-400 hover:text-dark-200 border border-dark-800'
              }`}
            >
              {st || 'All'}
            </button>
          ))}

          {/* Tag filters */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 ml-auto">
              <span className="text-[11px] font-medium text-dark-500 mr-1 flex items-center gap-1">
                <Tag size={12} /> Tag:
              </span>
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag('')}
                  className="px-2 py-0.5 rounded-md text-[11px] bg-dark-800 text-dark-300"
                >
                  Clear
                </button>
              )}
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                  className={`px-2 py-0.5 rounded-md text-[11px] border transition-colors ${
                    selectedTag === tag
                      ? 'bg-brand-500/20 border-brand-500 text-brand-300'
                      : 'bg-dark-950 border-dark-800 text-dark-400 hover:text-dark-200'
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nodes List / Grid Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 bg-dark-900 rounded-2xl border border-dark-800" />
          ))}
        </div>
      ) : sortedNodes.length === 0 ? (
        <div className="py-16 bg-dark-900 border border-dark-800 rounded-2xl text-center p-6">
          <Server size={36} className="mx-auto text-dark-500 mb-3" />
          <h3 className="text-base font-semibold text-white">No nodes connected yet</h3>
          <p className="text-xs text-dark-400 mt-1 max-w-sm mx-auto mb-5">
            Add your first server node to receive system metrics, configure alerts, and start real-time monitoring.
          </p>
          <button
            onClick={() => setAddModalOpen(true)}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-glow-brand"
          >
            Add Your First Node
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedNodes.map((node) => {
            const isOnline = node.status === 'online' && node.latest_metrics;
            const cpu = isOnline ? node.latest_metrics.cpu : null;
            const mem = isOnline ? node.latest_metrics.memory : null;
            const disk = isOnline ? node.latest_metrics.disk : null;
            const netRX = isOnline ? node.latest_metrics.network_rx : null;

            return (
              <div
                key={node.id}
                onClick={() => onSelectNode(node.id)}
                className="group bg-dark-900 hover:bg-dark-850 border border-dark-800 hover:border-dark-700 rounded-2xl p-5 shadow-xs cursor-pointer transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top card header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white group-hover:text-brand-400 transition-colors truncate">
                          {node.name}
                        </h4>
                        {node.group_name && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-800 text-dark-300 font-mono">
                            {node.group_name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-dark-400 font-mono mt-0.5 truncate">
                        {node.ip_address || node.hostname || 'Pending connection'}
                      </p>
                    </div>
                    <NodeStatusBadge status={node.status} disabled={node.disabled} />
                  </div>

                  {/* Tags */}
                  {node.tags && node.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {node.tags.map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-dark-950 text-dark-400 border border-dark-800">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Metric Gauges Grid */}
                  <div className="grid grid-cols-3 gap-2 py-3 border-y border-dark-800/80">
                    <div className="text-center">
                      <span className="text-[10px] text-dark-500 font-medium uppercase flex items-center justify-center gap-1">
                        <Cpu size={11} /> CPU
                      </span>
                      <p className={`text-sm font-bold mt-0.5 tabular-nums ${
                        cpu > 85 ? 'text-rose-400' : cpu > 70 ? 'text-amber-400' : 'text-white'
                      }`}>
                        {formatPercent(cpu)}
                      </p>
                    </div>

                    <div className="text-center border-x border-dark-800">
                      <span className="text-[10px] text-dark-500 font-medium uppercase flex items-center justify-center gap-1">
                        <Layers size={11} /> RAM
                      </span>
                      <p className={`text-sm font-bold mt-0.5 tabular-nums ${
                        mem > 85 ? 'text-rose-400' : mem > 70 ? 'text-amber-400' : 'text-white'
                      }`}>
                        {formatPercent(mem)}
                      </p>
                    </div>

                    <div className="text-center">
                      <span className="text-[10px] text-dark-500 font-medium uppercase flex items-center justify-center gap-1">
                        <HardDrive size={11} /> Disk
                      </span>
                      <p className={`text-sm font-bold mt-0.5 tabular-nums ${
                        disk > 85 ? 'text-rose-400' : 'text-white'
                      }`}>
                        {formatPercent(disk)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer info */}
                <div className="mt-4 pt-2 flex items-center justify-between text-[11px] text-dark-400 font-mono">
                  <div className="flex items-center gap-1">
                    <Activity size={12} className="text-dark-500" />
                    <span>RX: {formatNetworkSpeed(netRX)}</span>
                  </div>
                  <div className="flex items-center gap-1 group-hover:text-brand-400 transition-colors">
                    <span>{timeAgo(node.last_seen)}</span>
                    <ArrowRight size={12} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-dark-950 text-dark-400 uppercase font-medium border-b border-dark-800">
                <tr>
                  <th className="px-5 py-3.5">Node Name</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">IP / Hostname</th>
                  <th className="px-4 py-3.5">CPU</th>
                  <th className="px-4 py-3.5">RAM</th>
                  <th className="px-4 py-3.5">Disk</th>
                  <th className="px-4 py-3.5">Network</th>
                  <th className="px-4 py-3.5">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800 text-dark-200">
                {sortedNodes.map((node) => (
                  <tr
                    key={node.id}
                    onClick={() => onSelectNode(node.id)}
                    className="hover:bg-dark-850 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3 font-semibold text-white">
                      {node.name}
                      {node.group_name && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-dark-800 text-dark-400 font-mono">
                          {node.group_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <NodeStatusBadge status={node.status} disabled={node.disabled} />
                    </td>
                    <td className="px-4 py-3 font-mono text-dark-400">
                      {node.ip_address || node.hostname || '-'}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatPercent(node.status === 'online' ? node.latest_metrics?.cpu : null)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatPercent(node.status === 'online' ? node.latest_metrics?.memory : null)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {formatPercent(node.status === 'online' ? node.latest_metrics?.disk : null)}
                    </td>
                    <td className="px-4 py-3 font-mono text-dark-400">
                      {formatNetworkSpeed(node.status === 'online' ? node.latest_metrics?.network_rx : null)}
                    </td>
                    <td className="px-4 py-3 font-mono text-dark-500">
                      {timeAgo(node.last_seen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Node Modal */}
      <AddNodeModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        groups={groups}
        onNodeCreated={() => {
          fetchNodes();
        }}
      />
    </div>
  );
}
