import { describe, expect, it } from 'vitest';
import { generateCode } from '../src/codegen';
import { defaultProject, defaultRobot } from '../src/model/defaults';
import { balanceScales, effectiveEncoder, withFront } from '../src/model/hardware';
import { describeSettings, normalizeRobot } from '../src/model/robotConfigs';
import type { RobotConfig } from '../src/model/types';

/**
 * The real robot behind a config that drives correctly with the head as its front. Travel is
 * measured towards the head, and sides are seen from behind the head.
 */
interface Wiring {
  /** Physical side of each motor ID, and which way positive output drives it. */
  motors: Map<number, { side: 'L' | 'R'; travelPerVolt: number }>;
  /** Physical side of each roboRIO encoder (by its first DIO port), and its raw count per meter. */
  encoders: Map<number, { side: 'L' | 'R'; countPerMeter: number }>;
}

function wiringOf(head: RobotConfig): Wiring {
  const motors = new Map<number, { side: 'L' | 'R'; travelPerVolt: number }>();
  head.leftIds.forEach((id) => motors.set(id, { side: 'L', travelPerVolt: head.invertLeft ? -1 : 1 }));
  head.rightIds.forEach((id) => motors.set(id, { side: 'R', travelPerVolt: head.invertRight ? -1 : 1 }));
  const encoders = new Map<number, { side: 'L' | 'R'; countPerMeter: number }>();
  encoders.set(head.leftEncoderPorts[0], { side: 'L', countPerMeter: head.invertLeftEncoder ? -1 : 1 });
  encoders.set(head.rightEncoderPorts[0], { side: 'R', countPerMeter: head.invertRightEncoder ? -1 : 1 });
  return { motors, encoders };
}

/** Travel of each physical side towards the head when the generated code sets these voltages. */
function drive(wiring: Wiring, config: RobotConfig, left: number, right: number): { L: number; R: number } {
  const travel: Record<'L' | 'R', number[]> = { L: [], R: [] };
  const apply = (ids: number[], invert: boolean, volts: number) =>
    ids.forEach((id) => {
      const motor = wiring.motors.get(id)!;
      travel[motor.side].push(motor.travelPerVolt * (invert ? -1 : 1) * volts);
    });
  apply(config.leftIds, config.invertLeft, left);
  apply(config.rightIds, config.invertRight, right);
  // Every motor on a side must push the same way, or the gearbox fights itself.
  for (const side of ['L', 'R'] as const) expect(new Set(travel[side]).size, `side ${side}`).toBe(1);
  return { L: travel.L[0], R: travel.R[0] };
}

/** What the generated code reads for each side after the physical sides travel this far towards the head. */
function read(wiring: Wiring, config: RobotConfig, travel: { L: number; R: number }): { left: number; right: number } {
  const side = (ports: [number, number], invertEncoder: boolean, leaderId: number, invertMotor: boolean) => {
    if (effectiveEncoder(config) === 'rio') {
      // new Encoder(ports, invert): the raw count, flipped when asked.
      const encoder = wiring.encoders.get(ports[0])!;
      return (invertEncoder ? -1 : 1) * encoder.countPerMeter * travel[encoder.side];
    }
    // Through the controller: motor rotations, signed by the motor and encoder inversions.
    const motor = wiring.motors.get(leaderId)!;
    return (invertMotor ? -1 : 1) * (invertEncoder ? -1 : 1) * motor.travelPerVolt * travel[motor.side];
  };
  return {
    left: side(config.leftEncoderPorts, config.invertLeftEncoder, config.leftIds[0], config.invertLeft),
    right: side(config.rightEncoderPorts, config.invertRightEncoder, config.rightIds[0], config.invertRight),
  };
}

const neo = (): RobotConfig => ({
  ...defaultRobot(),
  motor: 'NEO',
  controller: 'can-sparkmax-brushless',
  encoder: 'integrated',
  leftIds: [1, 2],
  rightIds: [3, 4],
  invertLeft: true,
  invertRight: false,
  invertLeftEncoder: false,
  invertRightEncoder: false,
});

describe('robot front', () => {
  const robots: [string, RobotConfig][] = [
    ['roboRIO encoders', { ...defaultRobot(), wheelBalance: 0.012 }],
    ['SPARK MAX built-in encoders', neo()],
    ['no encoders', { ...defaultRobot(), controller: 'pwm-sparkmax', encoder: 'none', leftIds: [0, 1], rightIds: [2, 3] }],
  ];

  for (const [name, head] of robots) {
    it(`drives the intake end first without rewiring (${name})`, () => {
      const wiring = wiringOf(head);
      // The head config really is right: forward drives the head first, and turning left is counter-clockwise.
      expect(drive(wiring, head, 1, 1)).toEqual({ L: 1, R: 1 });

      const intake = withFront(head, 'intake');
      expect(intake.front).toBe('intake');
      // Forward now drives the intake first: both sides travel away from the head.
      expect(drive(wiring, intake, 1, 1)).toEqual({ L: -1, R: -1 });
      // Turning left (less on the left, more on the right) is still counter-clockwise seen from above.
      const turn = drive(wiring, intake, -1, 1);
      expect(turn.R - turn.L).toBeGreaterThan(0);

      if (effectiveEncoder(head) !== 'none') {
        expect(read(wiring, head, { L: 1, R: 1 })).toEqual({ left: 1, right: 1 });
        // Rolled towards the intake, both distances go up.
        expect(read(wiring, intake, { L: -1, R: -1 })).toEqual({ left: 1, right: 1 });
        // Turning counter-clockwise, the right side reads more than the left, as the follower's odometry expects.
        const turned = read(wiring, intake, { L: -0.3, R: 0.3 });
        expect(turned.right - turned.left).toBeCloseTo(0.6, 9);
      }
    });

    it(`switching back restores the settings (${name})`, () => {
      const back = withFront(withFront(head, 'intake'), 'head');
      expect(back).toEqual(head);
      expect(withFront(head, 'head')).toBe(head);
    });
  }

  it('moves the wheel balance with the wheels', () => {
    const head = { ...defaultRobot(), wheelBalance: 0.01 };
    const intake = withFront(head, 'intake');
    expect(intake.wheelBalance).toBe(-0.01);
    // The physical right wheels (head view) are now on the left, and still travel the farthest.
    expect(balanceScales(intake.wheelBalance).left).toBe(balanceScales(head.wheelBalance).right);
    expect(Object.is(withFront(defaultRobot(), 'intake').wheelBalance, 0)).toBe(true);
  });

  it('is kept in saved settings and reset when unknown', () => {
    expect(defaultRobot().front).toBe('head');
    expect(normalizeRobot({ ...defaultRobot(), front: 'intake' }).front).toBe('intake');
    expect(normalizeRobot({ ...defaultRobot(), front: 'tail' }).front).toBe('head');
    const { front: _front, ...old } = defaultRobot();
    expect(normalizeRobot(old).front).toBe('head');
    expect(describeSettings({ robot: withFront(defaultRobot(), 'intake'), codegen: defaultProject().codegen })).toContain('intake first');
  });

  it('names the front in the generated code and checklist', () => {
    for (const language of ['java', 'python'] as const) {
      const p = defaultProject();
      p.codegen.language = language;
      p.robot = withFront(p.robot, 'intake');
      const files = generateCode(p);
      const all = files.map((f) => f.content).join('\n');
      expect(all).toContain('Front: the intake end leads when driving forward.');
      expect(all).toContain('the intake end (planner Robot tab)');
      const readme = files.find((f) => f.path === 'KOP_AUTOS_README.md')!.content;
      expect(readme).toContain('The front is the **intake** end');
      expect(readme).toContain('the intake end must lead');
      const constants = files.find((f) => /KopDriveConstants\.java|constants\.py$/.test(f.path))!.content;
      expect(constants).toMatch(language === 'java' ? /kLeftMotorIds = \{3, 4\}/ : /LEFT_MOTOR_IDS = \[3, 4\]/);
    }
  });
});
