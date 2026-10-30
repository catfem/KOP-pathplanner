import { describe, expect, it } from 'vitest';
import { AUTO_FILE_KIND, allAutoFiles, autoFileName, commandsUsed, importAutoFiles, toAutoFile } from '../src/model/autoFiles';
import { defaultProject } from '../src/model/defaults';
import { planAuto } from '../src/planner/trajectory';

/** Waypoints without their ids, to compare an imported auto with the original. */
const shape = (auto: { waypoints: { id: string; actions: { id: string }[] }[] }) =>
  auto.waypoints.map(({ id: _id, actions, ...rest }) => ({ ...rest, actions: actions.map(({ id: _a, ...a }) => a) }));

describe('auto files', () => {
  const project = defaultProject();
  const twoPiece = project.autos[0];

  it('lists the named commands an auto uses', () => {
    expect(commandsUsed(twoPiece)).toEqual(['Shoot', 'Intake']);
  });

  it('exports an auto with its commands and field, and imports it back as a copy', () => {
    const file = toAutoFile(twoPiece, project, new Date('2026-10-30T12:00:00Z'));
    expect(file).toMatchObject({ kind: AUTO_FILE_KIND, version: 1, name: 'Two Piece', exportedAt: '2026-10-30T12:00:00.000Z' });
    expect(file.commands).toEqual([
      { name: 'Shoot', duration: 1 },
      { name: 'Intake', duration: 0.5 },
    ]);
    expect(file.field).toEqual({ preset: 'frc2026', length: 16.541, width: 8.069 });
    expect(autoFileName('Two Piece')).toBe('two-piece.auto.json');
    expect(autoFileName('!!!')).toBe('auto.auto.json');

    // Into a project that already has it: a renamed copy with fresh ids, nothing else to add.
    const data = JSON.parse(JSON.stringify(file));
    const result = importAutoFiles([{ name: 'two-piece.auto.json', data }], project);
    expect(result.autos).toHaveLength(1);
    const copy = result.autos[0];
    expect(copy.name).toBe('Two Piece 2');
    expect(copy.id).not.toBe(twoPiece.id);
    expect(copy.waypoints.map((w) => w.id).some((id) => twoPiece.waypoints.some((w) => w.id === id))).toBe(false);
    expect(shape(copy)).toEqual(shape(twoPiece));
    expect(result.commands).toEqual([]);
    expect(result.warnings.join(' ')).toContain('imported as “Two Piece 2”');
    // It plans exactly like the original.
    expect(planAuto(copy, project.robot).totalTime).toBeCloseTo(planAuto(twoPiece, project.robot).totalTime, 9);
  });

  it('brings the commands a project does not have, with their durations', () => {
    const empty = { ...defaultProject(), commands: [], autos: [] };
    const data = JSON.parse(JSON.stringify(toAutoFile(twoPiece, project)));
    data.commands = [{ name: 'Shoot', duration: 1.7 }];
    const result = importAutoFiles([{ name: 'a.auto.json', data }], empty);
    expect(result.autos[0].name).toBe('Two Piece');
    expect(result.commands).toEqual([
      { name: 'Shoot', duration: 1.7 },
      { name: 'Intake', duration: 0.5 },
    ]);
  });

  it('imports every auto of a project file and of several files, with distinct names', () => {
    const projectFile = JSON.parse(JSON.stringify(project));
    const autoFile = JSON.parse(JSON.stringify(toAutoFile(twoPiece, project)));
    const result = importAutoFiles(
      [
        { name: 'team.kop.json', data: projectFile },
        { name: 'two-piece.auto.json', data: autoFile },
      ],
      project,
    );
    expect(result.autos.map((a) => a.name)).toEqual(['Two Piece 2', 'Drive And Turn 2', 'Two Piece 3']);
  });

  it('warns about a different field and aims at elements that are not there', () => {
    const data = JSON.parse(JSON.stringify(toAutoFile(twoPiece, project)));
    data.field = { preset: 'frc2025', length: 17.548, width: 8.052 };
    const bare = { ...defaultProject(), autos: [] };
    bare.field = { ...bare.field, elements: [] };
    const result = importAutoFiles([{ name: 'old.auto.json', data }], bare);
    const text = result.warnings.join(' ');
    expect(text).toContain('17.55 × 8.05 m field');
    expect(text).toContain('aims at blue-hub');
  });

  it('cleans up broken content and rejects files without autos', () => {
    const data = {
      kind: AUTO_FILE_KIND,
      auto: {
        name: 'Odd',
        waypoints: [
          { x: 1, y: 1, stop: true, actions: [{ kind: 'command' }, { kind: 'wait', seconds: -1 }, { kind: 'wait', seconds: 0.2 }, 'x'] },
          { x: 2, y: 1, stop: true, markers: ['Intake', 3] },
        ],
      },
      commands: [{ name: 'Intake', duration: 'long' }],
    };
    const result = importAutoFiles([{ name: 'odd.auto.json', data }], { ...defaultProject(), commands: [], autos: [] });
    const [first, second] = result.autos[0].waypoints;
    expect(first.actions).toEqual([{ id: expect.any(String), kind: 'wait', seconds: 0.2 }]);
    expect(second.markers).toEqual(['Intake']);
    expect(result.commands).toEqual([{ name: 'Intake', duration: 0.5 }]);

    expect(() => importAutoFiles([{ name: 'robot.robot.json', data: { kind: 'kop-robot-config', robot: {} } }], project)).toThrow(
      'robot.robot.json has no autos',
    );
    // One good file among bad ones still imports, and the bad one is reported.
    const mixed = importAutoFiles(
      [
        { name: 'notes.json', data: null },
        { name: 'odd.auto.json', data },
      ],
      project,
    );
    expect(mixed.autos).toHaveLength(1);
    expect(mixed.warnings).toContain('notes.json has no autos, skipped.');
  });

  it('gives every auto its own file in the zip', () => {
    const p = defaultProject();
    p.autos.push({ ...structuredClone(p.autos[0]), id: 'dup', name: 'Two-Piece' });
    const files = allAutoFiles(p);
    expect(files.map((f) => f.path)).toEqual(['two-piece.auto.json', 'drive-and-turn.auto.json', 'two-piece-2.auto.json']);
    expect(JSON.parse(files[2].content).auto.name).toBe('Two-Piece');
  });
});
