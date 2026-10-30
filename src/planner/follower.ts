// Reference implementation of the trajectory follower in the generated robot
// code (FollowKopTrajectory in Java, kop/follow.py in Python). The simulator
// runs this class, so keep the three in step.
//
// What it does each 20 ms loop, without a gyro:
// - Feedforward (kS, kV, kA) from each wheel's profile.
// - With encoders: wheel position/velocity feedback (kP, kD), heading hold on
//   the difference between the two wheel errors (kPTurn), and path correction
//   from encoder-only odometry (kLateral).
// - A progress clock instead of wall time: when the robot falls behind (heavier
//   or slower than planned, low battery, wheel scrub on turns), the setpoints
//   slow down and wait for it. Both wheels share the clock, so the path keeps
//   its shape instead of the robot cutting corners or ending a turn short.
// - Voltage limiting that scales both sides together, keeping the turn ratio.
// - A settle phase: the step ends when both wheels are on target and slow.
// - Encoder checks: a side that moves the wrong way or does not count stops the
//   closed loop (no runaway). The auto finishes open loop and reports the fix.

import type { RobotConfig } from '../model/types';
import { type TrajState, sampleStates } from './trajectory';

export const FOLLOWER = {
  loopPeriod: 0.02,
  /** Wheel lag (m) where the progress clock starts to slow down. */
  lagSlow: 0.04,
  /** Wheel lag (m) where the progress clock stops and waits for the robot. */
  lagStop: 0.2,
  /** How fast the clock rate may fall / rise, per second. */
  rateDown: 4,
  rateUp: 1.5,
  /** Both wheels must be slower than this (m/s) to finish a step. */
  settleSpeed: 0.1,
  /** Heading tolerance to finish a step, deg (the wheel tolerance alone allows several degrees). */
  headingTolerance: 0.75,
  /**
   * While settling, a wheel short of its target should approach it at `approachGain` × error
   * (at most `approachSpeed`). Extra volts build up at `boostRate` per second while it is
   * slower (static friction, tread scrub) and drain while it is faster.
   */
  approachGain: 4,
  approachSpeed: 0.3,
  boostRate: 6,
  boostMax: 4,
  /**
   * Heading hold also integrates the heading error while driving, so a weaker side (gearbox
   * friction, a tired motor) does not leave a steady heading error. Integral time, s, and limit, V.
   */
  turnIntegralTime: 1.0,
  turnIntegralMax: 3,
  maxSteer: 0.35,
  steerFullSpeed: 0.3,
  /**
   * Above this speed (m/s) the path correction steers less, in proportion, so it closes a sideways
   * error at the same rate at any speed. Steering harder at speed makes the robot weave once the
   * encoder readings lag (CAN encoders arrive a loop late).
   */
  steerRefSpeed: 1.0,
  /**
   * Encoder checks. Only volts above kS + `faultFriction` count as a strong push, so a wheel held
   * by static friction or tread scrub is never mistaken for a broken encoder.
   * - Backwards: the encoder moved `checkBackwards` m against a strong push.
   * - Not counting: the encoder stayed within `checkSilent` m while its side got enough push to
   *   travel `deadEffort` m and the other side moved `checkPlanned` m.
   * - Neither counting: both setpoints moved `checkPlanned` m and both encoders stayed within
   *   `checkSilent` m for `silentTime` s.
   */
  checkPlanned: 0.1,
  checkSilent: 0.01,
  checkBackwards: 0.05,
  faultFriction: 2.5,
  deadEffort: 0.1,
  silentTime: 0.5,
};

export type FollowerGains = Pick<
  RobotConfig,
  'kS' | 'kV' | 'kA' | 'kP' | 'kD' | 'kPTurn' | 'kLateral' | 'trackWidth' | 'positionTolerance' | 'maxSettleTime' | 'maxVoltage'
>;

/** Physical wheel readings, as the drivetrain reports them. */
export interface WheelReadings {
  left: number;
  right: number;
  leftVel: number;
  rightVel: number;
}

export interface EncoderFault {
  /** Physical side. */
  side: 'left' | 'right' | 'both';
  kind: 'backwards' | 'not-counting';
}

export function faultMessage(fault: EncoderFault, language: 'java' | 'python' = 'java'): string {
  if (fault.side === 'both') return 'neither encoder is counting. Check their wiring, ports or CAN IDs.';
  const Side = fault.side === 'left' ? 'Left' : 'Right';
  const motor = language === 'java' ? `kInvert${Side}` : `INVERT_${fault.side.toUpperCase()}`;
  const encoder = language === 'java' ? `kInvert${Side}Encoder` : `INVERT_${fault.side.toUpperCase()}_ENCODER`;
  return fault.kind === 'backwards'
    ? `the ${fault.side} side moved the opposite way to its motors. If the ${fault.side} wheels turned the wrong way, flip ${motor}; otherwise flip ${encoder}.`
    : `the ${fault.side} side is not moving or its encoder is not counting. Check the encoder wiring, ports or CAN ID (a thrown chain or tripped breaker looks the same).`;
}

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** Distance a wheel is behind its setpoint along its direction of travel (negative when ahead). */
function lag(error: number, velocity: number): number {
  return Math.abs(velocity) > 0.02 ? error * sign(velocity) : 0;
}

export class KopFollower {
  /** Progress along the trajectory, s. Markers trigger on this, not on wall time. */
  progress = 0;
  /** Rate of the progress clock (1 = as planned). */
  rate = 1;
  finished = false;
  closedLoop: boolean;
  fault: EncoderFault | null = null;
  timedOut = false;

  private readonly total: number;
  private elapsed = 0;
  private settleTime = 0;
  private leftStart = 0;
  private rightStart = 0;
  private silentTime = 0;
  // Volts applied in the last loop (trajectory frame) and the travel they should have produced.
  private lastLeftVolts = 0;
  private lastRightVolts = 0;
  private leftEffort = 0;
  private rightEffort = 0;
  // Distance each wheel has moved against a strong push from its motors (a backwards encoder).
  private leftAgainst = 0;
  private rightAgainst = 0;
  private checkedLeft = 0;
  private checkedRight = 0;
  // Where each encoder last moved (by checkSilent), and the other side's reading at that moment.
  private leftAnchor = 0;
  private rightAnchor = 0;
  private rightAtLeftAnchor = 0;
  private leftAtRightAnchor = 0;
  private odomX: number;
  private odomY: number;
  private odomHeading: number;
  private lastLeft = 0;
  private lastRight = 0;
  private leftBoost = 0;
  private rightBoost = 0;
  private turnIntegral = 0;

  constructor(
    private readonly samples: TrajState[],
    private readonly g: FollowerGains,
    closedLoop: boolean,
    private readonly mirrored = false,
    /** Drivetrains without encoders: each side's voltage is divided by these (the wheel balance). */
    private readonly voltageBalance: { left: number; right: number } | null = null,
  ) {
    this.closedLoop = closedLoop;
    this.total = samples[samples.length - 1].t;
    const start = samples[0];
    this.odomX = start.x;
    this.odomY = start.y;
    this.odomHeading = start.heading;
  }

  initialize(r: WheelReadings): void {
    this.leftStart = r.left;
    this.rightStart = r.right;
  }

  /**
   * One control loop. `dt` is the time since the previous call (0 on the first).
   * Returns the physical left/right voltages.
   */
  execute(dt: number, readings: WheelReadings): { left: number; right: number } {
    const g = this.g;
    const total = this.total;
    this.elapsed += dt;
    this.progress = Math.min(total, this.progress + this.rate * dt);
    const following = this.progress < total;
    const sp = sampleStates(this.samples, this.progress);
    // Feedforward targets the middle of the coming loop period.
    const ff = sampleStates(this.samples, Math.min(total, this.progress + (this.rate * FOLLOWER.loopPeriod) / 2));

    let leftVolts = following ? this.feedforward(ff.lVel, ff.lAcc) : 0;
    let rightVolts = following ? this.feedforward(ff.rVel, ff.rAcc) : 0;

    if (!this.closedLoop) {
      if (!following) return this.finish();
      return this.output(leftVolts, rightVolts);
    }

    // Everything below works in the trajectory's frame; a mirrored path swaps the sides.
    let left = readings.left - this.leftStart;
    let right = readings.right - this.rightStart;
    let leftVel = readings.leftVel;
    let rightVel = readings.rightVel;
    if (this.mirrored) {
      [left, right] = [right, left];
      [leftVel, rightVel] = [rightVel, leftVel];
    }

    if (this.checkEncoders(left, right, sp, dt)) {
      // No encoders from here on: finish the step open loop.
      this.rate = 1;
      if (!following) return this.finish();
      return this.output(leftVolts, rightVolts);
    }

    this.updateOdometry(left, right);
    const shift = following ? this.steeringShift(sp) : 0;
    const leftError = sp.lPos - shift - left;
    const rightError = sp.rPos + shift - right;

    if (following) {
      // Slow the clock while the robot lags behind its setpoints, and stop it when far behind.
      const behind = Math.max(0, lag(sp.lPos - left, sp.lVel), lag(sp.rPos - right, sp.rVel));
      const target = Math.max(0, Math.min(1, 1 - (behind - FOLLOWER.lagSlow) / (FOLLOWER.lagStop - FOLLOWER.lagSlow)));
      this.rate =
        target < this.rate
          ? Math.max(target, this.rate - FOLLOWER.rateDown * dt)
          : Math.min(target, this.rate + FOLLOWER.rateUp * dt);
    } else {
      this.settleTime += dt;
      const distanceError = Math.abs(leftError + rightError) / 2;
      const turnError = Math.abs(rightError - leftError) / 2;
      const onTarget = distanceError < g.positionTolerance && turnError < this.turnTolerance();
      const slow = Math.abs(leftVel) < FOLLOWER.settleSpeed && Math.abs(rightVel) < FOLLOWER.settleSpeed;
      if ((onTarget && slow) || this.settleTime >= g.maxSettleTime) return this.finish();
    }
    if (this.elapsed > 2 * total + 2) {
      // Blocked (e.g. against a wall): give up on this step instead of stalling the auto.
      this.timedOut = true;
      return this.finish();
    }

    const headingError = (rightError - leftError) / 2;
    if (following && FOLLOWER.turnIntegralTime > 0) {
      const limit = FOLLOWER.turnIntegralMax;
      const next = this.turnIntegral + ((g.kPTurn * headingError) / FOLLOWER.turnIntegralTime) * dt;
      this.turnIntegral = Math.max(-limit, Math.min(limit, next));
    } else if (!following) {
      this.turnIntegral = 0;
    }
    const turnVolts = g.kPTurn * headingError + this.turnIntegral;
    leftVolts += g.kP * leftError + g.kD * (this.rate * sp.lVel - leftVel) - turnVolts;
    rightVolts += g.kP * rightError + g.kD * (this.rate * sp.rVel - rightVel) + turnVolts;
    if (!following) {
      // Settling on the final position: push through static friction, harder the longer a wheel is stuck.
      this.leftBoost = this.boost(this.leftBoost, leftError, leftVel, dt);
      this.rightBoost = this.boost(this.rightBoost, rightError, rightVel, dt);
      leftVolts += g.kS * sign(leftError) + this.leftBoost;
      rightVolts += g.kS * sign(rightError) + this.rightBoost;
    }
    return this.output(leftVolts, rightVolts);
  }

  /** Wheel error (m) that keeps the heading within FOLLOWER.headingTolerance. */
  private turnTolerance(): number {
    return ((this.g.trackWidth / 2) * FOLLOWER.headingTolerance * Math.PI) / 180;
  }

  /**
   * Extra voltage for one wheel while settling (signed). It builds up while the wheel approaches
   * its target too slowly (stuck on static friction or scrub), drains while it is too fast, and
   * resets once the wheel reaches or passes the target.
   */
  private boost(current: number, error: number, velocity: number, dt: number): number {
    if (Math.abs(error) <= this.turnTolerance() / 2 || current * error < 0) return 0;
    const toward = velocity * sign(error);
    const wanted = Math.min(FOLLOWER.approachSpeed, FOLLOWER.approachGain * Math.abs(error));
    let size = Math.abs(current);
    if (toward < wanted * 0.75) size = Math.min(FOLLOWER.boostMax, size + FOLLOWER.boostRate * dt);
    else if (toward > wanted * 1.25) size = Math.max(0, size - FOLLOWER.boostRate * dt);
    return size * sign(error);
  }

  private feedforward(velocity: number, acceleration: number): number {
    const g = this.g;
    const direction = Math.abs(velocity) > 1e-4 ? sign(velocity) : Math.abs(acceleration) > 1e-4 ? sign(acceleration) : 0;
    return g.kS * direction + g.kV * this.rate * velocity + g.kA * this.rate * this.rate * acceleration;
  }

  /**
   * Without encoders, evens out the sides by the wheel balance. Then limits both sides by the same
   * factor so the robot keeps turning at the planned ratio.
   */
  private output(leftVolts: number, rightVolts: number): { left: number; right: number } {
    const balance = this.voltageBalance;
    if (balance) {
      // A mirrored path drives the robot's right side with the trajectory's left.
      leftVolts /= this.mirrored ? balance.right : balance.left;
      rightVolts /= this.mirrored ? balance.left : balance.right;
    }
    const peak = Math.max(Math.abs(leftVolts), Math.abs(rightVolts));
    if (peak > this.g.maxVoltage) {
      leftVolts *= this.g.maxVoltage / peak;
      rightVolts *= this.g.maxVoltage / peak;
    }
    this.lastLeftVolts = leftVolts;
    this.lastRightVolts = rightVolts;
    return this.mirrored ? { left: rightVolts, right: leftVolts } : { left: leftVolts, right: rightVolts };
  }

  private finish(): { left: number; right: number } {
    this.finished = true;
    this.lastLeftVolts = 0;
    this.lastRightVolts = 0;
    return { left: 0, right: 0 };
  }

  /**
   * Compares how far each side has moved with its setpoint (and, for a silent side, how hard it
   * was driven). Returns true and records the fault when an encoder cannot be trusted.
   */
  private checkEncoders(left: number, right: number, sp: TrajState, dt: number): boolean {
    const g = this.g;
    const push = (volts: number) => (Math.max(0, Math.abs(volts) - g.kS - FOLLOWER.faultFriction) * dt) / Math.max(0.1, g.kV);
    // A wheel reads backwards when its encoder keeps moving against a strong push from its motors:
    // with the sign wrong, every correction drives it further the wrong way. A wheel held by
    // friction does not move, and a braking wheel only coasts a little against the push.
    const against = (total: number, moved: number, volts: number) => {
      if (push(volts) > 0 && moved * volts < 0) return total + Math.abs(moved);
      return moved * volts > 0 ? 0 : total;
    };
    this.leftAgainst = against(this.leftAgainst, left - this.checkedLeft, this.lastLeftVolts);
    this.rightAgainst = against(this.rightAgainst, right - this.checkedRight, this.lastRightVolts);
    this.checkedLeft = left;
    this.checkedRight = right;
    // A dead encoder stays put while its side is driven hard and the other side keeps moving. The
    // effort restarts whenever the encoder moves, so a wheel that pauses (held by friction, or
    // turning around on a tight curve) does not add up.
    if (Math.abs(left - this.leftAnchor) >= FOLLOWER.checkSilent) {
      this.leftAnchor = left;
      this.leftEffort = 0;
      this.rightAtLeftAnchor = right;
    }
    if (Math.abs(right - this.rightAnchor) >= FOLLOWER.checkSilent) {
      this.rightAnchor = right;
      this.rightEffort = 0;
      this.leftAtRightAnchor = left;
    }
    this.leftEffort += push(this.lastLeftVolts);
    this.rightEffort += push(this.lastRightVolts);
    const leftDead = this.leftEffort > FOLLOWER.deadEffort && Math.abs(right - this.rightAtLeftAnchor) > FOLLOWER.checkPlanned;
    const rightDead = this.rightEffort > FOLLOWER.deadEffort && Math.abs(left - this.leftAtRightAnchor) > FOLLOWER.checkPlanned;
    const silent = (planned: number, measured: number) =>
      Math.abs(planned) > FOLLOWER.checkPlanned && Math.abs(measured) < FOLLOWER.checkSilent;
    const leftKind: EncoderFault['kind'] | null =
      this.leftAgainst > FOLLOWER.checkBackwards
        ? 'backwards'
        : leftDead
          ? 'not-counting'
          : null;
    const rightKind: EncoderFault['kind'] | null =
      this.rightAgainst > FOLLOWER.checkBackwards
        ? 'backwards'
        : rightDead
          ? 'not-counting'
          : null;
    if (leftKind || rightKind) {
      // Report the physical side: a mirrored path swapped them.
      const trajectoryLeft = leftKind !== null;
      this.fault = { side: trajectoryLeft !== this.mirrored ? 'left' : 'right', kind: (leftKind ?? rightKind) as EncoderFault['kind'] };
      this.closedLoop = false;
      return true;
    }
    // Both silent while both setpoints moved: wait a moment in case the robot is just slow to break away.
    this.silentTime = silent(sp.lPos, left) && silent(sp.rPos, right) ? this.silentTime + dt : 0;
    if (this.silentTime > FOLLOWER.silentTime) {
      this.fault = { side: 'both', kind: 'not-counting' };
      this.closedLoop = false;
      return true;
    }
    return false;
  }

  private updateOdometry(left: number, right: number): void {
    const dl = left - this.lastLeft;
    const dr = right - this.lastRight;
    this.lastLeft = left;
    this.lastRight = right;
    const dTheta = (dr - dl) / this.g.trackWidth;
    const d = (dl + dr) / 2;
    this.odomX += d * Math.cos(this.odomHeading + dTheta / 2);
    this.odomY += d * Math.sin(this.odomHeading + dTheta / 2);
    this.odomHeading += dTheta;
  }

  /**
   * Stanley-style steering: turns towards the path when the robot drifts sideways.
   * Returned as a wheel distance added to the right setpoint and taken from the left.
   */
  private steeringShift(sp: TrajState): number {
    const g = this.g;
    const velocity = (sp.lVel + sp.rVel) / 2;
    if (g.kLateral <= 0 || Math.abs(velocity) < 1e-3) return 0;
    const dx = sp.x - this.odomX;
    const dy = sp.y - this.odomY;
    const lateral = -Math.sin(this.odomHeading) * dx + Math.cos(this.odomHeading) * dy;
    const speedScale = Math.min(1, Math.abs(velocity) / FOLLOWER.steerFullSpeed);
    const gain = g.kLateral * Math.min(1, FOLLOWER.steerRefSpeed / Math.abs(velocity));
    const steer = Math.max(-FOLLOWER.maxSteer, Math.min(FOLLOWER.maxSteer, Math.atan(gain * lateral)));
    return sign(velocity) * speedScale * steer * (g.trackWidth / 2);
  }
}
