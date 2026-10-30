// Saved robot configurations: the robot settings (drivetrain, gains, IDs,
// calibration) and code generation options, kept apart from the autos so a
// team can reuse them across projects and laptops.

import { MOTORS, defaultCodegen, defaultRobot } from './defaults';
import { CONTROLLERS, ENCODER_LABELS } from './hardware';
import type { CodegenConfig, RobotConfig } from './types';

export interface RobotSettings {
  robot: RobotConfig;
  codegen: CodegenConfig;
}

export interface SavedRobotConfig extends RobotSettings {
  id: string;
  name: string;
  /** ISO timestamp of the last save. */
  savedAt: string;
}

export const ROBOT_CONFIG_KIND = 'kop-robot-config';

/** What a downloaded robot config file holds. */
export interface RobotConfigFile extends RobotSettings {
  kind: typeof ROBOT_CONFIG_KIND;
  version: 1;
  name: string;
  savedAt: string;
}

/** Settings that must be above zero (sizes, ratios, limits); every other number must not be negative. */
const POSITIVE: (keyof RobotConfig)[] = [
  'length',
  'width',
  'trackWidth',
  'wheelDiameter',
  'gearRatio',
  'motorsPerSide',
  'maxVelocity',
  'maxAcceleration',
  'maxTurnRate',
  'maxTurnAccel',
  'maxVoltage',
  'encoderCPR',
];

/** Largest left/right wheel balance accepted, as a fraction. */
export const MAX_WHEEL_BALANCE = 0.2;

function isIdList(v: unknown, length?: number): v is number[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    (length === undefined || v.length === length) &&
    v.every((x) => Number.isInteger(x) && x >= 0)
  );
}

/** Robot settings from a file or storage: anything missing, of the wrong type or out of range is reset to the default. */
export function normalizeRobot(raw: unknown): RobotConfig {
  const out = defaultRobot();
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(out) as (keyof RobotConfig)[]) {
    const v = src[key];
    const fallback = out[key];
    if (key === 'wheelBalance') {
      // The one signed setting: a few percent either way.
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_WHEEL_BALANCE) target[key] = v;
    } else if (typeof fallback === 'number') {
      if (typeof v === 'number' && Number.isFinite(v) && (POSITIVE.includes(key) ? v > 0 : v >= 0)) target[key] = v;
    } else if (typeof fallback === 'boolean') {
      if (typeof v === 'boolean') target[key] = v;
    } else if (Array.isArray(fallback)) {
      if (isIdList(v, key === 'leftEncoderPorts' || key === 'rightEncoderPorts' ? 2 : undefined)) target[key] = [...v];
    }
  }
  if (typeof src.motor === 'string' && src.motor in MOTORS) out.motor = src.motor as RobotConfig['motor'];
  if (typeof src.controller === 'string' && src.controller in CONTROLLERS) out.controller = src.controller as RobotConfig['controller'];
  if (typeof src.encoder === 'string' && src.encoder in ENCODER_LABELS) out.encoder = src.encoder as RobotConfig['encoder'];
  if (src.front === 'head' || src.front === 'intake') out.front = src.front;
  out.motorsPerSide = Math.max(1, Math.round(out.motorsPerSide));
  return out;
}

/** Code generation options from a file or storage, with bad values reset to the default. */
export function normalizeCodegen(raw: unknown): CodegenConfig {
  const out = defaultCodegen();
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  if (src.language === 'java' || src.language === 'python') out.language = src.language;
  if (typeof src.javaPackage === 'string' && /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(src.javaPackage.trim())) {
    out.javaPackage = src.javaPackage.trim();
  }
  if (typeof src.sampleTime === 'number' && src.sampleTime >= 0.005 && src.sampleTime <= 0.1) out.sampleTime = src.sampleTime;
  if (typeof src.autoPeriod === 'number' && src.autoPeriod > 0 && src.autoPeriod <= 60) out.autoPeriod = src.autoPeriod;
  return out;
}

/** True when two sets of settings are the same (after normalizing, so key order does not matter). */
export function sameSettings(a: RobotSettings, b: RobotSettings): boolean {
  return (
    JSON.stringify(normalizeRobot(a.robot)) === JSON.stringify(normalizeRobot(b.robot)) &&
    JSON.stringify(normalizeCodegen(a.codegen)) === JSON.stringify(normalizeCodegen(b.codegen))
  );
}

export function toConfigFile(config: SavedRobotConfig): RobotConfigFile {
  return { kind: ROBOT_CONFIG_KIND, version: 1, name: config.name, savedAt: config.savedAt, robot: config.robot, codegen: config.codegen };
}

/** File name for a downloaded config, e.g. "Comp bot" -> "comp-bot.robot.json". */
export function configFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'robot'}.robot.json`;
}

/**
 * Reads the robot settings out of a robot config file, or out of a project file (its robot and
 * code generation settings). Throws when the file is neither.
 */
export function parseRobotConfig(raw: unknown, fileName: string): RobotSettings & { name: string } {
  const fallbackName = fileName.replace(/\.(robot|kop)?\.?json$/i, '') || 'Imported robot';
  const notConfig = new Error(`${fileName} is not a robot config or project file.`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw notConfig;
  const src = raw as Record<string, unknown>;
  const isConfig = src.kind === ROBOT_CONFIG_KIND;
  const isProject = Array.isArray(src.autos);
  if ((!isConfig && !isProject) || !src.robot || typeof src.robot !== 'object') throw notConfig;
  const name = isConfig && typeof src.name === 'string' && src.name.trim() ? src.name.trim() : fallbackName;
  return { name, robot: normalizeRobot(src.robot), codegen: normalizeCodegen(src.codegen) };
}

/** The saved configs list from storage, dropping anything unreadable. */
export function normalizeSavedConfigs(raw: unknown): SavedRobotConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof c.name === 'string' && c.name.trim() !== '')
    .map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `config_${i}`,
      name: (c.name as string).trim(),
      savedAt: typeof c.savedAt === 'string' ? c.savedAt : new Date(0).toISOString(),
      robot: normalizeRobot(c.robot),
      codegen: normalizeCodegen(c.codegen),
    }));
}

/** A short line describing the drivetrain, e.g. "2 CIM / side · roboRIO encoders · Java" (plus "intake first"). */
export function describeSettings({ robot, codegen }: RobotSettings): string {
  const encoders = robot.encoder === 'none' ? 'no encoders' : robot.encoder === 'rio' ? 'roboRIO encoders' : 'controller encoders';
  const front = robot.front === 'intake' ? ' · intake first' : '';
  return `${robot.motorsPerSide} ${MOTORS[robot.motor].label} / side · ${encoders}${front} · ${codegen.language === 'java' ? 'Java' : 'Python'}`;
}
