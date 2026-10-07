import { useMemo } from 'react';
import { GaugeContext } from './GaugeContext';
import { arcBox, clamp, valueToAngle } from './math';

export default function Gauge({
  value = 0,
  min = 0,
  max = 100,
  startAngle = -120,
  endAngle = 120,
  radius = 80,
  strokeWidth = 10,
  gap = 12,
  className = '',
  style = {},
  children,
  ...props
}) {
  const clampedValue = clamp(value, min, max);
  const currentAngle = valueToAngle(clampedValue, min, max, startAngle, endAngle);

  // Compute viewBox dynamically based on arc geometry
  const viewBox = useMemo(() => {
    // Total effective radius considering stroke and needle overhang
    const effRadius = radius + strokeWidth / 2 + gap;
    const box = arcBox(effRadius, startAngle, endAngle);

    // Add extra padding to ensure ticks and labels fit nicely
    const pad = Math.max(strokeWidth, 8);
    const minX = box.x - pad;
    const minY = box.y - pad;
    const width = box.width + pad * 2;
    const height = box.height + pad * 2;

    return `${minX.toFixed(1)} ${minY.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`;
  }, [radius, strokeWidth, startAngle, endAngle, gap]);

  const contextValue = useMemo(() => ({
    value: clampedValue,
    rawValue: value,
    min,
    max,
    startAngle,
    endAngle,
    currentAngle,
    radius,
    strokeWidth,
  }), [clampedValue, value, min, max, startAngle, endAngle, currentAngle, radius, strokeWidth]);

  return (
    <GaugeContext.Provider value={contextValue}>
      <svg
        viewBox={viewBox}
        className={`gauge-root select-none overflow-visible ${className}`}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          ...style,
        }}
        {...props}
      >
        {children}
      </svg>
    </GaugeContext.Provider>
  );
}
