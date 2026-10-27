// Trajectory planning for a differential (tank) drive without a gyroscope.
//
// An auto is split at stop points into "chunks" of cubic Bezier segments. Each
// chunk becomes a drive step: the path is resampled by arc length, a velocity
// profile is fitted under the drivetrain constraints, and the result is turned
// into left/right wheel position/velocity/acceleration profiles. Corners at
// stop points become turn-in-place steps. Following the two wheel profiles
// (open loop or with encoder feedback) reproduces the path without any heading
// sensor, because heading is implied by the difference between the wheels.

import { elementLabel, footprint, headingTo, overlapsElement } from '../model/field';
import type { Auto, FieldElement, NamedCommand, RobotConfig, Waypoint } from '../model/types';
import { type Bezier, type Vec, DEG, add, bezierPoint, clamp, dist, fromPolar, sub, wrapRad } from './geometry';

export interface TrajState {
  /** Time since the start of the step, s. */
  t: number;
  x: number;
  y: number;
  /** Robot facing, rad (continuous, not wrapped). */
  heading: number;
  /** Signed forward velocity of the robot center, m/s. */
  v: number;
  /** Angular velocity, rad/s. */
  omega: number;
  /** Signed acceleration of the robot center, m/s^2. */
  a: number;
  curvature: number;
  /** Wheel distances relative to the step start, m. */
  lPos: number;
  lVel: number;
  lAcc: number;
  rPos: number;
  rVel: number;
  rAcc: number;
}

export interface Marker {
  time: number;
  name: string;
  waypointIndex: number;
}

interface StepBase {
  /** Global start time within the auto, s. */
  start: number;
  duration: number;
  /** Waypoint index this step happens at (drive: the starting stop point). */
  waypointIndex: number;
}

export interface DriveStep extends StepBase {
  kind: 'drive';
  toIndex: number;
  reversed: boolean;
  distance: number;
  samples: TrajState[];
  markers: Marker[];
}

export interface TurnStep extends StepBase {
  kind: 'turn';
  fromHeading: number;
  toHeading: number;
  samples: TrajState[];
  /** What the robot turns to face, e.g. "Blue HUB". */
  target?: string;
}

export interface CommandStep extends StepBase {
  kind: 'command';
  name: string;
}

export interface WaitStep extends StepBase {
  kind: 'wait';
}

export type PlanStep = DriveStep | TurnStep | CommandStep | WaitStep;
export type MotionStep = DriveStep | TurnStep;

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

export type WarningLevel = 'info' | 'warn' | 'error';

export interface PlanWarning {
  level: WarningLevel;
  message: string;
  waypointIndex?: number;
}

export interface Plan {
  steps: PlanStep[];
  totalTime: number;
  startPose: Pose;
  endPose: Pose;
  totalDistance: number;
  /** Highest |volts| any wheel needs under the nominal feedforward. */
  peakVoltage: number;
  warnings: PlanWarning[];
}

export interface PlanOptions {
  sampleTime?: number;
  commands?: NamedCommand[];
  autoPeriod?: number;
  field?: { length: number; width: number; elements?: FieldElement[]; elementsEnabled?: boolean };
}

const DEFAULT_COMMAND_DURATION = 0.5;
const MIN_TURN = 0.5 * DEG;
const MIN_CHUNK_LENGTH = 1e-3;
const MIN_PROFILE_SPEED = 0.05;

/** The four control points of the Bezier segment from waypoint a to b. */
export function segmentBezier(a: Waypoint, b: Waypoint): Bezier {
  const p0 = { x: a.x, y: a.y };
  const p3 = { x: b.x, y: b.y };
  return [p0, add(p0, fromPolar(a.lenOut, a.angleOut)), sub(p3, fromPolar(b.lenIn, b.angleIn)), p3];
}

function bezierDerivative(b: Bezier, t: number): Vec {
  const u = 1 - t;
  return {
    x: 3 * u * u * (b[1].x - b[0].x) + 6 * u * t * (b[2].x - b[1].x) + 3 * t * t * (b[3].x - b[2].x),
    y: 3 * u * u * (b[1].y - b[0].y) + 6 * u * t * (b[2].y - b[1].y) + 3 * t * t * (b[3].y - b[2].y),
  };
}

/** Tangent angle (rad) of the curve at t, robust to zero-length handles. */
function bezierTangent(b: Bezier, t: number): number | null {
  for (const dt of [0, 1e-4, 1e-3, 1e-2]) {
    const tt = t < 0.5 ? t + dt : t - dt;
    const d = bezierDerivative(b, tt);
    if (Math.hypot(d.x, d.y) > 1e-9) return Math.atan2(d.y, d.x);
  }
  const chord = sub(b[3], b[0]);
  if (Math.hypot(chord.x, chord.y) > 1e-9) return Math.atan2(chord.y, chord.x);
  return null;
}

interface PathSamples {
  s: number[];
  x: number[];
  y: number[];
  /** Unwrapped path tangent, rad. */
  theta: number[];
  curvature: number[];
  /** Speed cap from per-segment limits. */
  segLimit: number[];
  /** Arc length at which each waypoint of the chunk is reached. */
  waypointS: number[];
  length: number;
}

/**
 * Samples the chunk of Bezier segments between waypoints[from] and
 * waypoints[to] at (nearly) uniform arc length.
 */
export function samplePath(
  waypoints: Waypoint[],
  from: number,
  to: number,
  robot: RobotConfig,
  ds = 0.01,
  bumps: FieldElement[] = [],
): PathSamples {
  const dense: { x: number; y: number; theta: number | null; s: number; seg: number }[] = [];
  const waypointS: number[] = [0];
  let s = 0;
  for (let i = from; i < to; i++) {
    const bz = segmentBezier(waypoints[i], waypoints[i + 1]);
    const approxLen =
      dist(bz[0], bz[1]) + dist(bz[1], bz[2]) + dist(bz[2], bz[3]);
    const n = clamp(Math.ceil(approxLen / 0.002), 40, 6000);
    for (let k = 0; k <= n; k++) {
      if (k === 0 && dense.length > 0) continue;
      const t = k / n;
      const p = bezierPoint(bz, t);
      if (dense.length > 0) s += dist(p, dense[dense.length - 1]);
      dense.push({ x: p.x, y: p.y, theta: bezierTangent(bz, t), s, seg: i });
    }
    waypointS.push(s);
  }
  const length = s;
  const count = Math.max(3, Math.ceil(length / ds) + 1);
  const step = length / (count - 1);

  const out: PathSamples = { s: [], x: [], y: [], theta: [], curvature: [], segLimit: [], waypointS, length };
  // Fill missing tangents (degenerate points) from neighbours.
  let lastTheta: number | null = null;
  for (const d of dense) {
    if (d.theta === null) d.theta = lastTheta;
    else lastTheta = d.theta;
  }
  for (let i = dense.length - 1; i >= 0; i--) {
    if (dense[i].theta === null) dense[i].theta = i + 1 < dense.length ? dense[i + 1].theta : 0;
  }
  // Unwrap dense tangents.
  const thetas: number[] = [];
  for (let i = 0; i < dense.length; i++) {
    const raw = dense[i].theta as number;
    thetas.push(i === 0 ? raw : thetas[i - 1] + wrapRad(raw - thetas[i - 1]));
  }

  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = k === count - 1 ? length : k * step;
    while (j < dense.length - 2 && dense[j + 1].s < target) j++;
    const a = dense[j];
    const b = dense[Math.min(j + 1, dense.length - 1)];
    const span = b.s - a.s;
    const f = span > 1e-12 ? clamp((target - a.s) / span, 0, 1) : 0;
    out.s.push(target);
    out.x.push(a.x + (b.x - a.x) * f);
    out.y.push(a.y + (b.y - a.y) * f);
    out.theta.push(thetas[j] + (thetas[Math.min(j + 1, dense.length - 1)] - thetas[j]) * f);
    const wp = waypoints[a.seg];
    let limit = wp.maxVel !== null && wp.maxVel > 0 ? Math.min(wp.maxVel, robot.maxVelocity) : robot.maxVelocity;
    if (bumps.length) {
      // The footprint is symmetric, so the path tangent works for reversed driving too.
      const corners = footprint(robot.length, robot.width, out.x[k], out.y[k], out.theta[k]);
      if (bumps.some((b) => overlapsElement(corners, b))) limit = Math.min(limit, Math.max(0.1, robot.bumpMaxVelocity));
    }
    out.segLimit.push(limit);
  }
  for (let k = 0; k < count; k++) {
    const k0 = Math.max(0, k - 1);
    const k1 = Math.min(count - 1, k + 1);
    const dS = out.s[k1] - out.s[k0];
    out.curvature.push(dS > 1e-9 ? (out.theta[k1] - out.theta[k0]) / dS : 0);
  }
  return out;
}

interface Profile {
  /** Arc length, speed, and time at each path sample. */
  s: number[];
  v: number[];
  t: number[];
  duration: number;
}

/** Time-optimal velocity profile along the sampled path (forward/backward pass). */
function profilePath(path: PathSamples, robot: RobotConfig): Profile {
  const n = path.s.length;
  const halfTrack = robot.trackWidth / 2;
  const aMax = Math.max(0.01, robot.maxAcceleration);
  const vLimit: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = Math.abs(path.curvature[i]);
    let lim = Math.max(0.01, path.segLimit[i]);
    lim = Math.min(lim, Math.max(0.01, robot.maxVelocity) / (1 + k * halfTrack));
    if (k > 1e-6 && robot.maxCentripetal > 0) lim = Math.min(lim, Math.sqrt(robot.maxCentripetal / k));
    vLimit.push(Math.max(lim, MIN_PROFILE_SPEED));
  }
  const v = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const ds = path.s[i] - path.s[i - 1];
    v[i] = Math.min(vLimit[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * aMax * ds));
  }
  v[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) {
    const ds = path.s[i + 1] - path.s[i];
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * aMax * ds));
  }
  v[0] = 0;
  const t = [0];
  for (let i = 1; i < n; i++) {
    const ds = path.s[i] - path.s[i - 1];
    const avg = (v[i] + v[i - 1]) / 2;
    t.push(t[i - 1] + (avg > 1e-9 ? ds / avg : 0));
  }
  return { s: path.s, v, t, duration: t[n - 1] };
}

function interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

/** Fills wheel accelerations by differentiating wheel velocities. */
function fillWheelAccel(samples: TrajState[]): void {
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(n - 1, i + 1)];
    const dt = b.t - a.t;
    samples[i].lAcc = dt > 1e-9 ? (b.lVel - a.lVel) / dt : 0;
    samples[i].rAcc = dt > 1e-9 ? (b.rVel - a.rVel) / dt : 0;
    samples[i].a = dt > 1e-9 ? (b.v - a.v) / dt : 0;
  }
}

function timesFor(duration: number, dt: number): number[] {
  const ts: number[] = [];
  const n = Math.floor(duration / dt + 1e-9);
  for (let k = 0; k <= n; k++) ts.push(k * dt);
  if (duration - ts[ts.length - 1] > 1e-6) ts.push(duration);
  return ts;
}

/** Builds a drive step following the path chunk between two stop points. */
export function buildDriveSamples(
  path: PathSamples,
  robot: RobotConfig,
  reversed: boolean,
  headingOffset: number,
  dt: number,
): { samples: TrajState[]; duration: number; waypointTimes: number[] } {
  const prof = profilePath(path, robot);
  const halfTrack = robot.trackWidth / 2;
  const sign = reversed ? -1 : 1;
  const theta0 = path.theta[0];
  const samples: TrajState[] = [];
  const n = prof.t.length;
  let i = 1;
  for (const t of timesFor(prof.duration, dt)) {
    while (i < n - 1 && prof.t[i] < t) i++;
    const t0 = prof.t[i - 1];
    const t1 = prof.t[i];
    const v0 = prof.v[i - 1];
    const v1 = prof.v[i];
    const ds = prof.s[i] - prof.s[i - 1];
    const acc = ds > 1e-12 ? (v1 * v1 - v0 * v0) / (2 * ds) : 0;
    const tau = clamp(t - t0, 0, t1 - t0);
    let s = prof.s[i - 1] + v0 * tau + 0.5 * acc * tau * tau;
    s = clamp(s, prof.s[i - 1], prof.s[i]);
    let sdot = Math.max(0, v0 + acc * tau);
    if (t >= prof.duration - 1e-9) {
      s = path.length;
      sdot = 0;
    }
    const theta = interp(path.s, path.theta, s);
    const curvature = interp(path.s, path.curvature, s);
    const dTheta = theta - theta0;
    const v = sign * sdot;
    const omega = curvature * sdot;
    samples.push({
      t,
      x: interp(path.s, path.x, s),
      y: interp(path.s, path.y, s),
      heading: theta + (reversed ? Math.PI : 0) + headingOffset,
      v,
      omega,
      a: 0,
      curvature,
      lPos: sign * s - dTheta * halfTrack,
      rPos: sign * s + dTheta * halfTrack,
      lVel: v - omega * halfTrack,
      rVel: v + omega * halfTrack,
      lAcc: 0,
      rAcc: 0,
    });
  }
  fillWheelAccel(samples);
  // The robot is at rest at the end of the step; no braking feedforward after it stops.
  const end = samples[samples.length - 1];
  end.lAcc = 0;
  end.rAcc = 0;
  end.a = 0;
  const waypointTimes = path.waypointS.map((ws) => interp(prof.s, prof.t, ws));
  return { samples, duration: prof.duration, waypointTimes };
}

/** Trapezoidal turn-in-place profile from heading `from` by `delta` radians. */
export function buildTurnSamples(
  pose: { x: number; y: number },
  from: number,
  delta: number,
  robot: RobotConfig,
  dt: number,
): { samples: TrajState[]; duration: number } {
  const halfTrack = robot.trackWidth / 2;
  const dir = Math.sign(delta) || 1;
  const d = Math.abs(delta) * halfTrack;
  const vMax = Math.max(0.01, Math.min(robot.maxTurnRate * DEG * halfTrack, robot.maxVelocity));
  const aMax = Math.max(0.01, robot.maxTurnAccel * DEG * halfTrack);
  let tAcc = vMax / aMax;
  let tCruise = 0;
  let vPeak = vMax;
  if (d < vMax * tAcc) {
    tAcc = Math.sqrt(d / aMax);
    vPeak = aMax * tAcc;
  } else {
    tCruise = (d - vMax * tAcc) / vMax;
  }
  const duration = 2 * tAcc + tCruise;
  const samples: TrajState[] = [];
  for (const t of timesFor(duration, dt)) {
    let u: number;
    let ud: number;
    let udd: number;
    if (t < tAcc) {
      u = 0.5 * aMax * t * t;
      ud = aMax * t;
      udd = aMax;
    } else if (t < tAcc + tCruise) {
      u = 0.5 * aMax * tAcc * tAcc + vPeak * (t - tAcc);
      ud = vPeak;
      udd = 0;
    } else if (t < duration - 1e-9) {
      const tr = duration - t;
      u = d - 0.5 * aMax * tr * tr;
      ud = aMax * tr;
      udd = -aMax;
    } else {
      u = d;
      ud = 0;
      udd = 0;
    }
    samples.push({
      t,
      x: pose.x,
      y: pose.y,
      heading: from + (dir * u) / halfTrack,
      v: 0,
      omega: (dir * ud) / halfTrack,
      a: 0,
      curvature: 0,
      lPos: -dir * u,
      lVel: -dir * ud,
      lAcc: -dir * udd,
      rPos: dir * u,
      rVel: dir * ud,
      rAcc: dir * udd,
    });
  }
  return { samples, duration };
}

/** Returns the waypoints with first/last forced to be stop points. */
export function normalizedWaypoints(auto: Auto): Waypoint[] {
  return auto.waypoints.map((w, i, arr) => (i === 0 || i === arr.length - 1 ? { ...w, stop: true } : w));
}

export function stopIndices(waypoints: Waypoint[]): number[] {
  const idx: number[] = [];
  waypoints.forEach((w, i) => {
    if (w.stop || i === 0 || i === waypoints.length - 1) idx.push(i);
  });
  return idx;
}

function nearestEquivalent(angle: number, reference: number): number {
  return reference + wrapRad(angle - reference);
}

/** Generates the full plan (motions, turns, actions) for an auto. */
export function planAuto(auto: Auto, robot: RobotConfig, options: PlanOptions = {}): Plan {
  const dt = options.sampleTime ?? 0.02;
  const waypoints = normalizedWaypoints(auto);
  const warnings: PlanWarning[] = [];
  const steps: PlanStep[] = [];
  const commandDuration = (name: string) =>
    options.commands?.find((c) => c.name === name)?.duration ?? DEFAULT_COMMAND_DURATION;

  if (waypoints.length === 0) {
    return {
      steps,
      totalTime: 0,
      startPose: { x: 0, y: 0, heading: 0 },
      endPose: { x: 0, y: 0, heading: 0 },
      totalDistance: 0,
      peakVoltage: 0,
      warnings: [{ level: 'info', message: 'Add waypoints to start planning.' }],
    };
  }

  const elements = options.field && options.field.elementsEnabled !== false ? (options.field.elements ?? []) : [];
  const bumps = elements.filter((e) => e.kind === 'bump');
  const stops = stopIndices(waypoints);
  // Pre-compute path chunks between consecutive stops.
  const chunks = new Map<number, { to: number; path: PathSamples | null }>();
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = stops[k];
    const b = stops[k + 1];
    const path = samplePath(waypoints, a, b, robot, 0.01, bumps);
    chunks.set(a, { to: b, path: path.length > MIN_CHUNK_LENGTH ? path : null });
  }
  const departureFacing = (a: number): number | null => {
    const c = chunks.get(a);
    if (!c || !c.path) return null;
    return c.path.theta[0] + (waypoints[a].reversed ? Math.PI : 0);
  };

  /** Heading a stop point asks for: aim at a field element, a fixed heading, or none. */
  const facingAt = (index: number, x: number, y: number): { heading: number; target?: string } | null => {
    const wp = waypoints[index];
    if (wp.aimAt) {
      const target = elements.find((e) => e.id === wp.aimAt);
      if (target) return { heading: headingTo(target, x, y), target: elementLabel(target) };
      warnings.push({
        level: 'warn',
        message: `Point ${index + 1} aims at a field element that is not on this field; its aim is ignored.`,
        waypointIndex: index,
      });
    }
    return wp.facing !== null ? { heading: wp.facing * DEG } : null;
  };

  const first = waypoints[0];
  let firstDeparture: number | null = null;
  for (const a of stops) {
    firstDeparture = departureFacing(a);
    if (firstDeparture !== null) break;
  }
  let heading = wrapRad(facingAt(0, first.x, first.y)?.heading ?? firstDeparture ?? first.angleOut * DEG);
  const startPose: Pose = { x: first.x, y: first.y, heading };
  let pos = { x: first.x, y: first.y };
  let time = 0;
  let totalDistance = 0;

  const pushTurn = (target: number, at: number, label?: string) => {
    const delta = wrapRad(target - heading);
    if (Math.abs(delta) < MIN_TURN) {
      heading = nearestEquivalent(target, heading);
      return;
    }
    const { samples, duration } = buildTurnSamples(pos, heading, delta, robot, dt);
    steps.push({
      kind: 'turn',
      start: time,
      duration,
      waypointIndex: at,
      fromHeading: heading,
      toHeading: heading + delta,
      samples,
      target: label,
    });
    time += duration;
    heading += delta;
  };

  for (let k = 0; k < stops.length; k++) {
    const a = stops[k];
    const wp = waypoints[a];
    if (k > 0) {
      const face = facingAt(a, pos.x, pos.y);
      if (face) pushTurn(face.heading, a, face.target);
    }
    for (const act of wp.actions) {
      if (act.kind === 'command') {
        const duration = commandDuration(act.name);
        steps.push({ kind: 'command', name: act.name, start: time, duration, waypointIndex: a });
        time += duration;
      } else {
        const duration = Math.max(0, act.seconds);
        steps.push({ kind: 'wait', start: time, duration, waypointIndex: a });
        time += duration;
      }
    }
    const chunk = chunks.get(a);
    if (!chunk) continue;
    if (!chunk.path) {
      if (wp.markers.length > 0) {
        warnings.push({ level: 'warn', message: `Markers at point ${a + 1} never run: the next segment has no length.`, waypointIndex: a });
      }
      continue;
    }
    const dep = departureFacing(a) as number;
    pushTurn(dep, a);
    const { samples, duration, waypointTimes } = buildDriveSamples(
      chunk.path,
      robot,
      wp.reversed,
      heading - dep,
      dt,
    );
    const markers: Marker[] = [];
    for (let j = a; j < chunk.to; j++) {
      for (const name of waypoints[j].markers) {
        markers.push({ time: waypointTimes[j - a], name, waypointIndex: j });
      }
    }
    steps.push({
      kind: 'drive',
      start: time,
      duration,
      waypointIndex: a,
      toIndex: chunk.to,
      reversed: wp.reversed,
      distance: chunk.path.length,
      samples,
      markers,
    });
    time += duration;
    totalDistance += chunk.path.length;
    const last = samples[samples.length - 1];
    heading = last.heading;
    pos = { x: last.x, y: last.y };
  }

  // Waypoint quality checks.
  waypoints.forEach((w, i) => {
    if (i > 0 && i < waypoints.length - 1 && !w.stop) {
      if (w.lenIn < 1e-3 || w.lenOut < 1e-3) {
        warnings.push({
          level: 'warn',
          message: `Point ${i + 1} is smooth but has a zero-length handle, which makes a sharp corner. Make it a stop point or lengthen the handle.`,
          waypointIndex: i,
        });
      }
    }
  });
  if (waypoints[waypoints.length - 1].markers.length > 0 && waypoints.length > 1) {
    warnings.push({
      level: 'info',
      message: 'Markers on the last point are ignored. Use actions to run commands at the end.',
      waypointIndex: waypoints.length - 1,
    });
  }

  const peakVoltage = computePeakVoltage(steps, robot);
  if (peakVoltage > robot.maxVoltage + 1e-6) {
    warnings.push({
      level: 'warn',
      message: `Profile needs up to ${peakVoltage.toFixed(1)} V on a wheel (limit ${robot.maxVoltage.toFixed(1)} V). Lower max velocity/acceleration or check kS/kV/kA.`,
    });
  }
  const autoPeriod = options.autoPeriod ?? 15;
  if (time > autoPeriod) {
    warnings.push({
      level: 'error',
      message: `Estimated time ${time.toFixed(2)} s exceeds the ${autoPeriod} s autonomous period.`,
    });
  }
  if (options.field) checkFieldBounds(steps, robot, options.field, warnings);
  if (elements.length) checkElements(steps, robot, elements, warnings);

  return {
    steps,
    totalTime: time,
    startPose,
    endPose: { x: pos.x, y: pos.y, heading },
    totalDistance,
    peakVoltage,
    warnings,
  };
}

export function feedforwardVolts(robot: Pick<RobotConfig, 'kS' | 'kV' | 'kA'>, v: number, a: number): number {
  const dir = Math.abs(v) > 1e-4 ? Math.sign(v) : Math.abs(a) > 1e-4 ? Math.sign(a) : 0;
  return robot.kS * dir + robot.kV * v + robot.kA * a;
}

function computePeakVoltage(steps: PlanStep[], robot: RobotConfig): number {
  let peak = 0;
  for (const st of steps) {
    if (st.kind !== 'drive' && st.kind !== 'turn') continue;
    for (const s of st.samples) {
      peak = Math.max(
        peak,
        Math.abs(feedforwardVolts(robot, s.lVel, s.lAcc)),
        Math.abs(feedforwardVolts(robot, s.rVel, s.rAcc)),
      );
    }
  }
  return peak;
}

/** Corners of the robot footprint at a pose. */
export function robotCorners(robot: RobotConfig, x: number, y: number, heading: number): Vec[] {
  return footprint(robot.length, robot.width, x, y, heading);
}

function checkFieldBounds(
  steps: PlanStep[],
  robot: RobotConfig,
  field: { length: number; width: number },
  warnings: PlanWarning[],
): void {
  const margin = 0.02;
  for (const st of steps) {
    if (st.kind !== 'drive' && st.kind !== 'turn') continue;
    for (let i = 0; i < st.samples.length; i += 5) {
      const s = st.samples[i];
      const out = robotCorners(robot, s.x, s.y, s.heading).some(
        (p) => p.x < -margin || p.y < -margin || p.x > field.length + margin || p.y > field.width + margin,
      );
      if (out) {
        warnings.push({
          level: 'warn',
          message: `Robot bumpers leave the field at t = ${(st.start + s.t).toFixed(2)} s.`,
          waypointIndex: st.waypointIndex,
        });
        return;
      }
    }
  }
}

/** Collisions with HUBs (and TRENCHes for tall robots), turning on BUMPs. */
function checkElements(steps: PlanStep[], robot: RobotConfig, elements: FieldElement[], warnings: PlanWarning[]): void {
  const reported = new Set<string>();
  let onBump: { time: number; index: number } | null = null;
  for (const st of steps) {
    if (st.kind !== 'drive' && st.kind !== 'turn') continue;
    for (let i = 0; i < st.samples.length; i += 3) {
      const s = st.samples[i];
      const corners = footprint(robot.length, robot.width, s.x, s.y, s.heading);
      for (const e of elements) {
        if (reported.has(e.id) || !overlapsElement(corners, e)) continue;
        const at = `t = ${(st.start + s.t).toFixed(2)} s`;
        if (e.kind === 'hub') {
          warnings.push({ level: 'error', message: `Robot runs into the ${elementLabel(e)} at ${at}.`, waypointIndex: st.waypointIndex });
          reported.add(e.id);
        } else if (e.kind === 'trench' && !robot.fitsUnderTrench) {
          warnings.push({
            level: 'error',
            message: `Robot drives under the ${elementLabel(e)} at ${at} but is set as too tall for its 22.25 in clearance.`,
            waypointIndex: st.waypointIndex,
          });
          reported.add(e.id);
        } else if (e.kind === 'bump') {
          if (st.kind === 'turn') {
            warnings.push({
              level: 'warn',
              message: `Robot turns in place on the ${elementLabel(e)} at ${at}; the wheels may slip and throw off the heading.`,
              waypointIndex: st.waypointIndex,
            });
            reported.add(e.id);
          } else if (!onBump) {
            onBump = { time: st.start + s.t, index: st.waypointIndex };
          }
        }
      }
    }
  }
  if (onBump) {
    warnings.push({
      level: 'info',
      message: `Drives over a BUMP (first at t = ${onBump.time.toFixed(2)} s): speed is limited to ${robot.bumpMaxVelocity.toFixed(1)} m/s there. Wheels can slip on the ramps, so expect a little extra drift.`,
      waypointIndex: onBump.index,
    });
  }
}

export interface PlaybackState extends Pose {
  v: number;
  omega: number;
  lVel: number;
  rVel: number;
  stepIndex: number;
  label: string;
}

/** Robot state at global time t (seconds from auto start). */
export function sampleAt(plan: Plan, t: number): PlaybackState {
  let pose: Pose = plan.startPose;
  for (let i = 0; i < plan.steps.length; i++) {
    const st = plan.steps[i];
    if (t < st.start) break;
    const end = st.start + st.duration;
    if (st.kind === 'drive' || st.kind === 'turn') {
      const local = Math.min(t - st.start, st.duration);
      const s = sampleStates(st.samples, local);
      pose = { x: s.x, y: s.y, heading: s.heading };
      if (t <= end) {
        const active = activeMarkers(st, local);
        const base = st.kind === 'drive' ? (st.reversed ? 'Driving (reverse)' : 'Driving') : 'Turning';
        return {
          ...pose,
          v: s.v,
          omega: s.omega,
          lVel: s.lVel,
          rVel: s.rVel,
          stepIndex: i,
          label: active.length ? `${base} + ${active.join(', ')}` : base,
        };
      }
    } else if (t < end) {
      return {
        ...pose,
        v: 0,
        omega: 0,
        lVel: 0,
        rVel: 0,
        stepIndex: i,
        label: st.kind === 'command' ? `Command: ${st.name}` : `Wait ${st.duration.toFixed(2)} s`,
      };
    }
  }
  return { ...pose, v: 0, omega: 0, lVel: 0, rVel: 0, stepIndex: -1, label: t <= 0 ? 'Start' : 'Done' };
}

function activeMarkers(st: MotionStep, local: number): string[] {
  if (st.kind !== 'drive') return [];
  return st.markers.filter((m) => m.time <= local).map((m) => m.name);
}

/** Linear interpolation of a sample list at local time t. */
export function sampleStates(samples: TrajState[], t: number): TrajState {
  const n = samples.length;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[n - 1].t) return samples[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof TrajState)[]) {
    out[key] = a[key] + (b[key] - a[key]) * f;
  }
  return out;
}
