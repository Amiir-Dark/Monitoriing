import { useGauge } from './GaugeContext';
import { arcPath, valueToAngle } from './math';

export default function GaugeZones({
  zones = [
    { min: 0, max: 60, color: 'rgba(16, 185, 129, 0.4)' },
    { min: 60, max: 85, color: 'rgba(245, 158, 11, 0.5)' },
    { min: 85, max: 100, color: 'rgba(239, 68, 68, 0.6)' },
  ],
  strokeWidth,
  inset = 0,
  className = '',
  style = {},
  ...props
}) {
  const { radius, strokeWidth: defaultWidth, startAngle, endAngle, min: gaugeMin, max: gaugeMax } = useGauge();
  const width = strokeWidth ?? (defaultWidth * 0.4);
  const zoneRadius = radius - inset;

  return (
    <g className={`gauge-zones ${className}`} style={style} {...props}>
      {zones.map((zone, idx) => {
        const fromAngle = valueToAngle(zone.min, gaugeMin, gaugeMax, startAngle, endAngle);
        const toAngle = valueToAngle(zone.max, gaugeMin, gaugeMax, startAngle, endAngle);
        const path = arcPath(zoneRadius, fromAngle, toAngle);

        return (
          <path
            key={idx}
            d={path}
            fill="none"
            stroke={zone.color}
            strokeWidth={width}
            strokeLinecap="butt"
            opacity={0.8}
          />
        );
      })}
    </g>
  );
}
