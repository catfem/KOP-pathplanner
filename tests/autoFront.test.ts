import { describe, expect, it } from 'vitest';
import { buildIR } from '../src/codegen/common';
import { generateCode } from '../src/codegen';
import { toAutoFile, importAutoFiles } from '../src/model/autoFiles';
import { defaultProject, defaultRobot } from '../src/model/defaults';
import { autoFront, withFront } from '../src/model/hardware';
import { normalizeProject } from '../src/model/store';
import type { RobotConfig } from '../src/model/types';
import { PERFECT_SIM, simulateOtherEnd, simulatePlan } from '../src/planner/simulate';
import { otherEndSamples, planAuto } from '../src/planner/trajectory';

const robot: RobotConfig = { ...defaultRobot(), wheelBalance: 0.01 };
const project = () => {
  const p = defaultProject();
  p.robot = robot;
  return p;
};

describe('a single auto led by the other end', () => {
  it('turns the samples around without changing the motion', () => {
    const plan = planAuto(project().autos[0], robot);
    const drive = plan.steps.find((s) => s.kind === 'drive');
    if (!drive || drive.kind !== 'drive') throw new Error('expected a drive');
    const flipped = otherEndSamples(drive.samples);
    const half = robot.trackWidth / 2;
    for (const [a, b] of drive.samples.map((s, i) => [s, flipped[i]] as const)) {
      expect(b.x).toBe(a.x);
      expect(b.y).toBe(a.y);
      expect(b.heading).toBeCloseTo(a.heading + Math.PI, 12);
      expect(b.omega).toBe(a.omega);
      // Still a tank drive: each wheel is the center speed minus/plus the turn.
      expect(b.lVel).toBeCloseTo(b.v - b.omega * half, 6);
      expect(b.rVel).toBeCloseTo(b.v + b.omega * half, 6);
    }
    const twice = otherEndSamples(flipped);
    expect(twice.map((s) => [s.lPos, s.rVel, s.v])).toEqual(drive.samples.map((s) => [s.lPos, s.rVel, s.v]));
  });

  it('drives exactly like a robot wired with that end as its front', () => {
    // The code drives the auto backwards with the sides swapped. That must be the same motion as a
    // robot whose wiring (and wheel balance) has the intake as its front, on any imperfect robot.
    const p = project();
    const plan = planAuto(p.autos[0], robot);
    const settings = { ...PERFECT_SIM, leftScale: 0.85, kSScale: 1.2, trackScale: 1.1 };
    const asDriven = simulateOtherEnd(plan, robot, settings);
    // The same physical robot seen from the intake: its weak left side is on the auto's right.
    const mirrored = { ...settings, leftScale: settings.rightScale, rightScale: settings.leftScale };
    const asWired = simulatePlan(plan, withFront(robot, 'intake'), mirrored);
    const end = asDriven.trace[asDriven.trace.length - 1];
    const wired = asWired.trace[asWired.trace.length - 1];
    expect(end.x).toBeCloseTo(wired.x, 6);
    expect(end.y).toBeCloseTo(wired.y, 6);
    expect(end.heading).toBeCloseTo(wired.heading, 6);
    expect(asDriven.totalTime).toBeCloseTo(asWired.totalTime, 6);
    // And it still follows the plan.
    expect(asDriven.positionError).toBeLessThan(0.08);
    const perfect = simulateOtherEnd(plan, { ...robot, wheelBalance: 0 }, PERFECT_SIM);
    expect(perfect.positionError).toBeLessThan(0.01);
    expect(perfect.trace[perfect.trace.length - 1].heading).toBeCloseTo(plan.endPose.heading, 1);
  });

  it('generates the auto turned around, and only that auto', () => {
    const p = project();
    p.autos[0].front = 'intake';
    const flipped = buildIR(p.autos[0], p);
    const normal = buildIR({ ...p.autos[0], front: null }, p);
    expect(flipped.otherEnd).toBe(true);
    expect(flipped.front).toBe('intake');
    const [start] = flipped.steps;
    const [normalStart] = normal.steps;
    if (start.kind !== 'start' || normalStart.kind !== 'start') throw new Error('expected a start');
    expect(start.heading).toBeCloseTo(normalStart.heading + Math.PI, 12);
    expect(flipped.trajectories[0].samples).toEqual(otherEndSamples(normal.trajectories[0].samples));
    expect(buildIR(p.autos[1], p).otherEnd).toBe(false);
    // Same as the robot's front: nothing changes.
    expect(buildIR({ ...p.autos[0], front: 'head' }, p).trajectories).toEqual(normal.trajectories);

    for (const language of ['java', 'python'] as const) {
      p.codegen.language = language;
      const autos = generateCode(p).find((f) => /KopAutos\.java|autos\.py$/.test(f.path))!.content;
      expect(autos).toContain("Leads with the intake end (the robot's front is the head end)");
      expect(autos.match(/Leads with the/g)).toHaveLength(1);
    }
  });

  it('follows the robot unless the auto sets its own front, and keeps it in files', () => {
    const p = project();
    expect(autoFront(p.autos[0], p.robot)).toBe('head');
    expect(autoFront({ front: 'intake' }, p.robot)).toBe('intake');
    expect(autoFront({ front: null }, withFront(p.robot, 'intake'))).toBe('intake');

    p.autos[0].front = 'intake';
    const loaded = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.autos[0].front).toBe('intake');
    expect(loaded.autos[1].front).toBeUndefined();
    expect(normalizeProject({ autos: [{ name: 'A', waypoints: [{ x: 1, y: 1 }], front: 'tail' }] }).autos[0].front).toBeUndefined();

    const file = JSON.parse(JSON.stringify(toAutoFile(p.autos[0], p)));
    expect(importAutoFiles([{ name: 'a.auto.json', data: file }], p).autos[0].front).toBe('intake');
  });
});
