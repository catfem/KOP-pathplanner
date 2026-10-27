// Editing operations on autos/waypoints. They mutate drafts handed out by the store.

import {
  type Vec,
  angleOf,
  bezierPoint,
  dist,
  splitBezier,
  sub,
} from '../planner/geometry';
import { segmentBezier } from '../planner/trajectory';
import { makeWaypoint, newId } from './defaults';
import type { Auto, Waypoint } from './types';

export function round(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Appends a waypoint at the end of the auto. */
export function appendWaypoint(auto: Auto, p: Vec, style: 'smooth' | 'stop'): number {
  const wps = auto.waypoints;
  if (wps.length === 0) {
    wps.push(makeWaypoint(p.x, p.y, 0, { stop: true, lenIn: style === 'stop' ? 0 : 1, lenOut: style === 'stop' ? 0 : 1 }));
    return 0;
  }
  const prev = wps[wps.length - 1];
  const d = dist(prev, p);
  const dir = d > 1e-6 ? angleOf(sub(p, prev)) : prev.angleOut;
  if (style === 'stop') {
    prev.stop = true;
    prev.lenOut = 0;
    if (wps.length === 1) prev.angleIn = dir;
    prev.angleOut = dir;
    wps.push(makeWaypoint(p.x, p.y, dir, { stop: true, lenIn: 0, lenOut: 0 }));
  } else {
    const len = Math.max(0.2, d / 3);
    const keepStop = prev.actions.length > 0 || prev.facing !== null || prev.lenIn < 1e-3;
    if (wps.length === 1 || keepStop) {
      // Start point, or an end point that must stay a stop: aim straight at the new point.
      prev.stop = true;
      prev.angleOut = dir;
      if (wps.length === 1) prev.angleIn = dir;
    } else {
      // The old end becomes a smooth pass-through point continuing its incoming direction.
      prev.stop = false;
      prev.angleOut = prev.angleIn;
    }
    prev.lenOut = len;
    wps.push(makeWaypoint(p.x, p.y, dir, { stop: true, lenIn: len, lenOut: len }));
  }
  return wps.length - 1;
}

/** Finds the closest point on the path to p. Returns the segment index and curve parameter. */
export function nearestOnPath(auto: Auto, p: Vec): { segment: number; t: number; distance: number } | null {
  let best: { segment: number; t: number; distance: number } | null = null;
  for (let i = 0; i + 1 < auto.waypoints.length; i++) {
    const bz = segmentBezier(auto.waypoints[i], auto.waypoints[i + 1]);
    for (let k = 0; k <= 100; k++) {
      const t = k / 100;
      const d = dist(bezierPoint(bz, t), p);
      if (!best || d < best.distance) best = { segment: i, t, distance: d };
    }
  }
  return best;
}

/** Inserts a smooth waypoint on segment i at parameter t without changing the path shape. */
export function insertWaypoint(auto: Auto, segment: number, t: number): number {
  const a = auto.waypoints[segment];
  const b = auto.waypoints[segment + 1];
  const bz = segmentBezier(a, b);
  const tt = Math.min(0.95, Math.max(0.05, t));
  const [left, right] = splitBezier(bz, tt);
  const mid = left[3];
  a.lenOut = dist(left[0], left[1]);
  b.lenIn = dist(right[2], right[3]);
  const lenIn = dist(left[2], mid);
  const lenOut = dist(mid, right[1]);
  let angle = lenOut > 1e-6 ? angleOf(sub(right[1], mid)) : lenIn > 1e-6 ? angleOf(sub(mid, left[2])) : angleOf(sub(b, a));
  if (!Number.isFinite(angle)) angle = 0;
  const wp = makeWaypoint(mid.x, mid.y, angle, { lenIn, lenOut });
  // A point inserted on a straight segment between stops stays a straight stop point.
  if (lenIn < 1e-3 && lenOut < 1e-3) wp.stop = true;
  auto.waypoints.splice(segment + 1, 0, wp);
  return segment + 1;
}

export function deleteWaypoint(auto: Auto, index: number): void {
  if (auto.waypoints.length <= 1) return;
  auto.waypoints.splice(index, 1);
  const n = auto.waypoints.length;
  if (n > 0) {
    auto.waypoints[0].stop = true;
    auto.waypoints[n - 1].stop = true;
  }
}

/** Points handles at the neighbouring waypoints and zeroes them (straight lines, stop point). */
export function makeStraight(auto: Auto, index: number): void {
  const wps = auto.waypoints;
  const w = wps[index];
  w.stop = true;
  w.lenIn = 0;
  w.lenOut = 0;
  if (index > 0) {
    w.angleIn = angleOf(sub(w, wps[index - 1]));
    wps[index - 1].lenOut = 0;
  }
  if (index + 1 < wps.length) {
    w.angleOut = angleOf(sub(wps[index + 1], w));
    wps[index + 1].lenIn = 0;
    if (index + 1 === wps.length - 1 || wps[index + 1].stop) {
      wps[index + 1].angleIn = w.angleOut;
    }
  }
  if (index === 0) w.angleIn = w.angleOut;
  if (index === wps.length - 1) w.angleOut = w.angleIn;
}

/** Makes every point a stop with straight segments ("drive, turn, drive"). */
export function makeAllStraight(auto: Auto): void {
  for (let i = 0; i < auto.waypoints.length; i++) makeStraight(auto, i);
}

export function setStop(w: Waypoint, stop: boolean): void {
  w.stop = stop;
  if (!stop) {
    w.angleIn = w.angleOut;
    w.reversed = false;
    w.facing = null;
    w.actions = [];
  }
}

/** Moves a handle end to p (field coordinates), keeping smooth points collinear. */
export function dragHandle(w: Waypoint, which: 'in' | 'out', p: Vec, snapDeg: number | null, isFirst: boolean, isLast: boolean): void {
  const v = which === 'out' ? sub(p, w) : sub(w, p);
  let angle = angleOf(v);
  if (snapDeg) angle = round(angle, snapDeg);
  const len = Math.hypot(v.x, v.y);
  if (which === 'out') {
    w.angleOut = angle;
    w.lenOut = len;
  } else {
    w.angleIn = angle;
    w.lenIn = len;
  }
  // Smooth points (and the open ends of the path) keep a single tangent.
  if (!w.stop || isFirst || isLast) {
    if (which === 'out') w.angleIn = angle;
    else w.angleOut = angle;
  }
}

export function duplicateAuto(auto: Auto, name: string): Auto {
  const copy = structuredClone(auto);
  copy.id = newId('auto');
  copy.name = name;
  copy.waypoints.forEach((w) => {
    w.id = newId('wp');
    w.actions.forEach((a) => (a.id = newId('act')));
  });
  return copy;
}

export function uniqueAutoName(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

/** Mirrors an auto across the field's long axis (y -> width - y). */
export function mirrorAuto(auto: Auto, fieldWidth: number): void {
  for (const w of auto.waypoints) {
    w.y = fieldWidth - w.y;
    w.angleIn = -w.angleIn;
    w.angleOut = -w.angleOut;
    if (w.facing !== null) w.facing = -w.facing;
  }
}

interface PPPoint {
  x: number;
  y: number;
}

/** Imports a PathPlanner .path file (2023+ format) as a new auto. */
export function importPathPlanner(json: unknown, name: string): Auto {
  const data = json as {
    waypoints?: { anchor?: PPPoint; anchorPoint?: PPPoint; prevControl?: PPPoint | null; nextControl?: PPPoint | null }[];
    reversed?: boolean;
    eventMarkers?: { name?: string; waypointRelativePos?: number; command?: unknown }[];
    globalConstraints?: { maxVelocity?: number };
  };
  if (!data || !Array.isArray(data.waypoints) || data.waypoints.length < 2) {
    throw new Error('Not a PathPlanner path file (no waypoints found).');
  }
  const raw = data.waypoints;
  const wps: Waypoint[] = raw.map((w, i) => {
    const anchor = w.anchor ?? w.anchorPoint;
    if (!anchor) throw new Error(`Waypoint ${i + 1} has no anchor.`);
    const next = w.nextControl ?? null;
    const prev = w.prevControl ?? null;
    const out = next ? sub(next, anchor) : null;
    const inn = prev ? sub(anchor, prev) : null;
    const angleOut = out && Math.hypot(out.x, out.y) > 1e-6 ? angleOf(out) : inn ? angleOf(inn) : 0;
    const angleIn = inn && Math.hypot(inn.x, inn.y) > 1e-6 ? angleOf(inn) : angleOut;
    const corner = Math.abs(((angleIn - angleOut + 540) % 360) - 180) > 1;
    return makeWaypoint(anchor.x, anchor.y, angleOut, {
      angleIn,
      angleOut,
      lenIn: inn ? Math.hypot(inn.x, inn.y) : 0,
      lenOut: out ? Math.hypot(out.x, out.y) : 0,
      stop: i === 0 || i === raw.length - 1 || corner,
    });
  });
  if (data.reversed) wps.forEach((w) => (w.reversed = w.stop));
  const maxVel = data.globalConstraints?.maxVelocity;
  if (typeof maxVel === 'number' && maxVel > 0) wps.forEach((w) => (w.maxVel = maxVel));
  for (const m of data.eventMarkers ?? []) {
    const label = markerName(m);
    if (!label || typeof m.waypointRelativePos !== 'number') continue;
    const idx = Math.min(wps.length - 2, Math.max(0, Math.round(m.waypointRelativePos)));
    wps[idx].markers.push(label);
  }
  return { id: newId('auto'), name, waypoints: wps };
}

function markerName(m: { name?: string; command?: unknown }): string | null {
  const findNamed = (c: unknown): string | null => {
    if (!c || typeof c !== 'object') return null;
    const cmd = c as { type?: string; data?: { name?: string; commands?: unknown[] } };
    if (cmd.type === 'named' && typeof cmd.data?.name === 'string') return cmd.data.name;
    for (const child of cmd.data?.commands ?? []) {
      const n = findNamed(child);
      if (n) return n;
    }
    return null;
  };
  return findNamed(m.command) ?? (typeof m.name === 'string' && m.name ? m.name : null);
}
