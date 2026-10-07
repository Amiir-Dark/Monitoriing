export default function GaugeHub({
  radius = 6,
  stroke = 'rgba(255, 255, 255, 0.2)',
  strokeWidth = 2,
  fill = '#0f172a',
  glowColor,
  className = '',
  style = {},
  ...props
}) {
  return (
    <g className={`gauge-hub ${className}`} style={style} {...props}>
      {glowColor && (
        <circle
          cx={0}
          cy={0}
          r={radius + 3}
          fill="none"
          stroke={glowColor}
          strokeWidth={1.5}
          opacity={0.4}
        />
      )}
      <circle
        cx={0}
        cy={0}
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={0}
        cy={0}
        r={radius * 0.4}
        fill={stroke}
      />
    </g>
  );
}
