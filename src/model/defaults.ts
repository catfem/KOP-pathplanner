import { presetElements } from './field';
import type { Auto, CodegenConfig, MotorType, Project, RobotConfig, Waypoint } from './types';

let idCounter = 0;
export function newId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface MotorSpec {
  label: string;
  freeSpeedRpm: number;
  stallTorque: number; // N*m
}

export const MOTORS: Record<MotorType, MotorSpec> = {
  CIM: { label: 'CIM', freeSpeedRpm: 5310, stallTorque: 2.41 },
  MiniCIM: { label: 'Mini CIM', freeSpeedRpm: 5840, stallTorque: 1.41 },
  NEO: { label: 'NEO', freeSpeedRpm: 5676, stallTorque: 2.6 },
  NeoVortex: { label: 'NEO Vortex', freeSpeedRpm: 6784, stallTorque: 3.6 },
  Falcon500: { label: 'Falcon 500', freeSpeedRpm: 6380, stallTorque: 4.69 },
  KrakenX60: { label: 'Kraken X60', freeSpeedRpm: 6000, stallTorque: 7.09 },
};

export const FIELD_PRESETS: { id: string; label: string; length: number; width: number }[] = [
  { id: 'frc2026', label: 'FRC 2026 (16.54 × 8.07 m)', length: 16.541, width: 8.069 },
  { id: 'frc2025', label: 'FRC 2025 (17.55 × 8.05 m)', length: 17.548, width: 8.052 },
  { id: 'frc2024', label: 'FRC 2024 (16.54 × 8.21 m)', length: 16.541, width: 8.211 },
  { id: 'custom', label: 'Custom size', length: 16.5, width: 8.0 },
];

export const INCH = 0.0254;

/** Typical AM14U (KOP) long configuration, 6" wheels, Toughbox Mini 10.71:1, 2 CIMs per side. */
export function defaultRobot(): RobotConfig {
  return {
    front: 'head',
    length: 0.98,
    width: 0.86,
    trackWidth: 0.56,
    wheelDiameter: 6 * INCH,
    wheelBalance: 0,
    gearRatio: 10.71,
    motor: 'CIM',
    motorsPerSide: 2,

    maxVelocity: 3.0,
    maxAcceleration: 2.0,
    maxCentripetal: 2.0,
    maxTurnRate: 180,
    maxTurnAccel: 360,
    bumpMaxVelocity: 1.0,
    fitsUnderTrench: true,

    kS: 0.9,
    kV: 3.0,
    kA: 0.5,
    kP: 12.0,
    kD: 1.0,
    kPTurn: 24.0,
    kLateral: 3.0,
    positionTolerance: 0.03,
    maxSettleTime: 1.0,
    maxVoltage: 12.0,

    controller: 'can-talon-victor',
    leftIds: [1, 2],
    rightIds: [3, 4],
    invertLeft: false,
    invertRight: true,
    brakeMode: true,
    currentLimit: 40,

    encoder: 'rio',
    encoderCPR: 360,
    encoderOnMotorShaft: false,
    leftEncoderPorts: [0, 1],
    rightEncoderPorts: [2, 3],
    invertLeftEncoder: false,
    invertRightEncoder: true,
  };
}

/** Theoretical free speed of the drivetrain in m/s. */
export function freeSpeed(robot: RobotConfig): number {
  const m = MOTORS[robot.motor];
  return ((m.freeSpeedRpm / 60) / robot.gearRatio) * Math.PI * robot.wheelDiameter;
}

/** Physics-based feedforward estimate for a robot of the given mass (kg). */
export function estimateFeedforward(robot: RobotConfig, massKg: number): { kV: number; kA: number } {
  const m = MOTORS[robot.motor];
  const kV = 12 / freeSpeed(robot);
  const r = robot.wheelDiameter / 2;
  // V = I*R with R = 12/I_stall and torque = kt*I -> per-side volts per m/s^2.
  const kA = (12 * massKg * r) / (2 * robot.motorsPerSide * m.stallTorque * robot.gearRatio);
  return { kV, kA };
}

export function makeWaypoint(x: number, y: number, angle: number, partial: Partial<Waypoint> = {}): Waypoint {
  return {
    id: newId('wp'),
    x,
    y,
    angleIn: angle,
    angleOut: angle,
    lenIn: 1,
    lenOut: 1,
    stop: false,
    reversed: false,
    facing: null,
    aimAt: null,
    actions: [],
    markers: [],
    maxVel: null,
    ...partial,
  };
}

/** Example autos laid out on the 2026 field (blue alliance). */
export function exampleAutos(): Auto[] {
  const twoPiece: Auto = {
    id: newId('auto'),
    name: 'Two Piece',
    waypoints: [
      // Start facing the HUB, shoot the preload, then drive over the BUMP to the neutral zone.
      makeWaypoint(2.6, 2.2, 0, {
        stop: true,
        lenOut: 1.2,
        aimAt: 'blue-hub',
        actions: [{ id: newId('act'), kind: 'command', name: 'Shoot' }],
      }),
      makeWaypoint(5.9, 2.5, 0, { lenIn: 1.0, lenOut: 0.8, markers: ['Intake'] }),
      makeWaypoint(7.6, 1.6, -20, {
        stop: true,
        reversed: true,
        angleOut: 160,
        lenIn: 0.8,
        lenOut: 1.2,
        actions: [{ id: newId('act'), kind: 'wait', seconds: 0.3 }],
      }),
      // Back over the BUMP, aim at the HUB and shoot.
      makeWaypoint(3.1, 2.7, 180, {
        stop: true,
        lenIn: 1.5,
        lenOut: 0.5,
        aimAt: 'blue-hub',
        actions: [{ id: newId('act'), kind: 'command', name: 'Shoot' }],
      }),
    ],
  };
  const square: Auto = {
    id: newId('auto'),
    name: 'Drive And Turn',
    waypoints: [
      makeWaypoint(1.3, 1.6, 0, { stop: true, lenIn: 0, lenOut: 0 }),
      makeWaypoint(3.2, 1.6, 0, { stop: true, angleOut: 90, lenIn: 0, lenOut: 0 }),
      makeWaypoint(3.2, 3.4, 90, {
        stop: true,
        angleOut: 180,
        lenIn: 0,
        lenOut: 0,
        aimAt: 'blue-hub',
        actions: [{ id: newId('act'), kind: 'command', name: 'Score' }],
      }),
      makeWaypoint(1.6, 3.4, 180, { stop: true, lenIn: 0, lenOut: 0 }),
    ],
  };
  return [twoPiece, square];
}

export function defaultCodegen(): CodegenConfig {
  return { language: 'java', javaPackage: 'frc.robot.kop', sampleTime: 0.02, autoPeriod: 15 };
}

export function defaultProject(): Project {
  const preset = FIELD_PRESETS[0];
  return {
    version: 1,
    robot: defaultRobot(),
    field: {
      preset: preset.id,
      length: preset.length,
      width: preset.width,
      elements: presetElements(preset.id),
      elementsEnabled: true,
    },
    autos: exampleAutos(),
    commands: [
      { name: 'Shoot', duration: 1.0 },
      { name: 'Intake', duration: 0.5 },
      { name: 'Score', duration: 0.8 },
    ],
    codegen: defaultCodegen(),
  };
}
