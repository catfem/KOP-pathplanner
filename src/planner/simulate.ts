// Physics simulation of the generated follower running on an imperfect robot.
//
// The controller is KopFollower (follower.ts), the same logic as
// FollowKopTrajectory in the generated code. The "true" robot can differ from
// the model: a weaker side, more friction, slower or heavier than configured,
// wheel scrub, low battery, late or coarse encoder readings, or a broken encoder.

import { effectiveEncoder, metersPerEncoderUnit } from '../model/hardware';
import type { RobotConfig } from '../model/types';
import { type EncoderFault, KopFollower, type WheelReadings } from './follower';
import type { Plan } from './trajectory';

export interface SimSettings {
  /** Torque multiplier of the left / right side (1 = matches the model). */
  leftScale: number;
  rightScale: number;
  /** True kS relative to the configured kS. */
  kSScale: number;
  /** True effective track width relative to the configured one (wheel scrub). */
  trackScale: number;
  /** True kV relative to the configured kV (above 1: the robot is slower than planned). */
  kVScale: number;
  /** True kA relative to the configured kA (above 1: the robot is heavier than planned). */
  kAScale: number;
}

export const PERFECT_SIM: SimSettings = { leftScale: 1, rightScale: 1, kSScale: 1, trackScale: 1, kVScale: 1, kAScale: 1 };
export const DEFAULT_SIM: SimSettings = { leftScale: 0.95, rightScale: 1.0, kSScale: 1.15, trackScale: 1.0, kVScale: 1.05, kAScale: 1.2 };

/** Hardware effects that are not settings in the UI (used by tests and the defaults below). */
export interface PlantOptions {
  /** Extra friction per side while turning (tread scrub), V. */
  scrubVolts: number;
  /** Battery voltage under load; outputs above it saturate. */
  supplyVolts: number;
  /** Encoder readings arrive this many control loops late (CAN status frames). */
  latencyLoops: number;
  /** Encoder resolution, m (0 = exact). */
  resolution: number;
  /** Encoder direction per side: 1 normal, -1 wired backwards, 0 not counting. */
  leftEncoder: number;
  rightEncoder: number;
}

/** Typical KOP hardware for the robot's encoder setup. */
export function defaultPlant(robot: RobotConfig): PlantOptions {
  const enc = effectiveEncoder(robot);
  return {
    scrubVolts: 0,
    supplyVolts: 12,
    latencyLoops: enc === 'integrated' ? 1 : 0,
    // 4x decoding of a quadrature encoder resolves a quarter of a cycle.
    resolution: enc === 'rio' ? metersPerEncoderUnit(robot) / 4 : 0,
    leftEncoder: 1,
    rightEncoder: 1,
  };
}

export interface SimPoint {
  t: number;
  x: number;
  y: number;
  heading: number;
}

export interface SimResult {
  trace: SimPoint[];
  totalTime: number;
  positionError: number;
  headingErrorDeg: number;
  /** Farthest the robot center strays from the planned path at any time, m. */
  maxPathDeviation: number;
  closedLoop: boolean;
  /** Encoder fault the follower detected (it then finished open loop). */
  fault: EncoderFault | null;
  /** Steps that gave up because the robot could not reach the target. */
  timeouts: number;
}

const PHYSICS_DT = 0.002;
const CONTROL_DT = 0.02;

interface Side {
  pos: number;
  vel: number;
}

function stepSide(side: Side, volts: number, kS: number, kV: number, kA: number, dt: number): void {
  if (Math.abs(side.vel) < 1e-3 && Math.abs(volts) <= kS) {
    side.vel = 0;
    return;
  }
  const moving = Math.abs(side.vel) >= 1e-3;
  const dir = moving ? Math.sign(side.vel) : Math.sign(volts);
  const acc = (volts - kS * dir - kV * side.vel) / Math.max(1e-3, kA);
  let next = side.vel + acc * dt;
  // Friction stops the wheel when it crosses zero; it breaks away again next step if pushed hard enough.
  if (moving && Math.sign(next) !== Math.sign(side.vel)) next = 0;
  side.vel = next;
  side.pos += side.vel * dt;
}

/** How much of the motion is rotation in place: 0 driving straight, 1 spinning. */
function turnFraction(a: number, b: number): number {
  const sum = Math.abs(a) + Math.abs(b);
  return sum > 1e-6 ? Math.abs(b - a) / sum : 0;
}

export function simulatePlan(
  plan: Plan,
  robot: RobotConfig,
  settings: SimSettings,
  plantOptions: Partial<PlantOptions> = {},
): SimResult {
  const plant = { ...defaultPlant(robot), ...plantOptions };
  const closedLoop = effectiveEncoder(robot) !== 'none';
  const kS = robot.kS * settings.kSScale;
  const kV = robot.kV * settings.kVScale;
  const kA = robot.kA * settings.kAScale;
  const left: Side = { pos: 0, vel: 0 };
  const right: Side = { pos: 0, vel: 0 };
  let x = plan.startPose.x;
  let y = plan.startPose.y;
  let heading = plan.startPose.heading;
  let t = 0;
  const trace: SimPoint[] = [{ t, x, y, heading }];
  const trueTrack = robot.trackWidth * settings.trackScale;
  let fault: EncoderFault | null = null;
  let timeouts = 0;

  const quantize = (v: number) => (plant.resolution > 0 ? Math.round(v / plant.resolution) * plant.resolution : v);
  const measure = (): WheelReadings => ({
    left: quantize(left.pos * plant.leftEncoder),
    right: quantize(right.pos * plant.rightEncoder),
    leftVel: left.vel * plant.leftEncoder,
    rightVel: right.vel * plant.rightEncoder,
  });
  const history: WheelReadings[] = [];
  const read = (): WheelReadings => history[Math.max(0, history.length - 1 - plant.latencyLoops)];

  const integrate = (lv: number, rv: number, duration: number) => {
    const supply = plant.supplyVolts;
    const lOut = Math.max(-supply, Math.min(supply, lv)) * settings.leftScale;
    const rOut = Math.max(-supply, Math.min(supply, rv)) * settings.rightScale;
    const steps = Math.max(1, Math.round(duration / PHYSICS_DT));
    const h = duration / steps;
    for (let i = 0; i < steps; i++) {
      const l0 = left.pos;
      const r0 = right.pos;
      const moving = Math.abs(left.vel) + Math.abs(right.vel) > 1e-3;
      const scrub = plant.scrubVolts * (moving ? turnFraction(left.vel, right.vel) : turnFraction(lOut, rOut));
      stepSide(left, lOut, kS + scrub, kV, kA, h);
      stepSide(right, rOut, kS + scrub, kV, kA, h);
      const dl = left.pos - l0;
      const dr = right.pos - r0;
      const dCenter = (dl + dr) / 2;
      const dTheta = (dr - dl) / trueTrack;
      x += dCenter * Math.cos(heading + dTheta / 2);
      y += dCenter * Math.sin(heading + dTheta / 2);
      heading += dTheta;
    }
    t += duration;
    trace.push({ t, x, y, heading });
    history.push(measure());
    if (history.length > 8) history.shift();
  };
  history.push(measure());

  let encodersWork = closedLoop;
  for (const st of plan.steps) {
    if (st.kind === 'command' || st.kind === 'wait') {
      // The robot coasts to a stop with zero output while actions run.
      let remaining = st.duration;
      while (remaining > 1e-9) {
        const d = Math.min(CONTROL_DT, remaining);
        integrate(0, 0, d);
        remaining -= d;
      }
      continue;
    }
    const follower = new KopFollower(st.samples, robot, encodersWork);
    follower.initialize(read());
    let dt = 0;
    for (let loop = 0; loop < 5000; loop++) {
      const out = follower.execute(dt, read());
      if (follower.finished) break;
      integrate(out.left, out.right, CONTROL_DT);
      dt = CONTROL_DT;
    }
    if (follower.fault) {
      fault = follower.fault;
      encodersWork = false;
    }
    if (follower.timedOut) timeouts += 1;
    // The finishing loop stops the motors before the next command starts.
    integrate(0, 0, CONTROL_DT);
  }
  // Let the robot come to rest.
  for (let i = 0; i < 50 && (Math.abs(left.vel) > 1e-3 || Math.abs(right.vel) > 1e-3); i++) integrate(0, 0, CONTROL_DT);

  const positionError = Math.hypot(x - plan.endPose.x, y - plan.endPose.y);
  let dh = ((heading - plan.endPose.heading) * 180) / Math.PI;
  dh = ((dh + 180) % 360 + 360) % 360 - 180;
  return { trace, totalTime: t, positionError, headingErrorDeg: dh, maxPathDeviation: pathDeviation(plan, trace), closedLoop, fault, timeouts };
}

/**
 * Farthest distance from the trace to the planned path (the line through every drive sample).
 * Measured by place, not time: a slow robot on the right path does not count as off.
 */
export function pathDeviation(plan: Plan, trace: SimPoint[]): number {
  const path: { x: number; y: number }[] = [plan.startPose];
  for (const st of plan.steps) {
    if (st.kind === 'drive') for (const s of st.samples) path.push(s);
  }
  if (path.length < 2) return Math.max(0, ...trace.map((p) => Math.hypot(p.x - plan.startPose.x, p.y - plan.startPose.y)));
  let worst = 0;
  for (const p of trace) {
    let best = Infinity;
    for (let i = 1; i < path.length && best > worst; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const u = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Pose of the simulated robot at time t (linear interpolation of the trace). */
export function simPoseAt(sim: SimResult, t: number): SimPoint {
  const tr = sim.trace;
  if (t <= tr[0].t) return tr[0];
  if (t >= tr[tr.length - 1].t) return tr[tr.length - 1];
  let lo = 0;
  let hi = tr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = tr[lo];
  const b = tr[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: a.heading + (b.heading - a.heading) * f };
}
