import { useId } from 'react';
import Gauge from './Gauge';
import GaugeTrack from './GaugeTrack';
import GaugeArc from './GaugeArc';
import GaugeTicks from './GaugeTicks';
import GaugeZones from './GaugeZones';
import GaugeNeedle from './GaugeNeedle';
import GaugeHub from './GaugeHub';
import GaugeValue from './GaugeValue';

export default function RadialSpeedometer({
  value = 0,
  min = 0,
  max = 100,
  title = '',
  unit = '%',
  subtitle = '',
  variant = 'cyan', // 'cyan' | 'emerald' | 'amber' | 'rose' | 'purple'
  size = 200,
  needle = true,
  ticks = true,
  zones = true,
  className = '',
}) {
  const gradientId = useId();

  // Color theme mapping
  const themes = {
    cyan: {
      from: '#06b6d4',
      to: '#3b82f6',
      needle: '#38bdf8',
      glow: 'rgba(56, 189, 248, 0.4)',
      track: 'rgba(255, 255, 255, 0.07)',
    },
    emerald: {
      from: '#10b981',
      to: '#059669',
      needle: '#34d399',
      glow: 'rgba(52, 211, 153, 0.4)',
      track: 'rgba(255, 255, 255, 0.07)',
    },
    amber: {
      from: '#f59e0b',
      to: '#d97706',
      needle: '#fbbf24',
      glow: 'rgba(251, 191, 36, 0.4)',
      track: 'rgba(255, 255, 255, 0.07)',
    },
    rose: {
      from: '#f43f5e',
      to: '#e11d48',
      needle: '#fb7185',
      glow: 'rgba(251, 113, 133, 0.4)',
      track: 'rgba(255, 255, 255, 0.07)',
    },
    purple: {
      from: '#a855f7',
      to: '#6366f1',
      needle: '#c084fc',
      glow: 'rgba(192, 132, 252, 0.4)',
      track: 'rgba(255, 255, 255, 0.07)',
    },
  };

  // Determine dynamic alert state if value is high
  let currentTheme = themes[variant] || themes.cyan;
  if (value >= 85) {
    currentTheme = themes.rose;
  } else if (value >= 70 && variant !== 'purple') {
    currentTheme = themes.amber;
  }

  return (
    <div
      className={`radial-speedometer-card flex flex-col items-center justify-between p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80 ${className}`}
      style={{ minWidth: `${size}px` }}
    >
      {title && (
        <div className="flex items-center justify-between w-full mb-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {title}
          </span>
          {subtitle && (
            <span className="text-[11px] font-mono text-slate-500">
              {subtitle}
            </span>
          )}
        </div>
      )}

      <div style={{ width: size, height: size * 0.75 }} className="relative flex items-center justify-center">
        <Gauge
          value={value}
          min={min}
          max={max}
          startAngle={-120}
          endAngle={120}
          radius={70}
          strokeWidth={10}
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={currentTheme.from} />
              <stop offset="100%" stopColor={currentTheme.to} />
            </linearGradient>
            <filter id={`glow-${gradientId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background track */}
          <GaugeTrack stroke={currentTheme.track} strokeWidth={10} />

          {/* Zones if enabled */}
          {zones && (
            <GaugeZones
              zones={[
                { min: 0, max: 60, color: 'rgba(16, 185, 129, 0.25)' },
                { min: 60, max: 80, color: 'rgba(245, 158, 11, 0.3)' },
                { min: 80, max: 100, color: 'rgba(239, 68, 68, 0.4)' },
              ]}
              inset={10}
              strokeWidth={3}
            />
          )}

          {/* Radial Ticks */}
          {ticks && (
            <GaugeTicks
              count={7}
              subTicks={2}
              inset={15}
              length={5}
              stroke="rgba(255, 255, 255, 0.15)"
              activeStroke={currentTheme.needle}
            />
          )}

          {/* Active progress arc */}
          <GaugeArc
            stroke={`url(#${gradientId})`}
            strokeWidth={10}
            filter={`url(#glow-${gradientId})`}
          />

          {/* Needle & Pivot */}
          {needle && (
            <>
              <GaugeNeedle
                variant="tapered"
                length={56}
                width={3}
                color={currentTheme.needle}
              />
              <GaugeHub
                radius={5}
                fill="#090d16"
                stroke={currentTheme.needle}
                glowColor={currentTheme.glow}
              />
            </>
          )}

          {/* Value Readout */}
          <GaugeValue
            y={needle ? 30 : 0}
            fontSize={22}
            unit={unit}
          />
        </Gauge>
      </div>
    </div>
  );
}
