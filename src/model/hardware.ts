import type { ControllerType, EncoderType, RobotConfig } from './types';

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
