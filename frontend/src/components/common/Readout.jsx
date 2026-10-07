export default function Readout({
  label,
  value,
  unit,
  sub,
  tone = 'text-white',
  icon: Icon,
}) {
  const unavailable =
    value === null || value === undefined || value === 'Unavailable';

  return (
    <div className="flex flex-col gap-1 py-3 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dark-500 flex items-center gap-1.5">
        {Icon && <Icon size={12} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </span>

      <div className="flex items-baseline gap-1 min-w-0">
        <span
          className={`text-xl font-bold font-mono tabular-nums leading-none truncate ${
            unavailable ? 'text-dark-500' : tone
          }`}
        >
          {unavailable ? 'Unavailable' : value}
        </span>
        {!unavailable && unit && (
          <span className="text-[11px] text-dark-500 font-mono shrink-0">{unit}</span>
        )}
      </div>

      {sub && <span className="text-[10px] font-mono text-dark-500 truncate">{sub}</span>}
    </div>
  );
}
