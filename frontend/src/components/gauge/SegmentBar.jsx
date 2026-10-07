export default function SegmentBar({
  segments = [],
  unavailableText = 'Unavailable — awaiting first sample',
  className = '',
}) {
  const total = segments.reduce((sum, seg) => sum + (Number(seg.value) || 0), 0);
  const available = total > 0;

  return (
    <div className={`space-y-3.5 ${className}`}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-dark-800">
        {available ? (
          segments.map((seg) => (
            <div
              key={seg.label}
              className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${((Number(seg.value) || 0) / total) * 100}%`,
                background: seg.color,
              }}
              title={`${seg.label}: ${seg.display}`}
            />
          ))
        ) : (
          <div className="h-full w-full bg-dark-800" />
        )}
      </div>

      {available ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-2">
          {segments.map((seg) => (
            <div key={seg.label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-dark-400 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: seg.color }}
                />
                <span className="truncate">{seg.label}</span>
              </span>
              <span className="font-mono tabular-nums text-dark-100 shrink-0">
                {seg.display}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] font-mono text-dark-500">{unavailableText}</p>
      )}
    </div>
  );
}
