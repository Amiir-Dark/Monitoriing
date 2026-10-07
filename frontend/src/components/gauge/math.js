/**
 * Gauge UI - Geometric & Mathematical Utilities
 * Pure JavaScript implementation of polar coordinates, arc paths, and angle conversions.
 */

export function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function normalizeAngle(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * Converts polar coordinates to Cartesian (x, y) relative to gauge center.
 * Gauge standard: 0° points downwards (6 o'clock) or 180° depending on convention,
 * here standard 0° is 6 o'clock (down) and angles increase clockwise.
 */
export function polar(radius, angle) {
  const rad = degreesToRadians(angle + 90);
  return {
    x: radius * Math.cos(rad),
    y: radius * Math.sin(rad),
  };
}

/**
 * Checks if target angle lies between start and end angle along clockwise sweep.
 */
export function isAngleBetween(target, start, end) {
  const sweep = end - start;
  if (Math.abs(sweep) >= 360) return true;
  const normTarget = normalizeAngle(target);
  const normStart = normalizeAngle(start);
  const diff = normalizeAngle(normTarget - normStart);
  return diff <= (sweep > 0 ? sweep : sweep + 360);
}

/**
 * Calculates the bounding box for an arc from startAngle to endAngle.
 */
export function arcBox(radius, startAngle, endAngle) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const update = (p) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  };

  // Center point
  update({ x: 0, y: 0 });
  // Start and end points
  update(polar(radius, startAngle));
  update(polar(radius, endAngle));

  // Critical axis points: 0°, 90°, 180°, 270°
  for (let a = 0; a < 360; a += 90) {
    if (isAngleBetween(a, startAngle, endAngle)) {
      update(polar(radius, a));
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Generates an SVG path string for an arc stroke from angle `from` to `to`.
 */
export function arcPath(radius, from, to) {
  if (radius <= 0) return '';
  const sweep = to - from;
  if (Math.abs(sweep) >= 360) {
    const start = polar(radius, from);
    const mid = polar(radius, from + 180);
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 1 1 ${mid.x.toFixed(2)} ${mid.y.toFixed(2)} A ${radius} ${radius} 0 1 1 ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
  }

  const start = polar(radius, from);
  const end = polar(radius, to);
  const largeArcFlag = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;

  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/**
 * Maps a numeric value in [min, max] to an angle in [startAngle, endAngle].
 */
export function valueToAngle(value, min, max, startAngle, endAngle) {
  if (max === min) return startAngle;
  const clamped = clamp(value, min, max);
  const ratio = (clamped - min) / (max - min);
  return startAngle + ratio * (endAngle - startAngle);
}
