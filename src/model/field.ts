// Field elements (2026 REBUILT HUBs, BUMPs and TRENCHes) and the geometry used
// to aim at them, keep the robot clear of them, and slow down over BUMPs.

import type { FieldElement, FieldElementKind } from './types';

const IN = 0.0254;

// Element sizes from the 2026 Game Manual (nominal).
export const HUB_SIZE = 47.0 * IN; // 47 x 47 in
export const BUMP_DEPTH = 44.4 * IN; // along the field length
export const BUMP_WIDTH = 73.0 * IN; // along the field width
export const TRENCH_DEPTH = 47.0 * IN;
export const TRENCH_WIDTH = 65.65 * IN;
export const TRENCH_CLEARANCE = 22.25 * IN;

/**
 * HUB centers from the official 2026 welded AprilTag layout (the HUB tags sit on
 * the four faces: blue faces at x 4.022 / 5.229 m, y 3.431 / 4.638 m).
 */
const HUB_CENTER_X = { blue: (4.022 + 5.229) / 2, red: (11.312 + 12.519) / 2 };
const FIELD_2026_WIDTH = 8.069;

export const KIND_LABELS: Record<FieldElementKind, string> = { hub: 'HUB', bump: 'BUMP', trench: 'TRENCH' };

/** HUBs, BUMPs on either side of each HUB, and TRENCHes along the guardrails. */
export function rebuilt2026Elements(): FieldElement[] {
  const cy = FIELD_2026_WIDTH / 2;
  const out: FieldElement[] = [];
  for (const alliance of ['blue', 'red'] as const) {
    const x = HUB_CENTER_X[alliance];
    out.push({ id: `${alliance}-hub`, kind: 'hub', alliance, x, y: cy, sizeX: HUB_SIZE, sizeY: HUB_SIZE });
    const bumpOffset = HUB_SIZE / 2 + BUMP_WIDTH / 2;
    out.push({ id: `${alliance}-bump-right`, kind: 'bump', alliance, x, y: cy - bumpOffset, sizeX: BUMP_DEPTH, sizeY: BUMP_WIDTH });
    out.push({ id: `${alliance}-bump-left`, kind: 'bump', alliance, x, y: cy + bumpOffset, sizeX: BUMP_DEPTH, sizeY: BUMP_WIDTH });
    out.push({ id: `${alliance}-trench-right`, kind: 'trench', alliance, x, y: TRENCH_WIDTH / 2, sizeX: TRENCH_DEPTH, sizeY: TRENCH_WIDTH });
    out.push({
      id: `${alliance}-trench-left`,
      kind: 'trench',
      alliance,
      x,
      y: FIELD_2026_WIDTH - TRENCH_WIDTH / 2,
      sizeX: TRENCH_DEPTH,
      sizeY: TRENCH_WIDTH,
    });
  }
  return out;
}

/** Field elements of a preset (only the 2026 field has any). */
export function presetElements(preset: string): FieldElement[] {
  return preset === 'frc2026' ? rebuilt2026Elements() : [];
}

export function elementLabel(e: FieldElement): string {
  const side = e.id.endsWith('-left') ? ' (left)' : e.id.endsWith('-right') ? ' (right)' : '';
  return `${e.alliance === 'blue' ? 'Blue' : 'Red'} ${KIND_LABELS[e.kind]}${side}`;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Corners of the robot footprint (bumper outline) at a pose. */
export function footprint(length: number, width: number, x: number, y: number, heading: number): Vec2[] {
  const hl = length / 2;
  const hw = width / 2;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [
    [hl, hw],
    [-hl, hw],
    [-hl, -hw],
    [hl, -hw],
  ].map(([px, py]) => ({ x: x + px * c - py * s, y: y + px * s + py * c }));
}

/** Separating-axis test between a convex polygon (4 corners) and an axis-aligned element. */
export function overlapsElement(corners: Vec2[], e: FieldElement, margin = 0): boolean {
  const minX = e.x - e.sizeX / 2 - margin;
  const maxX = e.x + e.sizeX / 2 + margin;
  const minY = e.y - e.sizeY / 2 - margin;
  const maxY = e.y + e.sizeY / 2 + margin;
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  if (Math.max(...xs) <= minX || Math.min(...xs) >= maxX) return false;
  if (Math.max(...ys) <= minY || Math.min(...ys) >= maxY) return false;
  const rect = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  // Axes of the robot rectangle.
  for (let i = 0; i < 2; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    const axis = { x: -(b.y - a.y), y: b.x - a.x };
    const project = (pts: Vec2[]) => pts.map((p) => p.x * axis.x + p.y * axis.y);
    const r = project(corners);
    const q = project(rect);
    if (Math.max(...r) <= Math.min(...q) || Math.max(...q) <= Math.min(...r)) return false;
  }
  return true;
}

/** Heading (rad) that points the robot's front from (x, y) at the element's center. */
export function headingTo(e: FieldElement, x: number, y: number): number {
  return Math.atan2(e.y - y, e.x - x);
}

/** Distance from a point to the nearest edge of an element (0 inside it). */
export function distanceToElement(e: FieldElement, x: number, y: number): number {
  const dx = Math.max(Math.abs(x - e.x) - e.sizeX / 2, 0);
  const dy = Math.max(Math.abs(y - e.y) - e.sizeY / 2, 0);
  return Math.hypot(dx, dy);
}

/**
 * Where the robot center must be, on the line from the element's center through
 * `from`, so that the front bumper is `gap` meters from the element while facing
 * its center. Used for "bumper against the HUB" shots.
 */
export function bumperAgainst(
  e: FieldElement,
  from: Vec2,
  robot: { length: number; width: number },
  gap = 0.02,
): Vec2 & { heading: number } {
  let ux = from.x - e.x;
  let uy = from.y - e.y;
  const len = Math.hypot(ux, uy);
  if (len < 1e-6) {
    ux = -1;
    uy = 0;
  } else {
    ux /= len;
    uy /= len;
  }
  const heading = Math.atan2(-uy, -ux);
  const at = (d: number) => ({ x: e.x + ux * d, y: e.y + uy * d });
  const hits = (d: number) => {
    const p = at(d);
    return overlapsElement(footprint(robot.length, robot.width, p.x, p.y, heading), e, gap);
  };
  let lo = 0;
  let hi = Math.hypot(e.sizeX, e.sizeY) / 2 + Math.hypot(robot.length, robot.width) / 2 + gap + 0.1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (hits(mid)) lo = mid;
    else hi = mid;
  }
  return { ...at(hi), heading };
}

export interface BumperDistances {
  /** Bumper corners (field coordinates). */
  corners: Vec2[];
  /** Nearest alliance wall: which one, the distance, and the bumper corner closest to it. */
  wall: { side: 'blue' | 'red'; distance: number; from: Vec2 };
  /** Nearest guardrail (long side wall). */
  rail: { side: 'right' | 'left'; distance: number; from: Vec2 };
}

/** How far the bumpers are from the alliance wall and guardrail (for placing the robot). */
export function bumperDistances(
  robot: { length: number; width: number },
  pose: { x: number; y: number; heading: number },
  field: { length: number; width: number },
): BumperDistances {
  const corners = footprint(robot.length, robot.width, pose.x, pose.y, pose.heading);
  const by = (f: (c: Vec2) => number) => corners.reduce((best, c) => (f(c) < f(best) ? c : best));
  const minX = by((c) => c.x);
  const maxX = by((c) => -c.x);
  const minY = by((c) => c.y);
  const maxY = by((c) => -c.y);
  const blue = minX.x;
  const red = field.length - maxX.x;
  const right = minY.y;
  const left = field.width - maxY.y;
  return {
    corners,
    wall: blue <= red ? { side: 'blue', distance: blue, from: minX } : { side: 'red', distance: red, from: maxX },
    rail: right <= left ? { side: 'right', distance: right, from: minY } : { side: 'left', distance: left, from: maxY },
  };
}

/**
 * Gap between the front bumper and an element when the robot at (x, y) faces
 * the element's center (negative when the bumper is inside it).
 */
export function bumperGap(e: FieldElement, x: number, y: number, robot: { length: number; width: number }): number {
  const contact = bumperAgainst(e, { x, y }, robot, 0);
  return Math.hypot(x - e.x, y - e.y) - Math.hypot(contact.x - e.x, contact.y - e.y);
}

export function formatDistance(m: number): string {
  return `${m.toFixed(2)} m · ${(m / IN).toFixed(1)} in`;
}
