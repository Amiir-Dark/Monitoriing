import { useId } from 'react';
import Gauge from './Gauge';
import GaugeTrack from './GaugeTrack';
import GaugeArc from './GaugeArc';
import GaugeValue from './GaugeValue';

export default function MiniRadialGauge({
  value = 0,
  min = 0,
  max = 100,
  label = '',
  unit = '%',
  size = 64,
  strokeWidth = 6,
  color,
  className = '',
}) {
  const gradientId = useId();

  // Pick color dynamically based on thresholds if not passed explicitly
  const getColor = () => {
    if (color) return color;
    if (value >= 85) return '#f43f5e'; // red
    if (value >= 70) return '#f59e0b'; // amber
    return '#10b981'; // emerald
  };

  const activeColor = getColor();

  return (
    <div className={`mini-radial-gauge flex flex-col items-center justify-center ${className}`}>
      <div style={{ width: size, height: size }} className="relative flex items-center justify-center">
        <Gauge
          value={value}
          min={min}
          max={max}
          startAngle={-135}
          endAngle={135}
          radius={26}
          strokeWidth={strokeWidth}
          gap={4}
        >
          <GaugeTrack
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={strokeWidth}
          />
          <GaugeArc
            color={activeColor}
            strokeWidth={strokeWidth}
          />
          <GaugeValue
            fontSize={12}
            unit={unit}
            y={2}
          />
        </Gauge>
      </div>
      {label && (
        <span className="text-[10px] font-semibold text-slate-400 mt-0.5 uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}
