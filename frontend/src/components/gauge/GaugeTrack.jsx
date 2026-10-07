import { useGauge } from './GaugeContext';
import { arcPath } from './math';

export default function GaugeTrack({
  stroke = 'rgba(255, 255, 255, 0.08)',
  strokeWidth,
  strokeLinecap = 'round',
  className = '',
  style = {},
  ...props
}) {
  const { radius, strokeWidth: defaultWidth, startAngle, endAngle } = useGauge();
  const width = strokeWidth ?? defaultWidth;
  const path = arcPath(radius, startAngle, endAngle);

  return (
    <path
      d={path}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap={strokeLinecap}
      className={`gauge-track ${className}`}
      style={{
        transition: 'stroke 0.3s ease',
        ...style,
      }}
      {...props}
    />
  );
}
