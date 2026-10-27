// Language-neutral description of the generated autos, shared by the Java and
// Python generators.

import type { Auto, Project } from '../model/types';
import { type Plan, type TrajState, planAuto } from '../planner/trajectory';

export interface GeneratedFile {
  /** Path relative to the robot project root, e.g. src/main/java/frc/robot/kop/KopAutos.java */
  path: string;
  content: string;
}

export type IRStep =
  | { kind: 'start'; x: number; y: number; heading: number }
  | { kind: 'command'; name: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'turn'; data: string; degrees: number; duration: number; target?: string }
  | {
      kind: 'drive';
      data: string;
      distance: number;
      duration: number;
      reversed: boolean;
      from: number;
      to: number;
      markers: { time: number; name: string }[];
    };

export interface IRTrajectory {
  name: string;
  samples: TrajState[];
}

export interface IRAuto {
  name: string;
  /** Words of the auto name, used to build identifiers in each language. */
  words: string[];
  plan: Plan;
  steps: IRStep[];
  trajectories: IRTrajectory[];
  commands: string[];
}

export function nameWords(name: string): string[] {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return words.length ? words : ['auto'];
}

export function camelCase(words: string[]): string {
  const id = words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
  return /^[0-9]/.test(id) ? `auto${id[0].toUpperCase()}${id.slice(1)}` : id;
}

export function pascalCase(words: string[]): string {
  const id = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(id) ? `Auto${id}` : id;
}

export function snakeCase(words: string[]): string {
  const id = words.join('_');
  return /^[0-9]/.test(id) ? `auto_${id}` : id;
}

/** Adds a suffix to identifiers that clash with keywords or generated helpers. */
export function avoidReserved(id: string, reserved: Set<string>, suffix: string): string {
  return reserved.has(id.toLowerCase()) ? `${id}${suffix}` : id;
}

/** Makes identifiers unique by appending a counter. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    return count === 0 ? n : `${n}${count + 1}`;
  });
}

/** Formats a number compactly with at most `decimals` decimals. */
export function num(v: number, decimals = 3): string {
  if (!Number.isFinite(v)) return '0';
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** Same as num() but always keeps a decimal point (for Java/Python float literals). */
export function float(v: number, decimals = 4): string {
  const s = num(v, decimals);
  return s.includes('.') ? s : `${s}.0`;
}

/** Columns: t, x, y, heading, lPos, lVel, lAcc, rPos, rVel, rAcc. */
export const TRAJ_COLUMNS = ['t', 'x', 'y', 'heading', 'lPos', 'lVel', 'lAcc', 'rPos', 'rVel', 'rAcc'] as const;
const COLUMN_DECIMALS = [3, 3, 3, 4, 4, 3, 2, 4, 3, 2];

export function sampleRow(s: TrajState): number[] {
  return [s.t, s.x, s.y, s.heading, s.lPos, s.lVel, s.lAcc, s.rPos, s.rVel, s.rAcc];
}

export function formatRow(s: TrajState): string[] {
  return sampleRow(s).map((v, i) => num(v, COLUMN_DECIMALS[i]));
}

/** Encodes samples as "v,v,...;v,v,...;" split into chunks of at most maxChunk characters. */
export function encodeSamples(samples: TrajState[], maxChunk = 20000): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const s of samples) {
    const row = `${formatRow(s).join(',')};`;
    if (current.length + row.length > maxChunk && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += row;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildIR(auto: Auto, project: Project, plan?: Plan): IRAuto {
  const p =
    plan ??
    planAuto(auto, project.robot, {
      sampleTime: project.codegen.sampleTime,
      commands: project.commands,
      autoPeriod: project.codegen.autoPeriod,
      field: project.field,
    });
  const steps: IRStep[] = [{ kind: 'start', x: p.startPose.x, y: p.startPose.y, heading: p.startPose.heading }];
  const trajectories: IRTrajectory[] = [];
  const commands = new Set<string>();
  let drives = 0;
  let turns = 0;
  for (const st of p.steps) {
    switch (st.kind) {
      case 'command':
        steps.push({ kind: 'command', name: st.name });
        commands.add(st.name);
        break;
      case 'wait':
        steps.push({ kind: 'wait', seconds: st.duration });
        break;
      case 'turn': {
        turns += 1;
        const name = `TURN_${turns}`;
        trajectories.push({ name, samples: st.samples });
        steps.push({
          kind: 'turn',
          data: name,
          degrees: ((st.toHeading - st.fromHeading) * 180) / Math.PI,
          duration: st.duration,
          target: st.target,
        });
        break;
      }
      case 'drive': {
        drives += 1;
        const name = `DRIVE_${drives}`;
        trajectories.push({ name, samples: st.samples });
        st.markers.forEach((m) => commands.add(m.name));
        steps.push({
          kind: 'drive',
          data: name,
          distance: st.distance,
          duration: st.duration,
          reversed: st.reversed,
          from: st.waypointIndex,
          to: st.toIndex,
          markers: st.markers.map((m) => ({ time: m.time, name: m.name })),
        });
        break;
      }
    }
  }
  return { name: auto.name, words: nameWords(auto.name), plan: p, steps, trajectories, commands: [...commands] };
}

export function headerComment(project: Project): string[] {
  const r = project.robot;
  return [
    'Generated by KOP Path Planner - https://github.com/catfem/KOP-pathplanner',
    `Drive: ${r.motorsPerSide} motor(s)/side, ${r.gearRatio}:1, ${num(r.wheelDiameter / 0.0254, 2)}" wheels, track width ${num(r.trackWidth, 3)} m.`,
    `Mode: ${r.encoder === 'none' ? 'open loop (time based, no sensors)' : 'encoder feedback'}, no gyro required.`,
  ];
}

/** Makes text safe to place inside a comment (block comment terminators, newlines). */
export function commentSafe(s: string): string {
  return s.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
}

/** Escapes a string for use inside a double-quoted Java/Python literal. */
export function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function describeStep(step: IRStep): string {
  switch (step.kind) {
    case 'start':
      return `Start at (${num(step.x, 2)}, ${num(step.y, 2)}) facing ${num((step.heading * 180) / Math.PI, 1)} deg`;
    case 'command':
      return `Run "${step.name}"`;
    case 'wait':
      return `Wait ${num(step.seconds, 2)} s`;
    case 'turn':
      return `Turn ${step.degrees > 0 ? 'left' : 'right'} ${num(Math.abs(step.degrees), 1)} deg in place${
        step.target ? ` to face the ${step.target}` : ''
      } (${num(step.duration, 2)} s)`;
    case 'drive':
      return `Drive${step.reversed ? ' backwards' : ''} from point ${step.from + 1} to ${step.to + 1}: ${num(step.distance, 2)} m in ${num(step.duration, 2)} s`;
  }
}
