export interface Vec {
  x: number;
  y: number;
}

export const DEG = Math.PI / 180;

export function vec(x: number, y: number): Vec {
  return { x, y };
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec, s: number): Vec {
  return { x: a.x * s, y: a.y * s };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function fromPolar(lengthM: number, angleDeg: number): Vec {
  return { x: lengthM * Math.cos(angleDeg * DEG), y: lengthM * Math.sin(angleDeg * DEG) };
}

export function angleOf(v: Vec): number {
  return Math.atan2(v.y, v.x) / DEG;
}

/** Wraps an angle in degrees to (-180, 180]. */
export function wrapDeg(a: number): number {
  let r = ((a + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}

/** Wraps an angle in radians to (-pi, pi]. */
export function wrapRad(a: number): number {
  return wrapDeg(a / DEG) * DEG;
}

export type Bezier = [Vec, Vec, Vec, Vec];

export function bezierPoint(b: Bezier, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const c = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x,
    y: a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y,
  };
}

/** Splits a cubic Bezier at t (de Casteljau). */
export function splitBezier(b: Bezier, t: number): [Bezier, Bezier] {
  const lerp = (p: Vec, q: Vec) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const p01 = lerp(b[0], b[1]);
  const p12 = lerp(b[1], b[2]);
  const p23 = lerp(b[2], b[3]);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const mid = lerp(p012, p123);
  return [
    [b[0], p01, p012, mid],
    [mid, p123, p23, b[3]],
  ];
}

/** Distance from point p to segment ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 < 1e-12) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
