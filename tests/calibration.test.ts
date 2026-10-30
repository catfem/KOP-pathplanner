import { describe, expect, it } from 'vitest';
import { TEST_DRIVE_METERS, calibrate } from '../src/model/calibration';
import { INCH, defaultRobot } from '../src/model/defaults';
import type { RobotConfig } from '../src/model/types';
import { PERFECT_SIM, simulatePlan } from '../src/planner/simulate';
import { type Plan, buildTurnSamples } from '../src/planner/trajectory';
import { testTrajectories } from '../src/codegen/common';
import { defaultProject } from '../src/model/defaults';

/** A real robot whose wheels and effective track width differ from the settings. */
const real = { wheelDiameter: 6.3 * INCH, trackWidth: 0.66 };

/**
 * What the calibration autos show on that robot when the code was generated from `config`
 * (with encoders the follower drives exactly the planned encoder distances).
 */
function runTests(config: RobotConfig): { drove: number; turnOffset: number } {
  const wheelScale = real.wheelDiameter / config.wheelDiameter;
  const drove = TEST_DRIVE_METERS * wheelScale;
  const wheelTravel = Math.PI * config.trackWidth * wheelScale;
  const turned = ((2 * wheelTravel) / real.trackWidth) * (180 / Math.PI);
  return { drove, turnOffset: turned - 360 };
}

function apply(config: RobotConfig, changes: ReturnType<typeof calibrate>['changes']): RobotConfig {
  const next = { ...config };
  for (const c of changes) next[c.key] = c.to;
  return next;
}

describe('calibration from the test autos', () => {
  it('fixes the wheel diameter and the track width together from one run of both tests', () => {
    const config = defaultRobot();
    const first = runTests(config);
    expect(first.drove).toBeCloseTo(2.1, 3);
    expect(first.turnOffset).toBeLessThan(-30);
    const fixed = apply(config, calibrate(config, first, true).changes);
    expect(fixed.wheelDiameter).toBeCloseTo(real.wheelDiameter, 6);
    expect(fixed.trackWidth).toBeCloseTo(real.trackWidth, 6);
    const again = runTests(fixed);
    expect(again.drove).toBeCloseTo(TEST_DRIVE_METERS, 6);
    expect(again.turnOffset).toBeCloseTo(0, 6);
  });

  it('shows why fixing them one at a time from the same run does not settle', () => {
    // The old report formulas, both applied from the same run.
    const config = defaultRobot();
    const first = runTests(config);
    const byHand = {
      ...config,
      wheelDiameter: (config.wheelDiameter * first.drove) / TEST_DRIVE_METERS,
      trackWidth: (config.trackWidth * 360) / (360 + first.turnOffset),
    };
    expect(Math.abs(runTests(byHand).turnOffset)).toBeGreaterThan(10);
  });

  it('reads the turn direction explicitly, so "went past" narrows the track width', () => {
    const config = defaultRobot();
    const past = calibrate(config, { drove: 2, turnOffset: 20 }, true);
    expect(past.changes).toEqual([{ key: 'trackWidth', from: config.trackWidth, to: (config.trackWidth * 360) / 380 }]);
    const short = calibrate(config, { drove: 2, turnOffset: -20 }, true);
    expect(short.changes[0].to).toBeGreaterThan(config.trackWidth);
    expect(calibrate(config, { drove: 2, turnOffset: 0 }, true).changes).toEqual([]);
  });

  it('keeps the feedforward gains per real meter when the wheel diameter changes', () => {
    const config = defaultRobot();
    const changes = calibrate(config, { drove: 2.2, turnOffset: 0 }, true).changes;
    const byKey = Object.fromEntries(changes.map((c) => [c.key, c.to]));
    expect(byKey.wheelDiameter).toBeCloseTo(config.wheelDiameter * 1.1, 9);
    expect(byKey.kV).toBeCloseTo(config.kV / 1.1, 9);
    expect(byKey.kA).toBeCloseTo(config.kA / 1.1, 9);
    // The turn ran with the same short wheels, so the track width scales too.
    expect(byKey.trackWidth).toBeCloseTo(config.trackWidth * 1.1, 9);
  });

  it('corrects kV instead of the wheel diameter without encoders', () => {
    const config = { ...defaultRobot(), encoder: 'none' as const };
    const keys = calibrate(config, { drove: 1.8, turnOffset: 0 }, false).changes.map((c) => c.key);
    expect(keys).toEqual(['kV', 'trackWidth']);
  });

  it('warns about measurements that point at a setup mistake', () => {
    const config = defaultRobot();
    expect(calibrate(config, { drove: 0.6, turnOffset: 0 }, true).warnings.join(' ')).toContain('encoder setting');
    expect(calibrate(config, { drove: 2, turnOffset: 120 }, true).warnings.join(' ')).toContain('More than 90°');
    expect(calibrate(config, { drove: 2, turnOffset: 170 }, true).warnings.join(' ')).toContain('unusual');
    expect(calibrate(config, { drove: 2.04, turnOffset: -12 }, true).warnings).toEqual([]);
  });

  it('settles the turn on the simulated robot with the real follower', () => {
    // Wheel scrub makes the real effective track width 12% wider than the setting.
    const scrub = 1.12;
    const turnPlan = (robot: RobotConfig): Plan => {
      const { samples, duration } = buildTurnSamples({ x: 0, y: 0 }, 0, 2 * Math.PI, robot, 0.02);
      const step = { kind: 'turn' as const, start: 0, duration, waypointIndex: 0, fromHeading: 0, toHeading: 2 * Math.PI, samples };
      return {
        steps: [step],
        totalTime: duration,
        startPose: { x: 0, y: 0, heading: 0 },
        endPose: { x: 0, y: 0, heading: 2 * Math.PI },
        totalDistance: 0,
        peakVoltage: 0,
        warnings: [],
      };
    };
    const config = defaultRobot();
    const before = simulatePlan(turnPlan(config), config, { ...PERFECT_SIM, trackScale: scrub });
    expect(before.headingErrorDeg).toBeLessThan(-30);
    const fixed = apply(config, calibrate(config, { drove: 2, turnOffset: before.headingErrorDeg }, true).changes);
    // Same real robot: its true track width is still config.trackWidth * scrub.
    const after = simulatePlan(turnPlan(fixed), fixed, { ...PERFECT_SIM, trackScale: (config.trackWidth * scrub) / fixed.trackWidth });
    expect(Math.abs(after.headingErrorDeg)).toBeLessThan(1.5);
  });

  it('reads the wheel balance from the sideways drift of the drive test', () => {
    const config = defaultRobot();
    // 3.4 cm to the left after 2 m on a 0.56 m track: the right wheels go about 1% farther.
    const change = calibrate(config, { drove: 2, turnOffset: 0, sideways: 0.034 }, true).changes;
    expect(change).toHaveLength(1);
    expect(change[0].key).toBe('wheelBalance');
    expect(change[0].to).toBeCloseTo((2 * 0.56 * 0.034) / 4, 3);
    const right = calibrate(config, { drove: 2, turnOffset: 0, sideways: -0.034 }, true).changes[0].to;
    expect(right).toBeCloseTo(-change[0].to, 3);
    // Much more than tread wear: applied, with a warning to check the setup.
    expect(calibrate(config, { drove: 2, turnOffset: 0, sideways: 0.6 }, true).warnings.join(' ')).toContain('more than tread wear');
    // Far more than wheels explain: no change, a warning instead.
    const silly = calibrate(config, { drove: 2, turnOffset: 0, sideways: 0.9 }, true);
    expect(silly.changes).toEqual([]);
    expect(silly.warnings.join(' ')).toContain('started square');
  });

  const drivePlan = (robot: RobotConfig): Plan => {
    const project = defaultProject();
    project.robot = robot;
    const { drive } = testTrajectories(project);
    const last = drive[drive.length - 1];
    return {
      steps: [{ kind: 'drive', start: 0, duration: last.t, waypointIndex: 0, toIndex: 1, reversed: false, distance: 2, samples: drive, markers: [] }],
      totalTime: last.t,
      startPose: { x: 0, y: 0, heading: 0 },
      endPose: { x: last.x, y: last.y, heading: last.heading },
      totalDistance: 2,
      peakVoltage: 0,
      warnings: [],
    };
  };
  /** The simulator's wheel size setting is relative to the configured balance. */
  const relative = (robot: RobotConfig, trueRatio: number) => trueRatio / ((1 + robot.wheelBalance / 2) / (1 - robot.wheelBalance / 2));

  for (const encoders of [true, false]) {
    it(`straightens the drive on the simulated robot whose right wheels go 1% farther (${encoders ? 'encoders' : 'open loop'})`, () => {
      const config = { ...defaultRobot(), encoder: encoders ? ('rio' as const) : ('none' as const) };
      const trueRatio = 1.01;
      const run = (robot: RobotConfig) => {
        const sim = simulatePlan(drivePlan(robot), robot, { ...PERFECT_SIM, wheelSizeScale: relative(robot, trueRatio) });
        return sim.trace[sim.trace.length - 1];
      };
      const before = run(config);
      expect(before.y).toBeGreaterThan(0.02);
      const fixed = apply(config, calibrate(config, { drove: before.x, turnOffset: 0, sideways: before.y }, encoders).changes);
      expect(fixed.wheelBalance).toBeGreaterThan(0.005);
      const after = run(fixed);
      expect(Math.abs(after.y)).toBeLessThan(encoders ? 0.003 : before.y / 3);
    });
  }
});
