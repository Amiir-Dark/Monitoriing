import { useMemo } from 'react';
import { useGauge } from './GaugeContext';
import { polar } from './math';

export default function GaugeTicks({
  count = 9,
  length = 6,
  stroke = 'rgba(255, 255, 255, 0.25)',
  activeStroke = 'rgba(56, 189, 248, 0.8)',
  strokeWidth = 1.5,
  inset = 0,
  subTicks = 0,
  showLabels = false,
  labelFormatter = (v) => Math.round(v),
  className = '',
  style = {},
  ...props
}) {
  const { radius, startAngle, endAngle, min, max, currentAngle } = useGauge();

  const tickData = useMemo(() => {
    const list = [];
    if (count <= 1) return list;

    const angleStep = (endAngle - startAngle) / (count - 1);
    const valueStep = (max - min) / (count - 1);

    for (let i = 0; i < count; i++) {
      const angle = startAngle + i * angleStep;
      const val = min + i * valueStep;
      const rOuter = radius - inset;
      const rInner = rOuter - length;

      const p1 = polar(rInner, angle);
      const p2 = polar(rOuter, angle);

      const isActive = angle <= currentAngle;

      list.push({
        isMajor: true,
        angle,
        val,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        isActive,
      });

      // Sub-ticks
      if (subTicks > 0 && i < count - 1) {
        const subAngleStep = angleStep / (subTicks + 1);
        for (let j = 1; j <= subTicks; j++) {
          const sAngle = angle + j * subAngleStep;
          const sOuter = rOuter;
          const sInner = rOuter - length * 0.55;
          const sp1 = polar(sInner, sAngle);
          const sp2 = polar(sOuter, sAngle);
          list.push({
            isMajor: false,
            angle: sAngle,
            x1: sp1.x,
            y1: sp1.y,
            x2: sp2.x,
            y2: sp2.y,
            isActive: sAngle <= currentAngle,
          });
        }
      }
    }
    return list;
  }, [count, length, radius, inset, startAngle, endAngle, min, max, currentAngle, subTicks]);

  return (
    <g className={`gauge-ticks ${className}`} style={style} {...props}>
      {tickData.map((tick, idx) => (
        <line
          key={idx}
          x1={tick.x1.toFixed(2)}
          y1={tick.y1.toFixed(2)}
          x2={tick.x2.toFixed(2)}
          y2={tick.y2.toFixed(2)}
          stroke={tick.isActive && activeStroke ? activeStroke : stroke}
          strokeWidth={tick.isMajor ? strokeWidth : strokeWidth * 0.75}
          strokeLinecap="round"
          opacity={tick.isMajor ? 0.85 : 0.45}
        />
      ))}
    </g>
  );
}
