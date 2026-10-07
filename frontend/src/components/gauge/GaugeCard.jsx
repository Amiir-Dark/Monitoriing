import GaugeDial from './GaugeDial';

export default function GaugeCard({
  title,
  meta,
  rows = [],
  className = '',
  ...dialProps
}) {
  return (
    <div
      className={`rounded-2xl border border-dark-800/80 bg-dark-900 p-4 flex flex-col shadow-sm ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dark-400 truncate">
          {title}
        </h3>
        {meta && (
          <span className="text-[10px] font-mono text-dark-500 shrink-0 truncate">{meta}</span>
        )}
      </div>

      <GaugeDial haloColor="#0f172a" {...dialProps} />

      {rows.length > 0 && (
        <div className="mt-1 border-t border-dark-800/70">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 py-1.5 text-[11px] border-b border-dark-800/40 last:border-b-0"
            >
              <span className="text-dark-400 truncate">{row.label}</span>
              <span
                className={`font-mono tabular-nums shrink-0 ${
                  row.tone || 'text-dark-100'
                }`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
