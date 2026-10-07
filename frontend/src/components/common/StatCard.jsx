export default function StatCard({
  title,
  value,
  subvalue,
  icon: Icon,
  badge,
  badgeColor = 'emerald',
  className = '',
}) {
  const badgeClasses = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    gray: 'bg-dark-800 text-dark-400 border-dark-700',
  };

  return (
    <div className={`bg-dark-900 border border-dark-800 rounded-xl p-4 shadow-xs relative overflow-hidden ${className}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-dark-400 uppercase tracking-wider">{title}</p>
          <h4 className="text-2xl font-bold text-white mt-1 tabular-nums">{value}</h4>
          {subvalue && (
            <p className="text-xs text-dark-400 mt-1">{subvalue}</p>
          )}
        </div>
        {Icon && (
          <div className="p-2.5 rounded-lg bg-dark-800/80 border border-dark-700 text-dark-300">
            <Icon size={18} />
          </div>
        )}
      </div>

      {badge && (
        <div className="mt-3 flex items-center">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${badgeClasses[badgeColor] || badgeClasses.gray}`}>
            {badge}
          </span>
        </div>
      )}
    </div>
  );
}
