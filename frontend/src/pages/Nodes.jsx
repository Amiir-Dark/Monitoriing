import { useState, useEffect, useMemo } from 'react';
import { getNodes, getGroups } from '../services/api';
import { wsService } from '../services/ws';
import NodeStatusBadge from '../components/common/NodeStatusBadge';
import AddNodeModal from '../components/nodes/AddNodeModal';
import {
  formatPercent,
  formatNetworkSpeed,
  formatUptime,
  formatDataFreshness,
} from '../utils/formatters';
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
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Tag,
  Copy,
  Check,
} from 'lucide-react';

export default function Nodes({ onSelectNode }) {
  const [nodes, setNodes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters & View state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '', 'online', 'offline', 'warning', 'critical'
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [sortBy, setSortBy] = useState('created'); // created, name, cpu, memory
  const [viewMode, setViewMode] = useState('grid'); // grid, table
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [copiedIp, setCopiedIp] = useState(null);

  const fetchNodes = async () => {
    try {
      const [nodesData, groupsData] = await Promise.all([
        getNodes({ group: groupFilter, tag: selectedTag }),
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
  }, [groupFilter, selectedTag]);

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
              connection_state: 'ONLINE',
              last_seen: new Date().toISOString(),
              latest_payload: { ...node.latest_payload, ...event.metrics },
              latest_metrics: {
                ...node.latest_metrics,
                cpu: event.metrics.cpu,
                memory: event.metrics.memory,
                disk: event.metrics.disk,
                network_rx: event.metrics.network_rx,
                network_tx: event.metrics.network_tx,
                uptime_seconds: event.metrics.uptime_seconds,
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
        prev.map((node) => (node.id === event.id ? { ...node, status: event.status, connection_state: event.status?.toUpperCase() } : node))
      );
    });

    return () => {
      unsubMetrics();
      unsubStatus();
    };
  }, []);

  const handleCopyIp = (ip, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 1800);
  };

  // Collect all unique tags
  const allTags = useMemo(() => {
    return Array.from(new Set(nodes.flatMap((n) => n.tags || [])));
  }, [nodes]);

  // Client-side comprehensive filtering: Search by Hostname, IP, Tag, OS
  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        node.name?.toLowerCase().includes(q) ||
        node.hostname?.toLowerCase().includes(q) ||
        node.ip_address?.toLowerCase().includes(q) ||
        (node.operating_system && node.operating_system.toLowerCase().includes(q)) ||
        (node.distribution && node.distribution.toLowerCase().includes(q)) ||
        (node.tags && node.tags.some((t) => t.toLowerCase().includes(q)));

      const isOnline = node.status === 'online' || node.connection_state === 'ONLINE';
      const isOffline = node.status === 'offline' || node.connection_state === 'OFFLINE';
      const isWarning = node.status === 'warning' || node.status === 'degraded' || node.connection_state === 'STALE';
      const isCritical = node.status === 'critical' || (node.latest_metrics?.cpu > 95);

      const matchesStatus =
        !statusFilter ||
        (statusFilter === 'online' && isOnline) ||
        (statusFilter === 'offline' && isOffline) ||
        (statusFilter === 'warning' && isWarning) ||
        (statusFilter === 'critical' && isCritical);

      return matchesSearch && matchesStatus;
    });
  }, [nodes, search, statusFilter]);

  // Sorting
  const sortedNodes = useMemo(() => {
    return [...filteredNodes].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'cpu') {
        const aVal = a.latest_payload?.cpu ?? a.latest_metrics?.cpu ?? 0;
        const bVal = b.latest_payload?.cpu ?? b.latest_metrics?.cpu ?? 0;
        return bVal - aVal;
      }
      if (sortBy === 'memory') {
        const aVal = a.latest_payload?.memory ?? a.latest_metrics?.memory ?? 0;
        const bVal = b.latest_payload?.memory ?? b.latest_metrics?.memory ?? 0;
        return bVal - aVal;
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [filteredNodes, sortBy]);

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Server Fleet</h2>
          <p className="text-xs text-dark-400 mt-0.5">
            Real Linux telemetry, hardware states, and telemetry freshness across fleet
          </p>
        </div>

        <button
          onClick={() => setAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-glow-brand transition-all self-start md:self-auto"
        >
          <Plus size={16} /> Add Server Node
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input: Hostname, IP, Tag, OS */}
          <div className="relative flex-1 w-full">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              placeholder="Search by hostname, IP address, OS, tag, or server name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-dark-950 border border-dark-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-dark-500 font-mono focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Group Filter */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full md:w-44 bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-xs text-dark-200 focus:outline-none focus:border-brand-500 font-mono"
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
            className="w-full md:w-36 bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-xs text-dark-200 focus:outline-none focus:border-brand-500 font-mono"
          >
            <option value="created">Sort: Newest</option>
            <option value="name">Sort: Name</option>
            <option value="cpu">Sort: CPU %</option>
            <option value="memory">Sort: RAM %</option>
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

        {/* Status Filters: All, Online, Offline, Warning, Critical */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-dark-800/80">
          <span className="text-[11px] font-medium text-dark-500 mr-2 flex items-center gap-1">
            <Filter size={12} /> Status:
          </span>
          {[
            { id: '', label: 'All' },
            { id: 'online', label: 'Online' },
            { id: 'offline', label: 'Offline' },
            { id: 'warning', label: 'Warning' },
            { id: 'critical', label: 'Critical' },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setStatusFilter(st.id)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-medium capitalize transition-colors ${
                statusFilter === st.id
                  ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30 font-bold'
                  : 'bg-dark-950 text-dark-400 hover:text-dark-200 border border-dark-800'
              }`}
            >
              {st.label}
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
          <h3 className="text-base font-semibold text-white">No nodes match criteria</h3>
          <p className="text-xs text-dark-400 mt-1 max-w-sm mx-auto mb-5 font-mono">
            {search || statusFilter ? 'Try adjusting your search terms or status filters.' : 'Add your first server node to receive system metrics.'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedNodes.map((node) => {
            const p = node.latest_payload || {};
            const m = node.latest_metrics || {};
            const isOnline = node.status === 'online' || node.connection_state === 'ONLINE';
            const cpu = isOnline ? (p.cpu ?? m.cpu ?? null) : null;
            const mem = isOnline ? (p.memory ?? m.memory ?? null) : null;
            const disk = isOnline ? (p.disk ?? m.disk ?? null) : null;
            const rxSpeed = isOnline ? (p.network_rx ?? m.network_rx ?? 0) : null;
            const txSpeed = isOnline ? (p.network_tx ?? m.network_tx ?? 0) : null;
            const uptimeSec = p.uptime_seconds ?? m.uptime_seconds;
            const ts = p.timestamp || (node.last_seen ? Math.floor(new Date(node.last_seen).getTime() / 1000) : null);
            const freshness = formatDataFreshness(ts);

            return (
              <div
                key={node.id}
                onClick={() => onSelectNode(node.id)}
                className="group bg-dark-900 hover:bg-dark-850 border border-dark-800 hover:border-brand-500/40 rounded-2xl p-5 shadow-xs cursor-pointer transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top card header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                        <h4 className="text-sm font-bold text-white group-hover:text-brand-400 transition-colors truncate">
                          {node.name}
                        </h4>
                      </div>
                      <p className="text-xs text-dark-400 font-mono mt-0.5 truncate">
                        {node.hostname || 'hostname unassigned'}
                      </p>
                    </div>
                    <NodeStatusBadge status={node.status} disabled={node.disabled} />
                  </div>

                  {/* IP, OS & Tags */}
                  <div className="flex items-center gap-1.5 mb-3 flex-wrap text-[11px] font-mono">
                    {node.ip_address && (
                      <button
                        onClick={(e) => handleCopyIp(node.ip_address, e)}
                        title="Click to copy IP"
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-dark-950 hover:bg-dark-800 text-dark-300 hover:text-white border border-dark-800 transition-colors"
                      >
                        <span>{node.ip_address}</span>
                        {copiedIp === node.ip_address ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      </button>
                    )}
                    {(node.operating_system || node.distribution) && (
                      <span className="px-2 py-0.5 rounded-md bg-dark-950 text-dark-400 border border-dark-800 truncate">
                        {node.operating_system || node.distribution}
                      </span>
                    )}
                  </div>

                  {/* Metric Gauges Grid */}
                  <div className="grid grid-cols-3 gap-2 py-3 border-y border-dark-800/80 bg-dark-950/40 rounded-xl px-2">
                    <div className="text-center">
                      <span className="text-[10px] text-dark-500 font-medium uppercase flex items-center justify-center gap-1">
                        <Cpu size={11} /> CPU
                      </span>
                      <p className={`text-sm font-bold mt-0.5 tabular-nums font-mono ${
                        cpu > 85 ? 'text-rose-400' : cpu > 70 ? 'text-amber-400' : 'text-white'
                      }`}>
                        {formatPercent(cpu)}
                      </p>
                    </div>

                    <div className="text-center border-x border-dark-800/80">
                      <span className="text-[10px] text-dark-500 font-medium uppercase flex items-center justify-center gap-1">
                        <Layers size={11} /> RAM
                      </span>
                      <p className={`text-sm font-bold mt-0.5 tabular-nums font-mono ${
                        mem > 85 ? 'text-rose-400' : mem > 70 ? 'text-amber-400' : 'text-white'
                      }`}>
                        {formatPercent(mem)}
                      </p>
                    </div>

                    <div className="text-center">
                      <span className="text-[10px] text-dark-500 font-medium uppercase flex items-center justify-center gap-1">
                        <HardDrive size={11} /> DISK
                      </span>
                      <p className={`text-sm font-bold mt-0.5 tabular-nums font-mono ${
                        disk > 85 ? 'text-rose-400' : 'text-white'
                      }`}>
                        {formatPercent(disk)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer with RX/TX, Uptime, and Freshness */}
                <div className="mt-4 pt-2 border-t border-dark-800/60 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-dark-400 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 flex items-center gap-0.5">
                        <ArrowDown size={11} /> {formatNetworkSpeed(rxSpeed)}
                      </span>
                      <span className="text-blue-400 flex items-center gap-0.5">
                        <ArrowUp size={11} /> {formatNetworkSpeed(txSpeed)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 group-hover:text-brand-400 transition-colors font-medium">
                      <span>Inspect</span>
                      <ArrowRight size={12} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-dark-500 font-mono">
                    <span>UP: {uptimeSec ? formatUptime(uptimeSec) : '—'}</span>
                    <span className={freshness.isLive ? 'text-emerald-400/80' : 'text-amber-400/80'}>
                      {freshness.lastKnown ? `LAST KNOWN (${freshness.text})` : freshness.text}
                    </span>
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
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-dark-950 text-dark-400 uppercase font-medium border-b border-dark-800">
                <tr>
                  <th className="px-5 py-3.5">Hostname / Node</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">IP Address</th>
                  <th className="px-4 py-3.5">OS</th>
                  <th className="px-4 py-3.5 text-right">CPU</th>
                  <th className="px-4 py-3.5 text-right">RAM</th>
                  <th className="px-4 py-3.5 text-right">Disk</th>
                  <th className="px-4 py-3.5 text-right">Network RX / TX</th>
                  <th className="px-4 py-3.5 text-right">Uptime</th>
                  <th className="px-4 py-3.5 text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800 text-dark-200">
                {sortedNodes.map((node) => {
                  const p = node.latest_payload || {};
                  const m = node.latest_metrics || {};
                  const isOnline = node.status === 'online' || node.connection_state === 'ONLINE';
                  return (
                    <tr
                      key={node.id}
                      onClick={() => onSelectNode(node.id)}
                      className="hover:bg-dark-850 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3 font-semibold text-white">
                        <div>{node.name}</div>
                        <div className="text-[10px] text-dark-500">{node.hostname}</div>
                      </td>
                      <td className="px-4 py-3">
                        <NodeStatusBadge status={node.status} disabled={node.disabled} />
                      </td>
                      <td className="px-4 py-3 text-dark-400">
                        {node.ip_address || '-'}
                      </td>
                      <td className="px-4 py-3 text-dark-400">
                        {node.operating_system || node.distribution || '-'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-white">
                        {formatPercent(isOnline ? (p.cpu ?? m.cpu) : null)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-white">
                        {formatPercent(isOnline ? (p.memory ?? m.memory) : null)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-white">
                        {formatPercent(isOnline ? (p.disk ?? m.disk) : null)}
                      </td>
                      <td className="px-4 py-3 text-right text-dark-300">
                        {isOnline ? `${formatNetworkSpeed(p.network_rx ?? m.network_rx)} / ${formatNetworkSpeed(p.network_tx ?? m.network_tx)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-400">
                        {(p.uptime_seconds || m.uptime_seconds) ? formatUptime(p.uptime_seconds || m.uptime_seconds) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-dark-500">
                        {timeAgo(node.last_seen)}
                      </td>
                    </tr>
                  );
                })}
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
