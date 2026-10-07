import { useGauge } from './GaugeContext';

export default function GaugeValue({
  formatter = (v) => v.toFixed(1),
  unit = '%',
  label,
  x = 0,
  y = 0,
  fontSize = 20,
  halo = false,
  haloColor = '#0f172a',
  haloWidth = 4,
  className = '',
  style = {},
  ...props
}) {
  const { value } = useGauge();

  return (
    <g
      className={`gauge-value-group ${className}`}
      transform={`translate(${x}, ${y})`}
      style={style}
      {...props}
    >
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#f8fafc"
        fontSize={fontSize}
        fontWeight="800"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="-0.03em"
        {...(halo
          ? {
              stroke: haloColor,
              strokeWidth: haloWidth,
              strokeLinejoin: 'round',
              paintOrder: 'stroke',
            }
          : {})}
      >
        {formatter(value)}
        {unit && (
          <tspan
            fontSize={fontSize * 0.55}
            fontWeight="500"
            fill="#94a3b8"
            dx={2}
          >
            {unit}
          </tspan>
        )}
      </text>

      {label && (
        <text
          x={0}
          y={fontSize * 0.9}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#64748b"
          fontSize={Math.max(9, fontSize * 0.42)}
          fontWeight="600"
          letterSpacing="0.05em"
          style={{ textTransform: 'uppercase' }}
        >
          {label}
        </text>
      )}
    </g>
  );
}
