// Small global store (useSyncExternalStore) with undo/redo and autosave.

import { useSyncExternalStore } from 'react';
import { DEFAULT_SIM, type SimSettings } from '../planner/simulate';
import { defaultProject, newId } from './defaults';
import { presetElements } from './field';
import { type RobotSettings, type SavedRobotConfig, normalizeCodegen, normalizeRobot, normalizeSavedConfigs } from './robotConfigs';
import type { Auto, FieldConfig, Project, Waypoint } from './types';

export type Tool = 'select' | 'add';
export type InspectorTab = 'point' | 'auto' | 'robot' | 'field' | 'sim';
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface UiState {
  selectedAutoId: string;
  selectedIndex: number | null;
  tool: Tool;
  /** Style of points added with the Add tool. */
  newPointStyle: 'smooth' | 'stop';
  snap: boolean;
  /** Draw bumper distance guides (start pose to the walls, stops to the HUB). */
  showGuides: boolean;
  tab: InspectorTab;
  showSim: boolean;
  sim: SimSettings;
  codeOpen: boolean;
  helpOpen: boolean;
  /** Layout: side panels and the speed chart can be collapsed to give the field room. */
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  chartOpen: boolean;
  playing: boolean;
  time: number;
  speed: number;
  theme: ThemeChoice;
}

export type ToastLevel = 'info' | 'error';

export interface Toast {
  id: number;
  message: string;
  level: ToastLevel;
}

export interface State {
  project: Project;
  ui: UiState;
  past: Project[];
  future: Project[];
  fieldImage: string | null;
  toast: Toast | null;
  /** Saved robot configurations (browser storage, not part of the project or undo history). */
  configs: SavedRobotConfig[];
}

const PROJECT_KEY = 'kop-pathplanner:project';
const UI_KEY = 'kop-pathplanner:ui';
const IMAGE_KEY = 'kop-pathplanner:field-image';
const CONFIGS_KEY = 'kop-pathplanner:robot-configs';
const HISTORY_LIMIT = 100;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Fills in fields missing from older or hand-written project files. */
export function normalizeProject(raw: unknown): Project {
  const base = defaultProject();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Project>;
  const autos: Auto[] = Array.isArray(p.autos)
    ? p.autos.map((a, i) => ({
        id: typeof a.id === 'string' ? a.id : `auto_${i}`,
        name: typeof a.name === 'string' ? a.name : `Auto ${i + 1}`,
        waypoints: Array.isArray(a.waypoints) ? a.waypoints.map(normalizeWaypoint) : [],
      }))
    : base.autos;
  return {
    version: 1,
    robot: normalizeRobot(p.robot),
    field: normalizeField(p.field, base.field),
    autos: autos.length ? autos : base.autos,
    commands: Array.isArray(p.commands) ? p.commands.filter((c) => c && typeof c.name === 'string') : base.commands,
    codegen: normalizeCodegen(p.codegen),
  };
}

function normalizeField(raw: Partial<FieldConfig> | undefined, base: FieldConfig): FieldConfig {
  const field = { ...base, ...(raw ?? {}) };
  // Older projects have no elements: give the 2026 field its HUBs, BUMPs and TRENCHes.
  if (!Array.isArray(raw?.elements)) field.elements = presetElements(field.preset);
  field.elements = field.elements.filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.x) && Number.isFinite(e.y));
  field.elementsEnabled = raw?.elementsEnabled ?? true;
  return field;
}

function normalizeWaypoint(w: Partial<Waypoint>, i: number): Waypoint {
  const angle = typeof w.angleOut === 'number' ? w.angleOut : 0;
  return {
    id: typeof w.id === 'string' ? w.id : `wp_${i}_${Math.random().toString(36).slice(2, 7)}`,
    x: Number(w.x) || 0,
    y: Number(w.y) || 0,
    angleIn: typeof w.angleIn === 'number' ? w.angleIn : angle,
    angleOut: angle,
    lenIn: typeof w.lenIn === 'number' ? w.lenIn : 1,
    lenOut: typeof w.lenOut === 'number' ? w.lenOut : 1,
    stop: !!w.stop,
    reversed: !!w.reversed,
    facing: typeof w.facing === 'number' ? w.facing : null,
    aimAt: typeof w.aimAt === 'string' ? w.aimAt : null,
    actions: Array.isArray(w.actions) ? w.actions : [],
    markers: Array.isArray(w.markers) ? w.markers.filter((m) => typeof m === 'string') : [],
    maxVel: typeof w.maxVel === 'number' ? w.maxVel : null,
  };
}

/** Saved simulator settings, with anything that is not a sensible number reset to the default. */
export function normalizeSim(raw: unknown): SimSettings {
  const out = { ...DEFAULT_SIM };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_SIM) as (keyof SimSettings)[]) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 10) out[key] = v;
    }
  }
  return out;
}

function loadConfigs(): SavedRobotConfig[] {
  try {
    return normalizeSavedConfigs(JSON.parse(safeGet(CONFIGS_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function loadInitial(): State {
  let project: Project;
  const saved = safeGet(PROJECT_KEY);
  try {
    project = saved ? normalizeProject(JSON.parse(saved)) : defaultProject();
  } catch {
    project = defaultProject();
  }
  let savedUi: Partial<UiState> = {};
  try {
    savedUi = JSON.parse(safeGet(UI_KEY) ?? '{}');
  } catch {
    savedUi = {};
  }
  const selectedAutoId =
    savedUi.selectedAutoId && project.autos.some((a) => a.id === savedUi.selectedAutoId)
      ? savedUi.selectedAutoId
      : project.autos[0].id;
  return {
    project,
    ui: {
      selectedAutoId,
      selectedIndex: null,
      tool: 'select',
      newPointStyle: savedUi.newPointStyle === 'stop' ? 'stop' : 'smooth',
      snap: savedUi.snap ?? false,
      showGuides: savedUi.showGuides ?? true,
      tab: savedUi.tab ?? 'point',
      showSim: savedUi.showSim ?? true,
      sim: normalizeSim(savedUi.sim),
      codeOpen: false,
      helpOpen: !saved,
      sidebarOpen: savedUi.sidebarOpen ?? true,
      inspectorOpen: savedUi.inspectorOpen ?? true,
      chartOpen: savedUi.chartOpen ?? true,
      playing: false,
      time: 0,
      speed: 1,
      theme: savedUi.theme ?? 'system',
    },
    past: [],
    future: [],
    fieldImage: safeGet(IMAGE_KEY),
    toast: null,
    configs: loadConfigs(),
  };
}

let state: State = loadInitial();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastCoalesce: { key: string; at: number } | null = null;

function emit(): void {
  for (const l of listeners) l();
}

let saveFailed = false;

/** Writes the project and UI preferences to localStorage now. */
export function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const ok = safeSet(PROJECT_KEY, JSON.stringify(state.project));
  const { selectedAutoId, newPointStyle, snap, showGuides, tab, showSim, sim, theme, sidebarOpen, inspectorOpen, chartOpen } = state.ui;
  safeSet(
    UI_KEY,
    JSON.stringify({ selectedAutoId, newPointStyle, snap, showGuides, tab, showSim, sim, theme, sidebarOpen, inspectorOpen, chartOpen }),
  );
  if (!ok && !saveFailed) {
    showToast('Autosave failed: browser storage is full or blocked. Use Project → Save project file to keep your work.', 'error');
  }
  saveFailed = !ok;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}

// Never lose the last edits when the tab is closed or hidden.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  // Saved robot configs are shared by every tab of the app.
  window.addEventListener('storage', (e) => {
    if (e.key === CONFIGS_KEY) setState({ ...state, configs: loadConfigs() });
  });
}

export function getState(): State {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

function setState(next: State): void {
  state = next;
  emit();
}

export interface UpdateOptions {
  /** false: do not record an undo step (e.g. while dragging after a checkpoint). */
  history?: boolean;
  /** Consecutive updates with the same key within a second share one undo step. */
  coalesce?: string;
}

/** Applies a mutation to a copy of the project. */
export function updateProject(mutate: (p: Project) => void, options: UpdateOptions = {}): void {
  const draft = structuredClone(state.project);
  mutate(draft);
  let past = state.past;
  if (options.history !== false) {
    const now = Date.now();
    const merge = options.coalesce && lastCoalesce?.key === options.coalesce && now - lastCoalesce.at < 1000;
    if (!merge) past = [...past, state.project].slice(-HISTORY_LIMIT);
    lastCoalesce = options.coalesce ? { key: options.coalesce, at: now } : null;
  }
  setState({ ...state, project: draft, past, future: options.history === false ? state.future : [] });
  scheduleSave();
}

/** Records the current project as an undo step (call before a drag). */
export function checkpoint(): void {
  lastCoalesce = null;
  setState({ ...state, past: [...state.past, state.project].slice(-HISTORY_LIMIT), future: [] });
}

/** Drops back to the last checkpoint without leaving an undo/redo step (cancelled drag). */
export function revertCheckpoint(): void {
  if (!state.past.length) return;
  const prev = state.past[state.past.length - 1];
  lastCoalesce = null;
  setState({ ...state, project: prev, past: state.past.slice(0, -1) });
  fixSelection();
  scheduleSave();
}

export function undo(): void {
  if (!state.past.length) return;
  const prev = state.past[state.past.length - 1];
  setState({ ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] });
  fixSelection();
  scheduleSave();
}

export function redo(): void {
  if (!state.future.length) return;
  const [next, ...rest] = state.future;
  setState({ ...state, project: next, past: [...state.past, state.project], future: rest });
  fixSelection();
  scheduleSave();
}

function fixSelection(): void {
  const { project, ui } = state;
  let { selectedAutoId, selectedIndex } = ui;
  if (!project.autos.some((a) => a.id === selectedAutoId)) selectedAutoId = project.autos[0]?.id ?? '';
  const auto = project.autos.find((a) => a.id === selectedAutoId);
  if (selectedIndex !== null && (!auto || selectedIndex >= auto.waypoints.length)) selectedIndex = null;
  if (selectedAutoId !== ui.selectedAutoId || selectedIndex !== ui.selectedIndex) {
    setState({ ...state, ui: { ...ui, selectedAutoId, selectedIndex } });
  }
}

export function setUi(patch: Partial<UiState>): void {
  setState({ ...state, ui: { ...state.ui, ...patch } });
  if (
    'selectedAutoId' in patch ||
    'newPointStyle' in patch ||
    'snap' in patch ||
    'showGuides' in patch ||
    'tab' in patch ||
    'showSim' in patch ||
    'sim' in patch ||
    'theme' in patch ||
    'sidebarOpen' in patch ||
    'inspectorOpen' in patch ||
    'chartOpen' in patch
  ) {
    scheduleSave();
  }
}

export function replaceProject(project: Project): void {
  setState({
    ...state,
    project,
    past: [...state.past, state.project].slice(-HISTORY_LIMIT),
    future: [],
    ui: { ...state.ui, selectedAutoId: project.autos[0]?.id ?? '', selectedIndex: null, time: 0, playing: false },
  });
  scheduleSave();
}

function writeConfigs(configs: SavedRobotConfig[]): void {
  const sorted = [...configs].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  setState({ ...state, configs: sorted });
  if (!safeSet(CONFIGS_KEY, JSON.stringify(sorted))) {
    showToast('Could not store the robot configs: browser storage is full or blocked. Download the config as a file instead.', 'error');
  }
}

/** The saved config with this name (ignoring case and surrounding spaces), if any. */
export function findRobotConfig(name: string): SavedRobotConfig | undefined {
  const key = name.trim().toLowerCase();
  return state.configs.find((c) => c.name.toLowerCase() === key);
}

/** Saves robot settings under a name, replacing (and keeping the name of) a saved config with the same name. */
export function saveRobotConfig(name: string, settings: RobotSettings = state.project): SavedRobotConfig {
  const existing = findRobotConfig(name);
  const config: SavedRobotConfig = {
    id: existing?.id ?? newId('config'),
    name: existing?.name ?? name.trim(),
    savedAt: new Date().toISOString(),
    robot: structuredClone(settings.robot),
    codegen: structuredClone(settings.codegen),
  };
  writeConfigs([...state.configs.filter((c) => c.id !== config.id), config]);
  return config;
}

export function deleteRobotConfig(id: string): void {
  writeConfigs(state.configs.filter((c) => c.id !== id));
}

/** Puts robot settings into the project (one undo step). */
export function applyRobotSettings(settings: RobotSettings): void {
  updateProject((p) => {
    p.robot = structuredClone(settings.robot);
    p.codegen = structuredClone(settings.codegen);
  });
}

export function setFieldImage(dataUrl: string | null): boolean {
  setState({ ...state, fieldImage: dataUrl });
  return safeSet(IMAGE_KEY, dataUrl);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

/** Shows a short message; errors stay longer. */
export function showToast(message: string, level: ToastLevel = 'info'): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastId += 1;
  const id = toastId;
  setState({ ...state, toast: { id, message, level } });
  toastTimer = setTimeout(() => {
    if (state.toast?.id === id) setState({ ...state, toast: null });
  }, level === 'error' ? 8000 : 3500);
}

export function dismissToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  setState({ ...state, toast: null });
}

export function selectedAuto(s: State = state): Auto | undefined {
  return s.project.autos.find((a) => a.id === s.ui.selectedAutoId);
}

/** Mutates the selected auto (helper around updateProject). */
export function updateAuto(mutate: (a: Auto, p: Project) => void, options: UpdateOptions = {}): void {
  const id = state.ui.selectedAutoId;
  updateProject((p) => {
    const auto = p.autos.find((a) => a.id === id);
    if (auto) mutate(auto, p);
  }, options);
}
