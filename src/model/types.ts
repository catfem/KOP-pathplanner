// Core data model for KOP Path Planner projects.
//
// Coordinate system: WPILib field coordinates. Origin at the blue alliance
// wall corner, +x along the field length (towards red), +y to the left when
// standing behind the blue wall. Angles are in degrees in the model,
// counter-clockwise positive, 0 deg = +x.

export type Action =
  | { id: string; kind: 'command'; name: string }
  | { id: string; kind: 'wait'; seconds: number };

export interface Waypoint {
  id: string;
  x: number;
  y: number;
  /** Path tangent (direction of travel along the path) arriving at this point, deg. */
  angleIn: number;
  /** Path tangent leaving this point, deg. Equal to angleIn for smooth points. */
  angleOut: number;
  /** Bezier handle lengths in meters. 0 makes the adjacent segment end straight. */
  lenIn: number;
  lenOut: number;
  /**
   * Stop points bring the robot to rest. Only stop points may have a corner
   * (angleIn != angleOut, executed as a turn in place), actions, a facing
   * override, or change driving direction. First/last points are always stops.
   */
  stop: boolean;
  /** Drive backwards from this stop until the next stop. Ignored on smooth points. */
  reversed: boolean;
  /** Stop points: turn in place to face this field heading (deg) before running actions. */
  facing: number | null;
  /** Stop points: run sequentially while the robot is stopped here. */
  actions: Action[];
  /** Commands started when the robot leaves/passes this point; interrupted at the next stop. */
  markers: string[];
  /** Optional speed limit (m/s) for the segment from this point to the next one. */
  maxVel: number | null;
}

export interface Auto {
  id: string;
  name: string;
  waypoints: Waypoint[];
}

export type MotorType = 'CIM' | 'MiniCIM' | 'NEO' | 'Falcon500' | 'KrakenX60';

export type ControllerType =
  | 'pwm-sparkmax'
  | 'pwm-victorspx'
  | 'pwm-talonsrx'
  | 'pwm-spark'
  | 'pwm-victorsp'
  | 'can-talonsrx'
  | 'can-victorspx'
  | 'can-talon-victor'
  | 'can-sparkmax-brushless'
  | 'can-sparkmax-brushed';

/**
 * none       – open loop: follows the profile using only feedforward (time based).
 * rio        – quadrature encoders wired to roboRIO DIO ports.
 * integrated – sensor read through the motor controller (NEO hall sensor on
 *              SPARK MAX, or a CTRE Mag Encoder on the Talon SRX leader).
 */
export type EncoderType = 'none' | 'rio' | 'integrated';

export interface RobotConfig {
  /** Bumper-to-bumper length along the direction of travel, m. */
  length: number;
  /** Bumper-to-bumper width, m. */
  width: number;
  /** Effective (kinematic) track width used for turning math, m. */
  trackWidth: number;
  wheelDiameter: number;
  /** Motor rotations per wheel rotation. */
  gearRatio: number;
  motor: MotorType;
  motorsPerSide: number;

  maxVelocity: number;
  maxAcceleration: number;
  maxCentripetal: number;
  /** Turn-in-place limits, deg/s and deg/s^2. */
  maxTurnRate: number;
  maxTurnAccel: number;

  /** Per-side feedforward in volts, volts per m/s, volts per m/s^2. */
  kS: number;
  kV: number;
  kA: number;
  /** Position feedback, volts per meter of wheel position error. */
  kP: number;
  /** Velocity feedback, volts per m/s of wheel velocity error. */
  kD: number;
  /**
   * Heading hold from encoders: extra volts per meter of difference between
   * the left and right position errors. Corrects heading without a gyro.
   */
  kPTurn: number;
  /**
   * Path correction from encoder odometry (1/m): steers back towards the path
   * when the robot drifts sideways. 0 disables it.
   */
  kLateral: number;
  positionTolerance: number;
  maxSettleTime: number;
  maxVoltage: number;

  controller: ControllerType;
  leftIds: number[];
  rightIds: number[];
  invertLeft: boolean;
  invertRight: boolean;
  brakeMode: boolean;
  currentLimit: number;

  encoder: EncoderType;
  /** rio: encoder cycles per revolution; integrated Talon SRX: sensor units per revolution. */
  encoderCPR: number;
  /** True when the encoder shaft turns with the motor (gear ratio applies). */
  encoderOnMotorShaft: boolean;
  leftEncoderPorts: [number, number];
  rightEncoderPorts: [number, number];
  invertLeftEncoder: boolean;
  invertRightEncoder: boolean;
}

export interface FieldConfig {
  preset: string;
  length: number;
  width: number;
}

export interface NamedCommand {
  name: string;
  /** Estimated run time, only used for the preview/timeline. */
  duration: number;
}

export type Language = 'java' | 'python';

export interface CodegenConfig {
  language: Language;
  javaPackage: string;
  /** Sample period of embedded trajectories, s. */
  sampleTime: number;
  /** Length of the autonomous period, used for warnings. */
  autoPeriod: number;
}

export interface Project {
  version: 1;
  robot: RobotConfig;
  field: FieldConfig;
  autos: Auto[];
  commands: NamedCommand[];
  codegen: CodegenConfig;
}
