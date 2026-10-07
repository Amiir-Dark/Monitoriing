import { useId } from 'react';
import Gauge from './Gauge';
import GaugeTrack from './GaugeTrack';
import GaugeArc from './GaugeArc';
import GaugeTicks from './GaugeTicks';
import GaugeZones from './GaugeZones';
import GaugeNeedle from './GaugeNeedle';
import GaugeHub from './GaugeHub';
import GaugeValue from './GaugeValue';

const VARIANTS = {
  blue: { from: '#2563eb', to: '#60a5fa', accent: '#60a5fa', glow: 'rgba(96, 165, 250, 0.45)' },
  cyan: { from: '#0891b2', to: '#22d3ee', accent: '#22d3ee', glow: 'rgba(34, 211, 238, 0.45)' },
  emerald: { from: '#059669', to: '#34d399', accent: '#34d399', glow: 'rgba(52, 211, 153, 0.45)' },
  amber: { from: '#d97706', to: '#fbbf24', accent: '#fbbf24', glow: 'rgba(251, 191, 36, 0.45)' },
  purple: { from: '#7c3aed', to: '#c084fc', accent: '#c084fc', glow: 'rgba(192, 132, 252, 0.45)' },
  rose: { from: '#e11d48', to: '#fb7185', accent: '#fb7185', glow: 'rgba(251, 113, 133, 0.45)' },
};

const DIM = { from: '#334155', to: '#475569', accent: '#64748b', glow: 'rgba(100, 116, 139, 0.35)' };

function resolveTheme(variant, value, thresholds) {
  if (thresholds) {
    if (thresholds.crit !== undefined && value >= thresholds.crit) return VARIANTS.rose;
    if (thresholds.warn !== undefined && value >= thresholds.warn) return VARIANTS.amber;
  }
  return VARIANTS[variant] || VARIANTS.blue;
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export default function GaugeDial({
  value = 0,
  min = 0,
  max = 100,
  unit = '%',
  decimals = 1,
  caption = '',
  variant = 'blue',
  thresholds = null,
  tickCount = 5,
  subTicks = 3,
  showTickLabels = true,
  zones = true,
  needle = true,
  unavailable = false,
  unavailableNote = 'Unavailable',
  haloColor = '#0f172a',
  height = 168,
  className = '',
}) {
  const gradientId = useId();

  const shown = unavailable ? min : clamp(value, min, max);
  const theme = unavailable ? DIM : resolveTheme(variant, value, thresholds);

  return (
    <div
      className={`gauge-dial w-full flex items-center justify-center ${className}`}
      style={{ height: `${height}px` }}
    >
      <Gauge
        value={shown}
        min={min}
        max={max}
        startAngle={40}
        endAngle={320}
        radius={74}
        strokeWidth={9}
        gap={24}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={theme.from} />
            <stop offset="100%" stopColor={theme.to} />
          </linearGradient>
        </defs>

        <GaugeTrack stroke="rgba(255, 255, 255, 0.06)" strokeWidth={9} />

        {zones && !unavailable && (
          <GaugeZones
            zones={[
              { min: min, max: min + (max - min) * 0.6, color: 'rgba(16, 185, 129, 0.35)' },
              { min: min + (max - min) * 0.6, max: min + (max - min) * 0.8, color: 'rgba(245, 158, 11, 0.4)' },
              { min: min + (max - min) * 0.8, max: max, color: 'rgba(239, 68, 68, 0.45)' },
            ]}
            inset={13}
            strokeWidth={3}
          />
        )}

        <GaugeTicks
          count={tickCount}
          subTicks={subTicks}
          inset={-12}
          length={7}
          strokeWidth={1.5}
          stroke="rgba(148, 163, 184, 0.3)"
          activeStroke={theme.accent}
          showLabels={showTickLabels}
          labelOffset={17}
          labelFontSize={9.5}
          labelColor="rgba(148, 163, 184, 0.75)"
          labelFormatter={(v) => Math.round(v)}
        />

        {!unavailable && <GaugeArc stroke={`url(#${gradientId})`} strokeWidth={9} />}

        {needle && !unavailable && (
          <>
            <GaugeNeedle variant="tapered" length={56} width={2.6} color={theme.accent} />
            <GaugeHub radius={5} fill="#0f172a" stroke={theme.accent} glowColor={theme.glow} />
          </>
        )}

        <GaugeValue
          y={26}
          fontSize={30}
          halo
          haloColor={haloColor}
          haloWidth={5}
          formatter={(v) => (unavailable ? '—' : v.toFixed(decimals))}
          unit={unavailable ? '' : unit}
          label={unavailable ? unavailableNote : caption}
        />
      </Gauge>
    </div>
  );
}
