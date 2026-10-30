import { describe, expect, it } from 'vitest';
import { generateCode } from '../src/codegen';
import { camelCase, encodeSamples, nameWords, num, snakeCase } from '../src/codegen/common';
import { crc32, createZip } from '../src/codegen/zip';
import { defaultProject } from '../src/model/defaults';
import { importPathPlanner, insertWaypoint } from '../src/model/edit';
import { CONTROLLERS } from '../src/model/hardware';
import { normalizeProject } from '../src/model/store';
import type { ControllerType, EncoderType } from '../src/model/types';
import { planAuto, segmentBezier } from '../src/planner/trajectory';
import { bezierPoint } from '../src/planner/geometry';

describe('identifiers and formatting', () => {
  it('builds identifiers from auto names', () => {
    expect(camelCase(nameWords('Two Piece'))).toBe('twoPiece');
    expect(camelCase(nameWords('3 note-center!'))).toBe('auto3NoteCenter');
    expect(snakeCase(nameWords('Left Side Score'))).toBe('left_side_score');
    expect(camelCase(nameWords('  '))).toBe('auto');
  });

  it('formats numbers compactly', () => {
    expect(num(1.2)).toBe('1.2');
    expect(num(-0.0001)).toBe('0');
    expect(num(3)).toBe('3');
    expect(num(2.34567, 2)).toBe('2.35');
  });

  it('chunks encoded samples', () => {
    const plan = planAuto(defaultProject().autos[0], defaultProject().robot);
    const drive = plan.steps.find((s) => s.kind === 'drive');
    if (!drive || drive.kind !== 'drive') throw new Error('expected drive');
    const chunks = encodeSamples(drive.samples, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    const rows = chunks.join('').split(';').filter(Boolean);
    expect(rows).toHaveLength(drive.samples.length);
    expect(rows[0].split(',')).toHaveLength(10);
  });
});

describe('generateCode', () => {
  const controllers = Object.keys(CONTROLLERS) as ControllerType[];
  const encoders: EncoderType[] = ['none', 'rio', 'integrated'];

  it('generates Java for every hardware combination', () => {
    for (const controller of controllers) {
      for (const encoder of encoders) {
        const p = defaultProject();
        p.robot.controller = controller;
        p.robot.encoder = encoder;
        const files = generateCode(p);
        const paths = files.map((f) => f.path);
        expect(paths).toContain('src/main/java/frc/robot/kop/KopAutos.java');
        expect(paths).toContain('src/main/java/frc/robot/kop/KopDrivetrain.java');
        const drive = files.find((f) => f.path.endsWith('KopDrivetrain.java'))!.content;
        const usesEncoders = encoder === 'rio' || (encoder === 'integrated' && CONTROLLERS[controller].integratedEncoder);
        expect(drive).toContain(`return ${usesEncoders};`);
        const calibration = files.find((f) => f.path.endsWith('KopCalibration.java'))!.content;
        expect(calibration.includes('new MeasureFeedforward(drive)')).toBe(usesEncoders);
        const autos = files.find((f) => f.path.endsWith('KopAutos.java'))!.content;
        expect(autos).toMatch(/marker\(\d+\.\d+, "Intake"\)/);
        expect(autos).toContain('KopCalibration.addTo(chooser, drive);');
        // The follower applies the wheel balance (to encoder distances, or to the voltages without
        // encoders), so it works with any KopDrive; the drivetrain reports plain encoder readings.
        expect(drive).not.toContain('DistanceScale');
        const follower = files.find((f) => f.path.endsWith('FollowKopTrajectory.java'))!.content;
        expect(follower).toContain('kLeftDistanceScale * drive.getLeftDistanceMeters()');
        expect(follower).toContain('kRightDistanceScale * drive.getRightVelocityMetersPerSecond()');
        expect(follower).toContain('balanceByVoltage = !(kUseEncoders && drive.hasEncoders());');
        expect(follower).toContain('leftVolts /= mirrored ? kRightDistanceScale : kLeftDistanceScale;');
        expect(calibration).toContain('kLeftDistanceScale * drive.getLeftDistanceMeters()');
        // Balanced braces are a cheap syntax sanity check.
        for (const f of files.filter((x) => x.path.endsWith('.java'))) {
          const code = f.content.replace(/"""[\s\S]*?"""/g, '').replace(/"(?:\\.|[^"\\])*"/g, '');
          expect((code.match(/{/g) ?? []).length, f.path).toBe((code.match(/}/g) ?? []).length);
        }
      }
    }
  });

  it('generates Python with one function per auto', () => {
    const p = defaultProject();
    p.codegen.language = 'python';
    const files = generateCode(p);
    const autos = files.find((f) => f.path === 'kop/autos.py')!.content;
    expect(autos).toContain('def two_piece(drive, mirror=lambda: False)');
    expect(autos).toContain('def drive_and_turn(drive, mirror=lambda: False)');
    // Markers trigger on the follower's progress, not on wall time.
    expect(autos).toMatch(/auto_data\.TWO_PIECE_DRIVE_1,\n\s+\(\d+\.\d+, "Intake"\),/);
    expect(autos).toContain('follower.progress >= t');
    expect(autos).toContain('calibration.add_to(chooser, drive)');
    const calibration = files.find((f) => f.path === 'kop/calibration.py')!.content;
    expect(calibration).toContain('class MeasureFeedforward(commands2.Command):');
    const data = files.find((f) => f.path === 'kop/auto_data.py')!.content;
    expect(data).toContain('TWO_PIECE_DRIVE_1 = KopTrajectory(');
  });

  it('keeps generated identifiers unique and legal', () => {
    const p = defaultProject();
    p.autos[0].name = 'class';
    p.autos[1].name = 'Class';
    const java = generateCode(p).find((f) => f.path.endsWith('KopAutos.java'))!.content;
    expect(java).toContain('public static Command classAuto(KopDrive drive, BooleanSupplier mirror)');
    expect(java).toContain('public static Command classAuto2(KopDrive drive, BooleanSupplier mirror)');
    p.codegen.language = 'python';
    const py = generateCode(p).find((f) => f.path === 'kop/autos.py')!.content;
    expect(py).toContain('def class_auto(');
    expect(py).toContain('def class_auto2(');
  });

  it('escapes names in strings and comments', () => {
    const p = defaultProject();
    p.autos[0].name = 'Evil "*/ name';
    p.autos[0].waypoints[0].actions = [{ id: 'x', kind: 'command', name: 'Say "hi"' }];
    const java = generateCode(p).find((f) => f.path.endsWith('KopAutos.java'))!.content;
    expect(java).toContain('KopNamedCommands.get("Say \\"hi\\"")');
    expect(java).toContain('.withName("Evil \\"*/ name")');
    expect(java).not.toMatch(/\/\*\*[^\n]*Evil "\*\//);
  });
});

describe('zip', () => {
  it('computes CRC32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a valid archive layout', () => {
    const zip = createZip([
      { path: 'a.txt', content: 'hello' },
      { path: 'dir/b.txt', content: 'world!' },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const cdOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);
  });
});

describe('editing', () => {
  it('inserting a point keeps the path shape', () => {
    const p = defaultProject();
    const a = p.autos[0];
    const before = segmentBezier(a.waypoints[0], a.waypoints[1]);
    const probe = bezierPoint(before, 0.75);
    insertWaypoint(a, 0, 0.5);
    const after = segmentBezier(a.waypoints[1], a.waypoints[2]);
    const q = bezierPoint(after, 0.5);
    expect(Math.hypot(q.x - probe.x, q.y - probe.y)).toBeLessThan(1e-9);
  });

  it('imports PathPlanner paths', () => {
    const auto = importPathPlanner(
      {
        waypoints: [
          { anchor: { x: 1, y: 1 }, prevControl: null, nextControl: { x: 2, y: 1 } },
          { anchor: { x: 3, y: 2 }, prevControl: { x: 2.5, y: 1.5 }, nextControl: { x: 3.5, y: 2.5 } },
          { anchor: { x: 5, y: 2 }, prevControl: { x: 4, y: 2 }, nextControl: null },
        ],
        eventMarkers: [{ name: 'm', waypointRelativePos: 1.2, command: { type: 'named', data: { name: 'Intake' } } }],
        reversed: false,
        globalConstraints: { maxVelocity: 2.5 },
      },
      'Imported',
    );
    expect(auto.waypoints).toHaveLength(3);
    expect(auto.waypoints[1].stop).toBe(false);
    expect(auto.waypoints[1].angleOut).toBeCloseTo(45, 6);
    expect(auto.waypoints[1].markers).toEqual(['Intake']);
    expect(auto.waypoints[0].maxVel).toBe(2.5);
    expect(() => importPathPlanner({ foo: 1 }, 'x')).toThrow();
  });

  it('normalizes partial project files', () => {
    const p = normalizeProject({ autos: [{ name: 'A', waypoints: [{ x: 1, y: 2 }] }], robot: { kV: 2.5 } });
    expect(p.autos[0].waypoints[0]).toMatchObject({ x: 1, y: 2, stop: false, actions: [], markers: [] });
    expect(p.robot.kV).toBe(2.5);
    expect(p.robot.kS).toBe(defaultProject().robot.kS);
  });
});
