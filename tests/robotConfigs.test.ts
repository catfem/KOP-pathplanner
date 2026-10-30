import { describe, expect, it } from 'vitest';
import { defaultCodegen, defaultProject, defaultRobot } from '../src/model/defaults';
import {
  ROBOT_CONFIG_KIND,
  configFileName,
  normalizeCodegen,
  normalizeRobot,
  normalizeSavedConfigs,
  parseRobotConfig,
  sameSettings,
  toConfigFile,
} from '../src/model/robotConfigs';
import { applyRobotSettings, deleteRobotConfig, findRobotConfig, getState, saveRobotConfig, undo, updateProject } from '../src/model/store';

describe('robot settings validation', () => {
  it('keeps valid settings and resets bad ones to the defaults', () => {
    const base = defaultRobot();
    const robot = normalizeRobot({
      ...base,
      trackWidth: 0.61,
      kS: 1.2,
      invertLeft: true,
      motor: 'NEO',
      controller: 'can-sparkmax-brushless',
      leftIds: [5, 6],
      // Bad values:
      wheelDiameter: 0,
      kP: -3,
      kV: 'fast',
      maxVoltage: Number.NaN,
      encoder: 'laser',
      rightIds: [1, 'x'],
      leftEncoderPorts: [0, 1, 2],
      unknownKey: 42,
    });
    expect(robot.trackWidth).toBe(0.61);
    expect(robot.kS).toBe(1.2);
    expect(robot.invertLeft).toBe(true);
    expect(robot.motor).toBe('NEO');
    expect(robot.controller).toBe('can-sparkmax-brushless');
    expect(robot.leftIds).toEqual([5, 6]);
    expect(robot.wheelDiameter).toBe(base.wheelDiameter);
    expect(robot.kP).toBe(base.kP);
    expect(robot.kV).toBe(base.kV);
    expect(robot.maxVoltage).toBe(base.maxVoltage);
    expect(robot.encoder).toBe(base.encoder);
    expect(robot.rightIds).toEqual(base.rightIds);
    expect(robot.leftEncoderPorts).toEqual(base.leftEncoderPorts);
    expect(robot).not.toHaveProperty('unknownKey');
    expect(normalizeRobot({ wheelBalance: -0.012 }).wheelBalance).toBe(-0.012);
    expect(normalizeRobot({ wheelBalance: 0.35 }).wheelBalance).toBe(0.35);
    expect(normalizeRobot({ wheelBalance: -0.5 }).wheelBalance).toBe(-0.5);
    expect(normalizeRobot({ wheelBalance: 0.6 }).wheelBalance).toBe(0);
    expect(normalizeRobot(null)).toEqual(base);
  });

  it('checks the code generation options', () => {
    expect(normalizeCodegen({ language: 'python', javaPackage: 'frc.team1234.autos', sampleTime: 0.01, autoPeriod: 20 })).toEqual({
      language: 'python',
      javaPackage: 'frc.team1234.autos',
      sampleTime: 0.01,
      autoPeriod: 20,
    });
    expect(normalizeCodegen({ language: 'rust', javaPackage: 'frc.robot.my-autos', sampleTime: 0 })).toEqual(defaultCodegen());
  });

  it('compares settings regardless of key order', () => {
    const robot = defaultRobot();
    const reordered = Object.fromEntries(Object.entries(robot).reverse()) as typeof robot;
    expect(sameSettings({ robot, codegen: defaultCodegen() }, { robot: reordered, codegen: defaultCodegen() })).toBe(true);
    expect(sameSettings({ robot, codegen: defaultCodegen() }, { robot: { ...robot, kS: 2 }, codegen: defaultCodegen() })).toBe(false);
  });
});

describe('robot config files', () => {
  it('round-trips a saved config through a file', () => {
    const robot = { ...defaultRobot(), trackWidth: 0.63, kV: 2.7 };
    const codegen = { ...defaultCodegen(), language: 'python' as const };
    const file = toConfigFile({ id: 'x', name: 'Comp bot', savedAt: '2026-10-29T10:00:00.000Z', robot, codegen });
    expect(file.kind).toBe(ROBOT_CONFIG_KIND);
    const parsed = parseRobotConfig(JSON.parse(JSON.stringify(file)), 'comp-bot.robot.json');
    expect(parsed.name).toBe('Comp bot');
    expect(sameSettings(parsed, { robot, codegen })).toBe(true);
    expect(configFileName('Comp bot #2!')).toBe('comp-bot-2.robot.json');
    expect(configFileName('***')).toBe('robot.robot.json');
  });

  it('takes the robot settings from a project file', () => {
    const project = defaultProject();
    project.robot.kS = 1.4;
    const parsed = parseRobotConfig(JSON.parse(JSON.stringify(project)), 'practice.kop.json');
    expect(parsed.name).toBe('practice');
    expect(parsed.robot.kS).toBe(1.4);
  });

  it('rejects files that are not robot configs', () => {
    expect(() => parseRobotConfig([1, 2], 'list.json')).toThrow('list.json is not a robot config or project file.');
    expect(() => parseRobotConfig({ name: 'x', robot: {} }, 'loose.json')).toThrow('not a robot config or project file');
    expect(() => parseRobotConfig({ kind: ROBOT_CONFIG_KIND, name: 'x' }, 'empty.json')).toThrow();
  });

  it('drops unreadable entries from storage', () => {
    const list = normalizeSavedConfigs([{ name: 'Good', robot: { kS: 1 } }, { name: '  ' }, null, 'x', { robot: {} }]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Good');
    expect(list[0].robot.kS).toBe(1);
    expect(normalizeSavedConfigs({})).toEqual([]);
  });
});

describe('saved robot configs in the store', () => {
  it('saves, finds, overwrites, loads (undoably) and deletes', () => {
    const first = saveRobotConfig('Comp bot');
    expect(findRobotConfig('  comp BOT ')?.id).toBe(first.id);

    updateProject((p) => (p.robot.trackWidth = 0.66));
    const again = saveRobotConfig('comp bot');
    expect(again.id).toBe(first.id);
    expect(getState().configs).toHaveLength(1);
    expect(getState().configs[0].robot.trackWidth).toBe(0.66);

    saveRobotConfig('Practice bot', { robot: { ...defaultRobot(), trackWidth: 0.5 }, codegen: defaultCodegen() });
    expect(getState().configs.map((c) => c.name)).toEqual(['Comp bot', 'Practice bot']);

    applyRobotSettings(findRobotConfig('Practice bot')!);
    expect(getState().project.robot.trackWidth).toBe(0.5);
    undo();
    expect(getState().project.robot.trackWidth).toBe(0.66);

    deleteRobotConfig(first.id);
    expect(getState().configs.map((c) => c.name)).toEqual(['Practice bot']);
  });
});
