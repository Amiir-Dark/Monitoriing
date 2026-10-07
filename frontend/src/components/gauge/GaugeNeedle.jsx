import { useGauge } from './GaugeContext';

export default function GaugeNeedle({
  length,
  width = 3,
  color = '#38bdf8',
  variant = 'tapered', // 'line' | 'tapered' | 'arrow'
  className = '',
  style = {},
  ...props
}) {
  const { radius, currentAngle } = useGauge();
  const needleLength = length ?? radius * 0.85;

  // Render needle shape pointing downward at 0 deg (which polar(angle) standardizes)
  // With SVG rotation around (0,0), rotating by currentAngle aligns the needle directly.
  return (
    <g
      transform={`rotate(${currentAngle})`}
      className={`gauge-needle ${className}`}
      style={{
        transformOrigin: '0 0',
        transition: 'transform 0.45s cubic-bezier(0.34, 1.4, 0.64, 1)',
        ...style,
      }}
      {...props}
    >
      {variant === 'line' && (
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={needleLength}
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
        />
      )}

      {variant === 'tapered' && (
        <polygon
          points={`${-width},0 ${width},0 ${width * 0.3},${needleLength} 0,${needleLength + 4} ${-width * 0.3},${needleLength}`}
          fill={color}
          filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.5))"
        />
      )}

      {variant === 'arrow' && (
        <g>
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={needleLength - 8}
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
          />
          <polygon
            points={`0,${needleLength} ${-width * 2},${needleLength - 8} ${width * 2},${needleLength - 8}`}
            fill={color}
          />
        </g>
      )}
    </g>
  );
}
