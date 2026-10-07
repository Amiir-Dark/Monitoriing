import { useGauge } from './GaugeContext';
import { arcPath } from './math';

export default function GaugeArc({
  color,
  stroke,
  strokeWidth,
  strokeLinecap = 'round',
  className = '',
  style = {},
  ...props
}) {
  const { radius, strokeWidth: defaultWidth, startAngle, currentAngle } = useGauge();
  const width = strokeWidth ?? defaultWidth;
  const path = arcPath(radius, startAngle, currentAngle);

  // Default vibrant gradient or color
  const arcStroke = stroke || color || 'url(#gauge-default-gradient)';

  return (
    <path
      d={path}
      fill="none"
      stroke={arcStroke}
      strokeWidth={width}
      strokeLinecap={strokeLinecap}
      className={`gauge-arc ${className}`}
      style={{
        transition: 'd 0.35s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease',
        ...style,
      }}
      {...props}
    />
  );
}
