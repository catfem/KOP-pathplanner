// Physics simulation of the generated follower running on an imperfect robot.
//
// The controller below mirrors FollowKopTrajectory in the generated code:
// per-side feedforward (kS, kV, kA) plus optional encoder position/velocity
// feedback, re-zeroed at the start of every motion step, with a short settle
// phase at the end. The "true" robot can differ from the model (weaker side,
// different kS, wheel scrub) to show how far the robot drifts without a gyro.

import type { RobotConfig } from '../model/types';
import { feedforwardVolts, type Plan, sampleStates } from './trajectory';

export interface SimSettings {
  /** Torque multiplier of the left / right side (1 = matches the model). */
  leftScale: number;
  rightScale: number;
  /** True kS relative to the configured kS. */
  kSScale: number;
  /** True effective track width relative to the configured one (wheel scrub). */
  trackScale: number;
}

export const DEFAULT_SIM: SimSettings = { leftScale: 0.95, rightScale: 1.0, kSScale: 1.15, trackScale: 1.0 };

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
  closedLoop: boolean;
}

const PHYSICS_DT = 0.002;
const CONTROL_DT = 0.02;

interface Side {
  pos: number;
  vel: number;
}

function stepSide(side: Side, volts: number, scale: number, robot: RobotConfig, kSScale: number, dt: number): void {
  const kS = robot.kS * kSScale;
  const vEff = volts * scale;
  if (Math.abs(side.vel) < 1e-3 && Math.abs(vEff) <= kS) {
    side.vel = 0;
    return;
  }
  const moving = Math.abs(side.vel) >= 1e-3;
  const dir = moving ? Math.sign(side.vel) : Math.sign(vEff);
  const acc = (vEff - kS * dir - robot.kV * side.vel) / Math.max(1e-3, robot.kA);
  let next = side.vel + acc * dt;
  // Friction stops the wheel when it crosses zero; it breaks away again next step if pushed hard enough.
  if (moving && Math.sign(next) !== Math.sign(side.vel)) next = 0;
  side.vel = next;
  side.pos += side.vel * dt;
}

const MAX_STEER = 0.35; // rad
const STEER_FULL_SPEED = 0.3; // m/s

/**
 * Encoder-only odometry of the follower, relative to the start of one motion
 * step. Mirrors the odometry in the generated follower.
 */
export class FollowerOdometry {
  x: number;
  y: number;
  heading: number;
  private lastLeft = 0;
  private lastRight = 0;

  constructor(
    start: { x: number; y: number; heading: number },
    private readonly trackWidth: number,
  ) {
    this.x = start.x;
    this.y = start.y;
    this.heading = start.heading;
  }

  update(leftDistance: number, rightDistance: number): void {
    const dl = leftDistance - this.lastLeft;
    const dr = rightDistance - this.lastRight;
    this.lastLeft = leftDistance;
    this.lastRight = rightDistance;
    const dTheta = (dr - dl) / this.trackWidth;
    const d = (dl + dr) / 2;
    this.x += d * Math.cos(this.heading + dTheta / 2);
    this.y += d * Math.sin(this.heading + dTheta / 2);
    this.heading += dTheta;
  }

  /**
   * Stanley-style steering: turns towards the path when the robot drifts
   * sideways. Returned as a wheel distance added to the right setpoint and
   * subtracted from the left one.
   */
  steeringShift(sp: { x: number; y: number; v: number }, robot: Pick<RobotConfig, 'kLateral' | 'trackWidth'>): number {
    if (robot.kLateral <= 0 || Math.abs(sp.v) < 1e-3) return 0;
    const dx = sp.x - this.x;
    const dy = sp.y - this.y;
    const lateral = -Math.sin(this.heading) * dx + Math.cos(this.heading) * dy;
    const speedScale = Math.min(1, Math.abs(sp.v) / STEER_FULL_SPEED);
    const steer = Math.max(-MAX_STEER, Math.min(MAX_STEER, Math.atan(robot.kLateral * lateral)));
    return Math.sign(sp.v) * speedScale * steer * (robot.trackWidth / 2);
  }
}

export function simulatePlan(plan: Plan, robot: RobotConfig, settings: SimSettings): SimResult {
  const closedLoop = robot.encoder !== 'none';
  const left: Side = { pos: 0, vel: 0 };
  const right: Side = { pos: 0, vel: 0 };
  let x = plan.startPose.x;
  let y = plan.startPose.y;
  let heading = plan.startPose.heading;
  let t = 0;
  const trace: SimPoint[] = [{ t, x, y, heading }];
  const trueTrack = robot.trackWidth * settings.trackScale;

  const integrate = (lv: number, rv: number, duration: number) => {
    const steps = Math.max(1, Math.round(duration / PHYSICS_DT));
    const h = duration / steps;
    for (let i = 0; i < steps; i++) {
      const l0 = left.pos;
      const r0 = right.pos;
      stepSide(left, lv, settings.leftScale, robot, settings.kSScale, h);
      stepSide(right, rv, settings.rightScale, robot, settings.kSScale, h);
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
  };

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
    const l0 = left.pos;
    const r0 = right.pos;
    const odom = new FollowerOdometry(st.samples[0], robot.trackWidth);
    let local = 0;
    const settleLimit = st.duration + (closedLoop ? robot.maxSettleTime : 0);
    for (;;) {
      const done = local >= st.duration;
      const sp = sampleStates(st.samples, Math.min(local, st.duration));
      // Feedforward for the middle of the coming control period (zero-order hold).
      const ff = sampleStates(st.samples, Math.min(local + CONTROL_DT / 2, st.duration));
      let lv = done ? 0 : feedforwardVolts(robot, ff.lVel, ff.lAcc);
      let rv = done ? 0 : feedforwardVolts(robot, ff.rVel, ff.rAcc);
      if (closedLoop) {
        odom.update(left.pos - l0, right.pos - r0);
        const shift = done ? 0 : odom.steeringShift(sp, robot);
        const le = sp.lPos - shift - (left.pos - l0);
        const re = sp.rPos + shift - (right.pos - r0);
        if (done && Math.abs(le) < robot.positionTolerance && Math.abs(re) < robot.positionTolerance) break;
        const diff = (re - le) / 2;
        lv += robot.kP * le + robot.kD * (sp.lVel - left.vel) - robot.kPTurn * diff;
        rv += robot.kP * re + robot.kD * (sp.rVel - right.vel) + robot.kPTurn * diff;
        if (done) {
          if (Math.abs(le) >= robot.positionTolerance) lv += robot.kS * Math.sign(le);
          if (Math.abs(re) >= robot.positionTolerance) rv += robot.kS * Math.sign(re);
        }
      } else if (done) {
        break;
      }
      if (local >= settleLimit) break;
      const max = robot.maxVoltage;
      lv = Math.max(-max, Math.min(max, lv));
      rv = Math.max(-max, Math.min(max, rv));
      integrate(lv, rv, CONTROL_DT);
      local += CONTROL_DT;
    }
    // The finishing loop stops the motors before the next command starts.
    integrate(0, 0, CONTROL_DT);
  }
  // Let the robot come to rest.
  for (let i = 0; i < 50 && (Math.abs(left.vel) > 1e-3 || Math.abs(right.vel) > 1e-3); i++) integrate(0, 0, CONTROL_DT);

  const positionError = Math.hypot(x - plan.endPose.x, y - plan.endPose.y);
  let dh = ((heading - plan.endPose.heading) * 180) / Math.PI;
  dh = ((dh + 180) % 360 + 360) % 360 - 180;
  return { trace, totalTime: t, positionError, headingErrorDeg: dh, closedLoop };
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
