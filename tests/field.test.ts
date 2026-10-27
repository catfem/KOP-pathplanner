import { describe, expect, it } from 'vitest';
import { generateCode } from '../src/codegen';
import { defaultProject, defaultRobot } from '../src/model/defaults';
import {
  BUMP_DEPTH,
  BUMP_WIDTH,
  HUB_SIZE,
  bumperAgainst,
  bumperDistances,
  bumperGap,
  footprint,
  overlapsElement,
  presetElements,
  rebuilt2026Elements,
} from '../src/model/field';
import { DRIVETRAIN_PRESETS, motorControllerIssue } from '../src/model/hardware';
import { normalizeProject } from '../src/model/store';

const robot = defaultRobot();

describe('2026 field elements', () => {
  const elements = rebuilt2026Elements();
  const get = (id: string) => elements.find((e) => e.id === id)!;

  it('places the HUBs from the AprilTag layout, symmetric about the field center', () => {
    const blue = get('blue-hub');
    const red = get('red-hub');
    expect(blue.x).toBeCloseTo(4.6255, 4);
    expect(blue.y).toBeCloseTo(4.0345, 4);
    expect(red.x).toBeCloseTo(11.9155, 4);
    expect(blue.x + red.x).toBeCloseTo(16.541, 3);
    expect(blue.sizeX).toBeCloseTo(47 * 0.0254, 6);
  });

  it('puts a BUMP on each side of each HUB and a TRENCH along each guardrail', () => {
    for (const alliance of ['blue', 'red']) {
      const hub = get(`${alliance}-hub`);
      for (const side of ['left', 'right']) {
        const bump = get(`${alliance}-bump-${side}`);
        expect(bump.sizeX).toBeCloseTo(BUMP_DEPTH, 6);
        expect(bump.sizeY).toBeCloseTo(BUMP_WIDTH, 6);
        expect(bump.x).toBe(hub.x);
        // Touches the HUB edge.
        expect(Math.abs(bump.y - hub.y)).toBeCloseTo(HUB_SIZE / 2 + BUMP_WIDTH / 2, 6);
        const trench = get(`${alliance}-trench-${side}`);
        expect(Math.min(trench.y - trench.sizeY / 2, 8.069 - trench.y - trench.sizeY / 2)).toBeCloseTo(0, 6);
      }
    }
    expect(elements).toHaveLength(10);
    expect(presetElements('frc2025')).toEqual([]);
  });

  it('detects overlap between the bumpers and an element', () => {
    const hub = get('blue-hub');
    const far = footprint(robot.length, robot.width, 2, hub.y, 0);
    expect(overlapsElement(far, hub)).toBe(false);
    const touching = footprint(robot.length, robot.width, hub.x - hub.sizeX / 2 - robot.length / 2 + 0.01, hub.y, 0);
    expect(overlapsElement(touching, hub)).toBe(true);
    // Rotated robot near a corner: bounding boxes overlap, the robot does not.
    const diag = footprint(robot.length, robot.width, hub.x - hub.sizeX / 2 - 0.55, hub.y + hub.sizeY / 2 + 0.55, Math.PI / 4);
    expect(overlapsElement(diag, hub)).toBe(false);
  });

  it('puts the front bumper against the HUB', () => {
    const hub = get('blue-hub');
    const p = bumperAgainst(hub, { x: 2, y: hub.y }, robot, 0.02);
    expect(p.y).toBeCloseTo(hub.y, 6);
    expect(p.x).toBeCloseTo(hub.x - hub.sizeX / 2 - robot.length / 2 - 0.02, 3);
    expect(p.heading).toBeCloseTo(0, 6);
    expect(bumperGap(hub, p.x, p.y, robot)).toBeCloseTo(0.02, 3);
    expect(bumperGap(hub, 2, hub.y, robot)).toBeCloseTo(hub.x - hub.sizeX / 2 - robot.length / 2 - 2, 3);
    // Diagonal approach still ends clear of the HUB.
    const d = bumperAgainst(hub, { x: 3, y: 2.5 }, robot, 0.02);
    expect(overlapsElement(footprint(robot.length, robot.width, d.x, d.y, d.heading), hub)).toBe(false);
    expect(overlapsElement(footprint(robot.length, robot.width, d.x, d.y, d.heading), hub, 0.03)).toBe(true);
  });

  it('measures bumper distances to the walls', () => {
    const field = { length: 16.541, width: 8.069 };
    const d = bumperDistances(robot, { x: 1, y: 1.5, heading: 0 }, field);
    expect(d.wall.side).toBe('blue');
    expect(d.wall.distance).toBeCloseTo(1 - robot.length / 2, 6);
    expect(d.rail.side).toBe('right');
    expect(d.rail.distance).toBeCloseTo(1.5 - robot.width / 2, 6);
    const r = bumperDistances(robot, { x: 15.9, y: 7, heading: Math.PI }, field);
    expect(r.wall.side).toBe('red');
    expect(r.rail.side).toBe('left');
  });

  it('gives old projects the 2026 elements', () => {
    const p = normalizeProject({ field: { preset: 'frc2026', length: 16.541, width: 8.069 } });
    expect(p.field.elements).toHaveLength(10);
    expect(p.field.elementsEnabled).toBe(true);
    const w = normalizeProject({ autos: [{ name: 'A', waypoints: [{ x: 1, y: 2 }] }] }).autos[0].waypoints[0];
    expect(w.aimAt).toBeNull();
  });
});

describe('NEO support', () => {
  it('offers consistent drivetrain presets', () => {
    for (const preset of DRIVETRAIN_PRESETS) {
      expect(motorControllerIssue({ ...robot, ...preset.apply }), preset.id).toBeNull();
    }
    expect(motorControllerIssue({ motor: 'NEO', controller: 'can-talon-victor' })).toMatch(/SPARK MAX/);
    expect(motorControllerIssue({ motor: 'CIM', controller: 'can-sparkmax-brushless' })).toMatch(/brushed/);
    expect(motorControllerIssue({ motor: 'NeoVortex', controller: 'can-sparkmax-brushless' })).toMatch(/SPARK Flex/);
  });

  it('generates SPARK MAX + NEO and SPARK Flex + NEO Vortex code with fast encoder filtering', () => {
    for (const [controller, motor, cls, filter] of [
      ['can-sparkmax-brushless', 'NEO', 'SparkMax', 'uvwMeasurementPeriod(16).uvwAverageDepth(2)'],
      ['can-sparkflex', 'NeoVortex', 'SparkFlex', 'quadratureMeasurementPeriod(10).quadratureAverageDepth(2)'],
    ] as const) {
      const p = defaultProject();
      p.robot = { ...p.robot, ...DRIVETRAIN_PRESETS.find((x) => x.apply.controller === controller)!.apply, motor };
      const java = generateCode(p).find((f) => f.path.endsWith('KopDrivetrain.java'))!.content;
      expect(java).toContain(`import com.revrobotics.spark.${cls};`);
      expect(java).toContain(`new ${cls}(canId, MotorType.kBrushless)`);
      expect(java).toContain(`config.encoder.${filter};`);
      expect(java).toContain('leftEncoder.getVelocity() / 60.0');
      p.codegen.language = 'python';
      const py = generateCode(p).find((f) => f.path === 'kop/drive.py')!.content;
      expect(py).toContain(`rev.${cls}(i, motor_type)`);
      expect(py).toContain(`config.encoder.${filter}`);
    }
  });
});
