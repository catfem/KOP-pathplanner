import { describe, expect, it } from 'vitest';
import { defaultProject, defaultRobot } from '../src/model/defaults';
import { KopFollower, faultMessage } from '../src/planner/follower';
import { PERFECT_SIM, simulatePlan } from '../src/planner/simulate';
import { buildTurnSamples, planAuto } from '../src/planner/trajectory';

const project = defaultProject();
const robot = defaultRobot();
const plans = project.autos.map((a) => planAuto(a, robot, { commands: project.commands, field: project.field }));

/** A KOP robot that is clearly not what the planner assumed. */
const realKop = { leftScale: 0.92, rightScale: 1, kSScale: 1.4, trackScale: 1, kVScale: 1.15, kAScale: 1.5 };
const realHardware = { scrubVolts: 2, supplyVolts: 11, latencyLoops: 1 };

describe('KopFollower on a real-world robot', () => {
  it('stays on the path when the robot is heavier, slower and draggier than planned', () => {
    for (const plan of plans) {
      const sim = simulatePlan(plan, robot, realKop, realHardware);
      expect(sim.fault).toBeNull();
      expect(sim.timeouts).toBe(0);
      expect(sim.positionError).toBeLessThan(0.15);
      expect(Math.abs(sim.headingErrorDeg)).toBeLessThan(2);
      // It waits for the robot instead of cutting corners, so the auto takes longer.
      expect(sim.totalTime).toBeGreaterThan(plan.totalTime);
    }
  });

  it('finishes turns in place despite tread scrub', () => {
    const turnOnly = planAuto(project.autos[1], robot, { commands: project.commands });
    const sim = simulatePlan(turnOnly, robot, PERFECT_SIM, { scrubVolts: 2.5 });
    expect(Math.abs(sim.headingErrorDeg)).toBeLessThan(1.5);
    expect(sim.positionError).toBeLessThan(0.06);
  });

  it('holds heading with a weaker side', () => {
    for (const plan of plans) {
      const sim = simulatePlan(plan, robot, { ...PERFECT_SIM, leftScale: 0.85 });
      expect(Math.abs(sim.headingErrorDeg)).toBeLessThan(2);
      expect(sim.positionError).toBeLessThan(0.08);
    }
  });

  it('keeps the voltage ratio between the sides when it limits the output', () => {
    const { samples } = buildTurnSamples({ x: 0, y: 0 }, 0, Math.PI, robot, 0.02);
    const follower = new KopFollower(samples, { ...robot, maxVoltage: 2 }, true);
    follower.initialize({ left: 0, right: 0, leftVel: 0, rightVel: 0 });
    // The robot does not move at all: the errors grow and the output saturates.
    let out = { left: 0, right: 0 };
    for (let i = 0; i < 20; i++) out = follower.execute(i === 0 ? 0 : 0.02, { left: 0, right: 0, leftVel: 0, rightVel: 0 });
    expect(Math.max(Math.abs(out.left), Math.abs(out.right))).toBeCloseTo(2, 6);
    expect(out.left).toBeCloseTo(-out.right, 6);
  });
});

describe('encoder checks', () => {
  it('catches an encoder that reads backwards before the robot runs away', () => {
    for (const plan of plans) {
      const sim = simulatePlan(plan, robot, PERFECT_SIM, { leftEncoder: -1 });
      expect(sim.fault).toEqual({ side: 'left', kind: 'backwards' });
      // Open loop from then on: no runaway across the field.
      expect(sim.positionError).toBeLessThan(1);
    }
  });

  it('catches one dead encoder and two dead encoders', () => {
    expect(simulatePlan(plans[0], robot, PERFECT_SIM, { rightEncoder: 0 }).fault).toEqual({ side: 'right', kind: 'not-counting' });
    const both = simulatePlan(plans[1], robot, PERFECT_SIM, { leftEncoder: 0, rightEncoder: 0 });
    expect(both.fault).toEqual({ side: 'both', kind: 'not-counting' });
    expect(both.positionError).toBeLessThan(1);
  });

  it('does not mistake friction, scrub or latency for a broken encoder', () => {
    for (const plan of plans) {
      for (const hardware of [realHardware, { scrubVolts: 3.5 }, { latencyLoops: 2 }]) {
        expect(simulatePlan(plan, robot, realKop, hardware).fault).toBeNull();
      }
    }
  });

  it('names the physical side on a mirrored path', () => {
    const { samples } = buildTurnSamples({ x: 0, y: 0 }, 0, Math.PI / 2, robot, 0.02);
    const follower = new KopFollower(samples, robot, true, true);
    follower.initialize({ left: 0, right: 0, leftVel: 0, rightVel: 0 });
    // Mirrored, the physical right wheel drives forward. Its encoder reads backwards.
    let right = 0;
    for (let i = 0; i < 100 && !follower.fault; i++) {
      const out = follower.execute(i === 0 ? 0 : 0.02, { left: 0, right: -right, leftVel: 0, rightVel: 0 });
      right += (out.right / robot.kV) * 0.02;
    }
    expect(follower.fault).toEqual({ side: 'right', kind: 'backwards' });
    expect(faultMessage(follower.fault!)).toContain('kInvertRight');
    expect(faultMessage(follower.fault!, 'python')).toContain('INVERT_RIGHT_ENCODER');
  });
});
