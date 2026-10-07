export default function NodeStatusBadge({ status, disabled = false, size = 'sm' }) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-dark-800 text-dark-400 border border-dark-700">
        <span className="w-1.5 h-1.5 rounded-full bg-dark-500"></span>
        Disabled
      </span>
    );
  }

  const configs = {
    online: {
      label: 'Online',
      badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      dotClass: 'bg-emerald-500 shadow-glow-emerald',
    },
    offline: {
      label: 'Offline',
      badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      dotClass: 'bg-rose-500 shadow-glow-rose',
    },
    warning: {
      label: 'Warning',
      badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      dotClass: 'bg-amber-500',
    },
    unknown: {
      label: 'Unknown',
      badgeClass: 'bg-dark-800 text-dark-400 border-dark-700',
      dotClass: 'bg-dark-500',
    },
  };

  const current = configs[status] || configs.unknown;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${size === 'lg' ? 'text-sm' : 'text-xs'} font-medium border ${current.badgeClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${current.dotClass} animate-pulse`}></span>
      {current.label}
    </span>
  );
}
