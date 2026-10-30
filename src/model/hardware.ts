import type { ControllerType, EncoderType, MotorType, RobotConfig } from './types';

export type ControllerFamily = 'pwm' | 'ctre' | 'rev';

export interface ControllerInfo {
  label: string;
  family: ControllerFamily;
  /** Whether the leader motor controller can read a drivetrain encoder. */
  integratedEncoder: boolean;
  idLabel: string;
}

export const CONTROLLERS: Record<ControllerType, ControllerInfo> = {
  'can-talon-victor': { label: 'CAN: Talon SRX leader + Victor SPX followers', family: 'ctre', integratedEncoder: true, idLabel: 'CAN IDs' },
  'can-talonsrx': { label: 'CAN: Talon SRX (all)', family: 'ctre', integratedEncoder: true, idLabel: 'CAN IDs' },
  'can-victorspx': { label: 'CAN: Victor SPX (all)', family: 'ctre', integratedEncoder: false, idLabel: 'CAN IDs' },
  'can-sparkmax-brushless': { label: 'CAN: SPARK MAX + NEO (brushless)', family: 'rev', integratedEncoder: true, idLabel: 'CAN IDs' },
  'can-sparkmax-brushed': { label: 'CAN: SPARK MAX + CIM (brushed)', family: 'rev', integratedEncoder: false, idLabel: 'CAN IDs' },
  'can-sparkflex': { label: 'CAN: SPARK Flex + NEO Vortex', family: 'rev', integratedEncoder: true, idLabel: 'CAN IDs' },
  'pwm-sparkmax': { label: 'PWM: SPARK MAX', family: 'pwm', integratedEncoder: false, idLabel: 'PWM ports' },
  'pwm-victorspx': { label: 'PWM: Victor SPX', family: 'pwm', integratedEncoder: false, idLabel: 'PWM ports' },
  'pwm-talonsrx': { label: 'PWM: Talon SRX', family: 'pwm', integratedEncoder: false, idLabel: 'PWM ports' },
  'pwm-spark': { label: 'PWM: REV SPARK', family: 'pwm', integratedEncoder: false, idLabel: 'PWM ports' },
  'pwm-victorsp': { label: 'PWM: Victor SP', family: 'pwm', integratedEncoder: false, idLabel: 'PWM ports' },
};

export const PWM_CLASS: Partial<Record<ControllerType, string>> = {
  'pwm-sparkmax': 'PWMSparkMax',
  'pwm-victorspx': 'PWMVictorSPX',
  'pwm-talonsrx': 'PWMTalonSRX',
  'pwm-spark': 'Spark',
  'pwm-victorsp': 'VictorSP',
};

export const ENCODER_LABELS: Record<EncoderType, string> = {
  none: 'None: open loop, time based',
  rio: 'roboRIO quadrature encoders (DIO)',
  integrated: 'Through the motor controller',
};

/** The encoder setup that will actually be generated for this robot. */
export function effectiveEncoder(robot: RobotConfig): EncoderType {
  if (robot.encoder === 'integrated' && !CONTROLLERS[robot.controller].integratedEncoder) return 'none';
  return robot.encoder;
}

/**
 * Per-side factors from the left/right wheel balance: true wheel travel per nominal meter that the
 * encoders count (with encoders), or the division applied to each side's voltage (without).
 */
export function balanceScales(balance: number): { left: number; right: number } {
  return { left: 1 - balance / 2, right: 1 + balance / 2 };
}

/** Wheel meters per encoder unit (rio: cycles, Talon: sensor units, SPARK MAX: motor rotations). */
export function metersPerEncoderUnit(robot: RobotConfig): number {
  const circumference = Math.PI * robot.wheelDiameter;
  const enc = effectiveEncoder(robot);
  if (enc === 'integrated' && CONTROLLERS[robot.controller].family === 'rev') {
    return circumference / robot.gearRatio;
  }
  const perRev = Math.max(1, robot.encoderCPR) * (robot.encoderOnMotorShaft ? robot.gearRatio : 1);
  return circumference / perRev;
}

const BRUSHLESS: MotorType[] = ['NEO', 'NeoVortex', 'Falcon500', 'KrakenX60'];

/** A problem with the motor / controller combination, or null when it works. */
export function motorControllerIssue(robot: Pick<RobotConfig, 'motor' | 'controller'>): string | null {
  const { motor, controller } = robot;
  if (motor === 'Falcon500' || motor === 'KrakenX60') {
    return 'Falcon 500 / Kraken X60 (TalonFX) code is not generated. Pick the closest controller and adapt KopDrivetrain, or use NEO / CIM.';
  }
  if (motor === 'NEO' && controller !== 'can-sparkmax-brushless') {
    return 'A NEO needs a SPARK MAX in brushless mode: choose "CAN: SPARK MAX + NEO (brushless)".';
  }
  if (motor === 'NeoVortex' && controller !== 'can-sparkflex') {
    return 'A NEO Vortex needs a SPARK Flex: choose "CAN: SPARK Flex + NEO Vortex".';
  }
  if (!BRUSHLESS.includes(motor) && (controller === 'can-sparkmax-brushless' || controller === 'can-sparkflex')) {
    return `${motor === 'MiniCIM' ? 'A Mini CIM' : 'A CIM'} is brushed: use a brushed controller (Talon SRX, Victor SPX, SPARK MAX brushed, or PWM).`;
  }
  return null;
}

export interface DrivetrainPreset {
  id: string;
  label: string;
  apply: Partial<RobotConfig>;
}

/** Common KOP drivetrain setups (gearbox, wheels and dimensions are left alone). */
export const DRIVETRAIN_PRESETS: DrivetrainPreset[] = [
  {
    id: 'cim-ctre',
    label: '2 CIM / side · Talon SRX + Victor SPX · roboRIO encoders',
    apply: { motor: 'CIM', motorsPerSide: 2, controller: 'can-talon-victor', encoder: 'rio', encoderCPR: 360, encoderOnMotorShaft: false, invertLeftEncoder: false, invertRightEncoder: true, currentLimit: 40, kD: 1.0 },
  },
  {
    id: 'neo-sparkmax',
    label: '2 NEO / side · SPARK MAX · built-in encoders',
    apply: { motor: 'NEO', motorsPerSide: 2, controller: 'can-sparkmax-brushless', encoder: 'integrated', invertLeftEncoder: false, invertRightEncoder: false, currentLimit: 50, kD: 0.5 },
  },
  {
    id: 'vortex-sparkflex',
    label: '2 NEO Vortex / side · SPARK Flex · built-in encoders',
    apply: { motor: 'NeoVortex', motorsPerSide: 2, controller: 'can-sparkflex', encoder: 'integrated', invertLeftEncoder: false, invertRightEncoder: false, currentLimit: 60, kD: 0.5 },
  },
  {
    id: 'cim-sparkmax',
    label: '2 CIM / side · SPARK MAX (brushed) · roboRIO encoders',
    apply: { motor: 'CIM', motorsPerSide: 2, controller: 'can-sparkmax-brushed', encoder: 'rio', encoderCPR: 360, encoderOnMotorShaft: false, invertLeftEncoder: false, invertRightEncoder: true, currentLimit: 40, kD: 1.0 },
  },
  {
    id: 'cim-pwm',
    label: '2 CIM / side · PWM SPARK MAX · no encoders',
    apply: { motor: 'CIM', motorsPerSide: 2, controller: 'pwm-sparkmax', encoder: 'none' },
  },
];
