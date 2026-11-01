// Single autos as files: export one (or all of them) to move to another project or laptop, or
// to share with the team, and import them back. An auto file carries the named commands the auto
// uses, so they come along, and the field it was drawn on, so a different field can be flagged.

import { duplicateAuto, uniqueAutoName } from './edit';
import { normalizeWaypoint } from './store';
import type { Auto, NamedCommand, Project } from './types';

export const AUTO_FILE_KIND = 'kop-auto';

export interface AutoFile {
  kind: typeof AUTO_FILE_KIND;
  version: 1;
  name: string;
  exportedAt: string;
  /** The field the auto was drawn on. */
  field: { preset: string; length: number; width: number };
  /** The named commands the auto uses, with their preview durations. */
  commands: NamedCommand[];
  auto: Auto;
}

export interface AutoImport {
  /** Ready to add: fresh ids and names that do not clash with the project or each other. */
  autos: Auto[];
  /** Named commands the imported autos use that the project does not have yet. */
  commands: NamedCommand[];
  /** Things to check, in plain words. */
  warnings: string[];
}

/** Names of the named commands an auto runs (actions and markers), in order of first use. */
export function commandsUsed(auto: Auto): string[] {
  const names: string[] = [];
  for (const w of auto.waypoints) {
    for (const a of w.actions) if (a.kind === 'command' && !names.includes(a.name)) names.push(a.name);
    for (const m of w.markers) if (!names.includes(m)) names.push(m);
  }
  return names;
}

export function toAutoFile(auto: Auto, project: Project, now = new Date()): AutoFile {
  const used = commandsUsed(auto);
  return {
    kind: AUTO_FILE_KIND,
    version: 1,
    name: auto.name,
    exportedAt: now.toISOString(),
    field: { preset: project.field.preset, length: project.field.length, width: project.field.width },
    commands: used.map((name) => project.commands.find((c) => c.name === name) ?? { name, duration: 0.5 }),
    auto: structuredClone(auto),
  };
}

/** File name for an exported auto, e.g. "Two Piece" -> "two-piece.auto.json". */
export function autoFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'auto'}.auto.json`;
}

/** One auto file per auto, with distinct file names, for a zip of all the autos. */
export function allAutoFiles(project: Project, now = new Date()): { path: string; content: string }[] {
  const used = new Set<string>();
  return project.autos.map((auto) => {
    const base = autoFileName(auto.name).replace(/\.auto\.json$/, '');
    let path = `${base}.auto.json`;
    for (let i = 2; used.has(path); i++) path = `${base}-${i}.auto.json`;
    used.add(path);
    return { path, content: JSON.stringify(toAutoFile(auto, project, now), null, 2) };
  });
}

interface FileAutos {
  autos: unknown[];
  commands: unknown[];
  field: { length?: unknown; width?: unknown } | null;
}

/** The autos in an auto file or a project file, or null when the file is neither. */
function readAutos(raw: unknown): FileAutos | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const field = src.field && typeof src.field === 'object' ? (src.field as FileAutos['field']) : null;
  const commands = Array.isArray(src.commands) ? src.commands : [];
  if (src.kind === AUTO_FILE_KIND && src.auto && typeof src.auto === 'object') return { autos: [src.auto], commands, field };
  if (Array.isArray(src.autos)) return { autos: src.autos, commands, field };
  return null;
}

function toAuto(raw: unknown): Auto | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Partial<Auto>;
  if (!Array.isArray(src.waypoints) || src.waypoints.length === 0) return null;
  return {
    id: '',
    name: typeof src.name === 'string' && src.name.trim() ? src.name.trim() : 'Imported auto',
    waypoints: src.waypoints.map((w, i) => normalizeWaypoint(w && typeof w === 'object' ? w : {}, i)),
    ...(src.front === 'head' || src.front === 'intake' ? { front: src.front } : {}),
  };
}

function toCommand(raw: unknown): NamedCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<NamedCommand>;
  if (typeof c.name !== 'string' || !c.name.trim()) return null;
  const duration = typeof c.duration === 'number' && Number.isFinite(c.duration) && c.duration >= 0 ? c.duration : 0.5;
  return { name: c.name, duration };
}

/**
 * Autos from auto files or project files (every auto of a project), ready to add to `project`.
 * A file that holds no autos is reported in the warnings; throws when no file had any.
 */
export function importAutoFiles(files: { name: string; data: unknown }[], project: Project): AutoImport {
  const names = project.autos.map((a) => a.name);
  const known = new Set(project.commands.map((c) => c.name));
  const elements = new Set(project.field.elements.map((e) => e.id));
  const out: AutoImport = { autos: [], commands: [], warnings: [] };
  const unreadable: string[] = [];
  for (const file of files) {
    const content = readAutos(file.data);
    const autos = (content?.autos ?? []).map(toAuto).filter((a): a is Auto => a !== null);
    if (autos.length === 0) {
      unreadable.push(file.name);
      continue;
    }
    const length = Number(content?.field?.length);
    const width = Number(content?.field?.width);
    if (
      Number.isFinite(length) &&
      Number.isFinite(width) &&
      (Math.abs(length - project.field.length) > 0.05 || Math.abs(width - project.field.width) > 0.05)
    ) {
      out.warnings.push(
        `${file.name} was drawn on a ${length.toFixed(2)} × ${width.toFixed(2)} m field; this one is ${project.field.length.toFixed(2)} × ${project.field.width.toFixed(2)} m. Check the points.`,
      );
    }
    const durations = new Map(
      (content?.commands ?? [])
        .map(toCommand)
        .filter((c): c is NamedCommand => c !== null)
        .map((c) => [c.name, c.duration]),
    );
    for (const auto of autos) {
      const name = uniqueAutoName(names, auto.name);
      names.push(name);
      const copy = duplicateAuto(auto, name);
      out.autos.push(copy);
      if (name !== auto.name) out.warnings.push(`“${auto.name}” is already in this project: imported as “${name}”.`);
      for (const command of commandsUsed(copy)) {
        if (known.has(command)) continue;
        known.add(command);
        out.commands.push({ name: command, duration: durations.get(command) ?? 0.5 });
      }
      const missing = [...new Set(copy.waypoints.map((w) => w.aimAt).filter((id): id is string => !!id && !elements.has(id)))];
      if (missing.length) out.warnings.push(`“${name}” aims at ${missing.join(', ')}, which this field does not have: the planner ignores that aim.`);
    }
  }
  if (out.autos.length === 0) {
    throw new Error(`${unreadable.join(', ') || 'The file'} ${unreadable.length > 1 ? 'have' : 'has'} no autos: pick an auto file (.auto.json) or a project file.`);
  }
  for (const name of unreadable) out.warnings.push(`${name} has no autos, skipped.`);
  return out;
}
