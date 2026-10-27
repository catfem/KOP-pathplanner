import { describe, expect, it } from 'vitest';
import { defaultProject, defaultRobot, exampleAutos, makeWaypoint } from '../src/model/defaults';
import { rebuilt2026Elements } from '../src/model/field';
import type { Auto, RobotConfig } from '../src/model/types';
import { DEG } from '../src/planner/geometry';
import { simulatePlan } from '../src/planner/simulate';
import { type Plan, planAuto, sampleAt } from '../src/planner/trajectory';

const robot: RobotConfig = defaultRobot();

function auto(...wps: ReturnType<typeof makeWaypoint>[]): Auto {
  return { id: 'a', name: 'Test', waypoints: wps };
}

/** Re-integrates the wheel profiles with differential-drive kinematics. */
function integrateWheels(plan: Plan, r: RobotConfig) {
  let { x, y, heading } = plan.startPose;
  for (const st of plan.steps) {
    if (st.kind !== 'drive' && st.kind !== 'turn') continue;
    for (let i = 1; i < st.samples.length; i++) {
      const a = st.samples[i - 1];
      const b = st.samples[i];
      const dl = b.lPos - a.lPos;
      const dr = b.rPos - a.rPos;
      const dTheta = (dr - dl) / r.trackWidth;
      const d = (dl + dr) / 2;
      x += d * Math.cos(heading + dTheta / 2);
      y += d * Math.sin(heading + dTheta / 2);
      heading += dTheta;
    }
  }
  return { x, y, heading };
}

describe('planAuto', () => {
  it('drives a straight line within limits', () => {
    const plan = planAuto(
      auto(makeWaypoint(1, 1, 0, { stop: true, lenOut: 0 }), makeWaypoint(4, 1, 0, { stop: true, lenIn: 0 })),
      robot,
    );
    expect(plan.steps).toHaveLength(1);
    const drive = plan.steps[0];
    if (drive.kind !== 'drive') throw new Error('expected drive');
    expect(drive.distance).toBeCloseTo(3, 3);
    const last = drive.samples[drive.samples.length - 1];
    expect(last.lPos).toBeCloseTo(3, 3);
    expect(last.rPos).toBeCloseTo(3, 3);
    expect(last.v).toBe(0);
    for (const s of drive.samples) {
      expect(Math.abs(s.v)).toBeLessThanOrEqual(robot.maxVelocity + 1e-6);
      expect(Math.abs(s.lAcc)).toBeLessThanOrEqual(robot.maxAcceleration + 0.05);
    }
    // 3 m with v=3, a=2 never reaches max speed: triangular profile, t = 2*sqrt(2*1.5/2).
    expect(plan.totalTime).toBeCloseTo(2 * Math.sqrt(1.5), 1);
  });

  it('drives backwards when reversed', () => {
    const plan = planAuto(
      auto(
        makeWaypoint(4, 1, 180, { stop: true, reversed: true, lenOut: 0 }),
        makeWaypoint(2, 1, 180, { stop: true, lenIn: 0 }),
      ),
      robot,
    );
    const drive = plan.steps[0];
    if (drive.kind !== 'drive') throw new Error('expected drive');
    expect(plan.startPose.heading).toBeCloseTo(0, 6);
    const last = drive.samples[drive.samples.length - 1];
    expect(last.lPos).toBeCloseTo(-2, 3);
    expect(last.rPos).toBeCloseTo(-2, 3);
    expect(Math.min(...drive.samples.map((s) => s.v))).toBeLessThan(0);
  });

  it('turns in place at a corner stop', () => {
    const plan = planAuto(
      auto(
        makeWaypoint(1, 1, 0, { stop: true, lenOut: 0 }),
        makeWaypoint(3, 1, 0, { stop: true, angleOut: 90, lenIn: 0, lenOut: 0 }),
        makeWaypoint(3, 3, 90, { stop: true, lenIn: 0 }),
      ),
      robot,
    );
    expect(plan.steps.map((s) => s.kind)).toEqual(['drive', 'turn', 'drive']);
    const turn = plan.steps[1];
    if (turn.kind !== 'turn') throw new Error('expected turn');
    const last = turn.samples[turn.samples.length - 1];
    expect(last.rPos).toBeCloseTo((Math.PI / 2) * (robot.trackWidth / 2), 4);
    expect(last.lPos).toBeCloseTo(-(Math.PI / 2) * (robot.trackWidth / 2), 4);
    expect(plan.endPose.heading).toBeCloseTo(Math.PI / 2, 4);
  });

  it('wheel profiles alone reproduce curved paths (no gyro needed)', () => {
    for (const a of exampleAutos()) {
      const plan = planAuto(a, robot);
      const end = integrateWheels(plan, robot);
      expect(Math.hypot(end.x - plan.endPose.x, end.y - plan.endPose.y)).toBeLessThan(0.02);
      expect(Math.abs(end.heading - plan.endPose.heading)).toBeLessThan(1 * DEG);
      const lastWp = a.waypoints[a.waypoints.length - 1];
      expect(Math.hypot(plan.endPose.x - lastWp.x, plan.endPose.y - lastWp.y)).toBeLessThan(0.01);
    }
  });

  it('places markers mid-segment at the time the robot passes the point', () => {
    const plan = planAuto(
      auto(
        makeWaypoint(1, 1, 0, { stop: true, lenOut: 1 }),
        makeWaypoint(3, 2, 30, { lenIn: 0.8, lenOut: 0.8, markers: ['Intake'] }),
        makeWaypoint(5, 2, 0, { stop: true, lenIn: 1 }),
      ),
      robot,
    );
    const drive = plan.steps[0];
    if (drive.kind !== 'drive') throw new Error('expected drive');
    const m = drive.markers[0];
    expect(m.time).toBeGreaterThan(0);
    expect(m.time).toBeLessThan(drive.duration);
    const at = drive.samples.reduce((best, s) => (Math.abs(s.t - m.time) < Math.abs(best.t - m.time) ? s : best));
    expect(Math.hypot(at.x - 3, at.y - 2)).toBeLessThan(0.1);
  });

  it('applies facing and actions at stop points', () => {
    const [twoPiece] = exampleAutos();
    const plan = planAuto(twoPiece, robot, {
      commands: [
        { name: 'Shoot', duration: 1 },
        { name: 'Intake', duration: 0.5 },
      ],
      field: defaultProject().field,
    });
    expect(plan.steps[0]).toMatchObject({ kind: 'command', name: 'Shoot' });
    expect(plan.steps.at(-1)).toMatchObject({ kind: 'command', name: 'Shoot' });
    // Both shots aim at the blue HUB.
    const hub = rebuilt2026Elements().find((e) => e.id === 'blue-hub')!;
    const aim = (x: number, y: number) => Math.atan2(hub.y - y, hub.x - x);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    expect(wrap(plan.startPose.heading - aim(2.6, 2.2))).toBeCloseTo(0, 6);
    expect(wrap(plan.endPose.heading - aim(3.1, 2.7))).toBeCloseTo(0, 3);
    const lastTurn = plan.steps.filter((s) => s.kind === 'turn').at(-1);
    expect(lastTurn).toMatchObject({ target: 'Blue HUB' });
    const firstDrive = plan.steps.find((s) => s.kind === 'drive');
    if (!firstDrive || firstDrive.kind !== 'drive') throw new Error('expected drive');
    expect(firstDrive.markers.map((m) => m.name)).toEqual(['Intake']);
    const reverse = plan.steps.filter((s) => s.kind === 'drive')[1];
    if (!reverse || reverse.kind !== 'drive') throw new Error('expected second drive');
    expect(reverse.reversed).toBe(true);
    expect(plan.warnings.filter((w) => w.level !== 'info')).toEqual([]);
  });

  it('slows down on BUMPs and reports HUB collisions', () => {
    const field = defaultProject().field;
    const bump = field.elements.find((e) => e.id === 'blue-bump-right')!;
    // Straight across the BUMP.
    const straight = () =>
      auto(makeWaypoint(2.5, bump.y, 0, { stop: true, lenOut: 0 }), makeWaypoint(7, bump.y, 0, { stop: true, lenIn: 0 }));
    const across = planAuto(straight(), robot, { field });
    const drive = across.steps[0];
    if (drive.kind !== 'drive') throw new Error('expected drive');
    const onBump = drive.samples.filter((s) => Math.abs(s.x - bump.x) < bump.sizeX / 2);
    expect(onBump.length).toBeGreaterThan(0);
    expect(Math.max(...onBump.map((s) => s.v))).toBeLessThanOrEqual(robot.bumpMaxVelocity + 1e-6);
    expect(Math.max(...drive.samples.map((s) => s.v))).toBeGreaterThan(robot.bumpMaxVelocity + 0.5);
    expect(across.warnings.some((w) => w.level === 'info' && w.message.includes('BUMP'))).toBe(true);
    // Without field elements there is no slowdown.
    const free = planAuto(straight(), robot, { field: { ...field, elementsEnabled: false } });
    expect(free.totalTime).toBeLessThan(across.totalTime);
    // Straight through the HUB.
    const hub = field.elements.find((e) => e.id === 'blue-hub')!;
    const crash = planAuto(
      auto(makeWaypoint(2.5, hub.y, 0, { stop: true, lenOut: 0 }), makeWaypoint(7, hub.y, 0, { stop: true, lenIn: 0 })),
      robot,
      { field },
    );
    expect(crash.warnings.some((w) => w.level === 'error' && w.message.includes('Blue HUB'))).toBe(true);
    // TRENCH only matters for tall robots.
    const trench = field.elements.find((e) => e.id === 'blue-trench-right')!;
    const under = auto(makeWaypoint(2.5, trench.y, 0, { stop: true, lenOut: 0 }), makeWaypoint(7, trench.y, 0, { stop: true, lenIn: 0 }));
    expect(planAuto(under, robot, { field }).warnings.some((w) => w.message.includes('TRENCH'))).toBe(false);
    expect(planAuto(under, { ...robot, fitsUnderTrench: false }, { field }).warnings.some((w) => w.message.includes('TRENCH'))).toBe(true);
  });

  it('ignores HUB aiming when the field has no such element', () => {
    const [twoPiece] = exampleAutos();
    const plan = planAuto(twoPiece, robot, { field: { length: 16.5, width: 8, elements: [], elementsEnabled: true } });
    expect(plan.warnings.some((w) => w.message.includes('not on this field'))).toBe(true);
  });

  it('respects per-segment speed limits and curvature limits', () => {
    const plan = planAuto(
      auto(
        makeWaypoint(1, 1, 0, { stop: true, lenOut: 2, maxVel: 1.0 }),
        makeWaypoint(6, 1, 0, { stop: true, lenIn: 2 }),
      ),
      robot,
    );
    const drive = plan.steps[0];
    if (drive.kind !== 'drive') throw new Error('expected drive');
    expect(Math.max(...drive.samples.map((s) => s.v))).toBeLessThanOrEqual(1.0 + 1e-6);
  });

  it('samples the timeline', () => {
    const plan = planAuto(exampleAutos()[1], robot);
    expect(sampleAt(plan, -1).label).toBe('Start');
    expect(sampleAt(plan, plan.totalTime + 1).label).toBe('Done');
    const mid = sampleAt(plan, plan.steps[0].duration / 2);
    expect(mid.label).toBe('Driving');
    expect(mid.v).toBeGreaterThan(0);
  });

  it('warns when the auto is too long', () => {
    const plan = planAuto(
      auto(
        makeWaypoint(1, 1, 0, {
          stop: true,
          actions: [{ id: 'w', kind: 'wait', seconds: 20 }],
        }),
        makeWaypoint(2, 1, 0, { stop: true }),
      ),
      robot,
    );
    expect(plan.warnings.some((w) => w.level === 'error')).toBe(true);
  });
});

describe('simulatePlan', () => {
  it('closed loop with a perfect model tracks the plan', () => {
    for (const a of exampleAutos()) {
      const plan = planAuto(a, robot);
      const sim = simulatePlan(plan, robot, { leftScale: 1, rightScale: 1, kSScale: 1, trackScale: 1 });
      expect(sim.closedLoop).toBe(true);
      expect(sim.positionError).toBeLessThan(0.04);
      expect(Math.abs(sim.headingErrorDeg)).toBeLessThan(1.5);
    }
  });

  it('open loop with a perfect model still ends close', () => {
    const plan = planAuto(exampleAutos()[0], robot);
    const sim = simulatePlan(plan, { ...robot, encoder: 'none' }, { leftScale: 1, rightScale: 1, kSScale: 1, trackScale: 1 });
    expect(sim.closedLoop).toBe(false);
    expect(sim.positionError).toBeLessThan(0.08);
  });

  it('encoders reduce drift from a mismatched drivetrain', () => {
    // All-forward auto, so open-loop drift is not undone by driving back over the same path.
    const plan = planAuto(exampleAutos()[1], robot);
    const settings = { leftScale: 0.9, rightScale: 1, kSScale: 1.2, trackScale: 1 };
    const open = simulatePlan(plan, { ...robot, encoder: 'none' }, settings);
    const closed = simulatePlan(plan, robot, settings);
    expect(closed.positionError).toBeLessThan(open.positionError);
    expect(closed.positionError).toBeLessThan(0.15);
  });
});
