import { useState, useRef } from 'react';
import { formatPercent, formatBytes, formatDate } from '../../utils/formatters';

export default function MetricChart({
  title,
  data = [],
  unit = '%',
  color = 'blue', // blue, emerald, amber, rose, purple
  loading = false,
  activeWindow = '1h',
  onWindowChange,
  height = 180,
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const containerRef = useRef(null);

  const windows = ['1h', '6h', '24h', '7d', '30d'];

  // Palette configurations
  const colorMaps = {
    blue: {
      stroke: '#3b82f6',
      fillStart: 'rgba(59, 130, 246, 0.35)',
      fillEnd: 'rgba(59, 130, 246, 0.0)',
      dot: '#60a5fa',
    },
    emerald: {
      stroke: '#10b981',
      fillStart: 'rgba(16, 185, 129, 0.35)',
      fillEnd: 'rgba(16, 185, 129, 0.0)',
      dot: '#34d399',
    },
    amber: {
      stroke: '#f59e0b',
      fillStart: 'rgba(245, 158, 11, 0.35)',
      fillEnd: 'rgba(245, 158, 11, 0.0)',
      dot: '#fbbf24',
    },
    rose: {
      stroke: '#f43f5e',
      fillStart: 'rgba(244, 63, 94, 0.35)',
      fillEnd: 'rgba(244, 63, 94, 0.0)',
      dot: '#fb7185',
    },
    purple: {
      stroke: '#a855f7',
      fillStart: 'rgba(168, 85, 247, 0.35)',
      fillEnd: 'rgba(168, 85, 247, 0.0)',
      dot: '#c084fc',
    },
  };

  const activeColor = colorMaps[color] || colorMaps.blue;

  // Format value with explicit units
  const formatVal = (v) => {
    if (v === undefined || v === null || isNaN(v)) return 'Unavailable';
    if (unit === '%') return formatPercent(v);
    if (unit === 'bytes') return `${formatBytes(v)}/s`;
    if (unit === '°C') return `${(Math.round(v * 10) / 10).toFixed(1)}°C`;
    return (Math.round(v * 100) / 100).toLocaleString();
  };

  // Compute exact metrics: Current, Avg, Min, Peak
  let min = 0, max = 0, avg = 0, latest = null;
  if (data && data.length > 0) {
    const values = data.map((d) => d.value);
    min = Math.min(...values);
    max = Math.max(...values);
    avg = values.reduce((acc, v) => acc + v, 0) / values.length;
    latest = data[data.length - 1].value;
  }

  // Calculate SVG path points
  const paddingX = 12;
  const paddingY = 16;
  const svgWidth = 600;
  const svgHeight = height;

  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  // Domain computation
  let yMin = 0;
  let yMax = unit === '%' ? 100 : Math.max(max * 1.15, 1);
  if (unit !== '%' && min > 0) {
    yMin = Math.max(0, min * 0.85);
  }
  const yRange = yMax - yMin || 1;

  // Expected max gap before considering missing data (in seconds)
  const maxGapSeconds = {
    '1h': 60,
    '6h': 180,
    '24h': 720,
    '7d': 7200,
    '30d': 86400,
  }[activeWindow] || 120;

  const points = (data || []).map((d, index) => {
    const x = paddingX + (index / Math.max(data.length - 1, 1)) * chartWidth;
    const normalizedY = (d.value - yMin) / yRange;
    const y = svgHeight - paddingY - normalizedY * chartHeight;
    return { x, y, ...d };
  });

  // Build segments that disconnect on missing data gaps
  const segments = [];
  let currentSegment = [];

  points.forEach((pt, idx) => {
    if (idx > 0) {
      const prevPt = points[idx - 1];
      const timeDiff = pt.timestamp - prevPt.timestamp;
      // If gap exceeds threshold, finish previous segment and start a new disconnected one
      if (timeDiff > maxGapSeconds) {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
        }
        currentSegment = [];
      }
    }
    currentSegment.push(pt);
  });
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  const segmentPaths = segments.map((seg) => {
    const line = seg.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), '');
    const area = `${line} L ${seg[seg.length - 1].x} ${svgHeight - paddingY} L ${seg[0].x} ${svgHeight - paddingY} Z`;
    return { line, area };
  });

  const handleMouseMove = (e) => {
    if (!containerRef.current || points.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, mouseX / rect.width));
    const targetIdx = Math.round(pct * (points.length - 1));
    setHoverIndex(targetIdx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const activePoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">{title}</h3>
          <span className="text-base font-bold text-white tabular-nums font-mono">
            {activePoint ? formatVal(activePoint.value) : (latest !== null ? formatVal(latest) : 'Unavailable')}
          </span>
        </div>

        {/* Time Window Selector */}
        {onWindowChange && (
          <div className="flex items-center bg-dark-950 border border-dark-800 rounded-lg p-0.5">
            {windows.map((w) => (
              <button
                key={w}
                onClick={() => onWindowChange(w)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
                  activeWindow === w
                    ? 'bg-dark-800 text-white shadow-xs font-bold'
                    : 'text-dark-400 hover:text-dark-200'
                }`}
              >
                {w.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Chart Canvas */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative w-full overflow-hidden select-none cursor-crosshair"
        style={{ height: `${height}px` }}
      >
        {loading ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-dark-500 animate-pulse font-mono">
            Loading metrics...
          </div>
        ) : data.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-dark-500 font-mono">
            No metric points recorded for this window
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
              className="w-full h-full"
            >
              <defs>
                <linearGradient id={`grad-${title.replace(/\s+/g, '')}-${color}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={activeColor.fillStart} />
                  <stop offset="100%" stopColor={activeColor.fillEnd} />
                </linearGradient>
              </defs>

              {/* Baseline Grid guide line */}
              <line
                x1={paddingX}
                y1={svgHeight - paddingY}
                x2={svgWidth - paddingX}
                y2={svgHeight - paddingY}
                stroke="#1e293b"
                strokeWidth="1"
              />

              {/* Segmented Area and Lines - Disconnected on Missing Data */}
              {segmentPaths.map((seg, i) => (
                <g key={i}>
                  {seg.area && (
                    <path
                      d={seg.area}
                      fill={`url(#grad-${title.replace(/\s+/g, '')}-${color})`}
                    />
                  )}
                  {seg.line && (
                    <path
                      d={seg.line}
                      fill="none"
                      stroke={activeColor.stroke}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </g>
              ))}

              {/* Active hover crosshair line and point */}
              {activePoint && (
                <>
                  <line
                    x1={activePoint.x}
                    y1={paddingY}
                    x2={activePoint.x}
                    y2={svgHeight - paddingY}
                    stroke="#475569"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.y}
                    r="4"
                    fill={activeColor.dot}
                    stroke="#090d16"
                    strokeWidth="2"
                  />
                </>
              )}
            </svg>

            {/* Hover Tooltip Overlay */}
            {activePoint && (
              <div
                className="absolute pointer-events-none bg-dark-950/95 backdrop-blur-xs border border-dark-700 text-xs px-3 py-1.5 rounded-xl shadow-xl z-20"
                style={{
                  left: `${Math.min(Math.max((activePoint.x / svgWidth) * 100, 18), 82)}%`,
                  top: '8px',
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="font-bold text-white font-mono">{formatVal(activePoint.value)}</div>
                <div className="text-[10px] text-dark-400 font-mono mt-0.5">{formatDate(activePoint.timestamp)}</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Summary Stats with distinct Current, Average, Minimum, Peak */}
      {data.length > 0 && (
        <div className="flex flex-wrap items-center justify-between text-[11px] text-dark-400 mt-2 pt-2 border-t border-dark-800/60 tabular-nums font-mono gap-2">
          <div>Current: <strong className="text-white">{formatVal(latest)}</strong></div>
          <div>Avg: <strong className="text-dark-200">{formatVal(avg)}</strong></div>
          <div>Min: <strong className="text-dark-200">{formatVal(min)}</strong></div>
          <div>Peak: <strong className="text-amber-400">{formatVal(max)}</strong></div>
        </div>
      )}
    </div>
  );
}
