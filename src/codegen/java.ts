// Java (WPILib command-based) code generator.

import { CONTROLLERS, PWM_CLASS, effectiveEncoder, metersPerEncoderUnit } from '../model/hardware';
import type { Project, RobotConfig } from '../model/types';
import {
  type GeneratedFile,
  type IRAuto,
  type IRStep,
  avoidReserved,
  camelCase,
  commentSafe,
  describeStep,
  float,
  formatRow,
  headerComment,
  num,
  pascalCase,
  quote,
  uniqueNames,
} from './common';

const ROWS_PER_BLOCK = 400;

function javadoc(lines: string[], indent = ''): string {
  return [
    `${indent}/**`,
    ...lines.map((l) => (l ? `${indent} * ${commentSafe(l)}` : `${indent} *`)),
    `${indent} */`,
  ].join('\n');
}

function intArray(values: number[]): string {
  return `{${values.map((v) => String(Math.round(v))).join(', ')}}`;
}

function bool(v: boolean): string {
  return v ? 'true' : 'false';
}

function constantsFile(pkg: string, project: Project): string {
  const r = project.robot;
  const enc = effectiveEncoder(r);
  const family = CONTROLLERS[r.controller].family;
  const unitDoc =
    enc === 'integrated'
      ? family === 'rev'
        ? 'Wheel meters per motor rotation (NEO / NEO Vortex built-in encoder).'
        : 'Wheel meters per Talon SRX sensor unit.'
      : 'Wheel meters per encoder cycle (WPILib distance per pulse).';
  return `package ${pkg};

${javadoc(['Constants for the KOP drivetrain and the trajectory follower.', '', ...headerComment(project)])}
public final class KopDriveConstants {
  private KopDriveConstants() {}

  // ---- Geometry ----
  /** Effective (kinematic) track width in meters. Tune this if turns over/undershoot. */
  public static final double kTrackWidthMeters = ${float(r.trackWidth, 4)};
  public static final double kWheelDiameterMeters = ${float(r.wheelDiameter, 4)};
  /** Motor rotations per wheel rotation. */
  public static final double kGearRatio = ${float(r.gearRatio, 4)};
  /** Field width, used to mirror poses shown on the dashboard. */
  public static final double kFieldWidthMeters = ${float(project.field.width, 3)};

  // ---- Motor controllers (${CONTROLLERS[r.controller].label}) ----
  public static final int[] kLeftMotorIds = ${intArray(r.leftIds)};
  public static final int[] kRightMotorIds = ${intArray(r.rightIds)};
  public static final boolean kInvertLeft = ${bool(r.invertLeft)};
  public static final boolean kInvertRight = ${bool(r.invertRight)};
  public static final boolean kBrakeMode = ${bool(r.brakeMode)};
  public static final int kCurrentLimitAmps = ${Math.round(r.currentLimit)};

  // ---- Encoders ----
  /** False runs the autos open loop (time based) using only feedforward. */
  public static final boolean kUseEncoders = ${bool(enc !== 'none')};
  public static final int[] kLeftEncoderPorts = ${intArray(r.leftEncoderPorts)};
  public static final int[] kRightEncoderPorts = ${intArray(r.rightEncoderPorts)};
  public static final boolean kInvertLeftEncoder = ${bool(r.invertLeftEncoder)};
  public static final boolean kInvertRightEncoder = ${bool(r.invertRightEncoder)};
  /** ${unitDoc} */
  public static final double kMetersPerEncoderUnit = ${metersPerEncoderUnit(r).toPrecision(8)};

  // ---- Feedforward, per side ----
  /** Volts to overcome static friction. */
  public static final double kS = ${float(r.kS)};
  /** Volts per meter/second. */
  public static final double kV = ${float(r.kV)};
  /** Volts per meter/second^2. */
  public static final double kA = ${float(r.kA)};

  // ---- Feedback (only used with encoders) ----
  /** Volts per meter of wheel position error. */
  public static final double kP = ${float(r.kP)};
  /** Volts per meter/second of wheel velocity error. */
  public static final double kD = ${float(r.kD)};
  /** Heading hold without a gyro: volts per meter of left/right error difference. */
  public static final double kPTurn = ${float(r.kPTurn)};
  /** Path correction from encoder odometry (1/m): steer back when drifting sideways. 0 = off. */
  public static final double kLateral = ${float(r.kLateral)};
  public static final double kPositionToleranceMeters = ${float(r.positionTolerance)};
  public static final double kMaxSettleSeconds = ${float(r.maxSettleTime)};
  public static final double kMaxVoltage = ${float(r.maxVoltage)};
}
`;
}

function driveInterfaceFile(pkg: string): string {
  return `package ${pkg};

import edu.wpi.first.wpilibj2.command.Subsystem;

/**
 * The few drivetrain methods the generated autos need. Implement this on your own drivetrain
 * subsystem, or use the generated {@link KopDrivetrain}.
 */
public interface KopDrive extends Subsystem {
  /** Applies a voltage to each side. Positive values drive the robot forward. */
  void setWheelVoltages(double leftVolts, double rightVolts);

  /** Left wheel distance in meters, positive forward. Any starting value is fine. */
  double getLeftDistanceMeters();

  /** Right wheel distance in meters, positive forward. Any starting value is fine. */
  double getRightDistanceMeters();

  double getLeftVelocityMetersPerSecond();

  double getRightVelocityMetersPerSecond();

  /** True when the distance and velocity methods return real encoder readings. */
  boolean hasEncoders();

  /** Called when an auto starts, with the planned starting pose (for odometry/dashboards). */
  default void resetPose(double xMeters, double yMeters, double headingRadians) {}

  /** Called every loop while following a trajectory with the planned pose. */
  default void setTargetPose(double xMeters, double yMeters, double headingRadians) {}

  default void stopDrive() {
    setWheelVoltages(0, 0);
  }
}
`;
}

function trajectoryFile(pkg: string): string {
  return `package ${pkg};

import java.util.Arrays;

/**
 * A pre-computed wheel trajectory generated by KOP Path Planner.
 *
 * <p>Each row holds: time (s), x (m), y (m), heading (rad), left position (m), left velocity
 * (m/s), left acceleration (m/s^2), right position, right velocity, right acceleration. Wheel
 * positions are relative to the start of the trajectory.
 */
public final class KopTrajectory {
  public static final int kColumns = 10;

  /** One interpolated setpoint. */
  public static final class State {
    public double time;
    public double x;
    public double y;
    public double heading;
    public double leftPosition;
    public double leftVelocity;
    public double leftAcceleration;
    public double rightPosition;
    public double rightVelocity;
    public double rightAcceleration;
  }

  private final double[] data;
  private final int rows;

  private KopTrajectory(double[] data) {
    if (data.length < kColumns) {
      throw new IllegalArgumentException("Trajectory needs at least one sample");
    }
    this.data = data;
    this.rows = data.length / kColumns;
  }

  /** Parses rows separated by newlines or ';' with comma separated values. */
  public static KopTrajectory parse(String... blocks) {
    double[] values = new double[1024];
    int count = 0;
    for (String block : blocks) {
      for (String row : block.split("[;\\\\n]")) {
        row = row.trim();
        if (row.isEmpty()) {
          continue;
        }
        String[] cols = row.split(",");
        if (cols.length != kColumns) {
          throw new IllegalArgumentException("Bad trajectory row: " + row);
        }
        if (count + kColumns > values.length) {
          values = Arrays.copyOf(values, values.length * 2);
        }
        for (String col : cols) {
          values[count++] = Double.parseDouble(col.trim());
        }
      }
    }
    return new KopTrajectory(Arrays.copyOf(values, count));
  }

  public double getTotalTimeSeconds() {
    return data[(rows - 1) * kColumns];
  }

  public int getSampleCount() {
    return rows;
  }

  /** Linearly interpolates the setpoint at time t (clamped to the trajectory). */
  public State sample(double t, State out) {
    int lo = 0;
    int hi = rows - 1;
    if (t <= data[0]) {
      hi = 0;
    } else if (t >= data[hi * kColumns]) {
      lo = hi;
    } else {
      while (hi - lo > 1) {
        int mid = (lo + hi) >>> 1;
        if (data[mid * kColumns] <= t) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
    }
    int a = lo * kColumns;
    int b = hi * kColumns;
    double span = data[b] - data[a];
    double f = span > 1e-9 ? (t - data[a]) / span : 0.0;
    out.time = lerp(data[a], data[b], f);
    out.x = lerp(data[a + 1], data[b + 1], f);
    out.y = lerp(data[a + 2], data[b + 2], f);
    out.heading = lerp(data[a + 3], data[b + 3], f);
    out.leftPosition = lerp(data[a + 4], data[b + 4], f);
    out.leftVelocity = lerp(data[a + 5], data[b + 5], f);
    out.leftAcceleration = lerp(data[a + 6], data[b + 6], f);
    out.rightPosition = lerp(data[a + 7], data[b + 7], f);
    out.rightVelocity = lerp(data[a + 8], data[b + 8], f);
    out.rightAcceleration = lerp(data[a + 9], data[b + 9], f);
    return out;
  }

  private static double lerp(double a, double b, double f) {
    return a + (b - a) * f;
  }
}
`;
}

function followerFile(pkg: string): string {
  return `package ${pkg};

import static ${pkg}.KopDriveConstants.*;

import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj2.command.Command;
import java.util.function.BooleanSupplier;

/**
 * Follows a {@link KopTrajectory} on a differential drive without a gyro.
 *
 * <p>Each side gets feedforward (kS, kV, kA) from its wheel profile. With encoders it adds:
 *
 * <ul>
 *   <li>wheel position/velocity feedback (kP, kD),
 *   <li>heading hold on the difference between the left and right errors (kPTurn),
 *   <li>path correction from encoder-only odometry: when the robot drifts sideways it steers back
 *       towards the path (kLateral).
 * </ul>
 *
 * <p>Without encoders the profile is played back open loop (time based).
 */
public class FollowKopTrajectory extends Command {
  private static final double kMaxSteerRadians = 0.35;
  private static final double kSteerFullSpeed = 0.3;
  private static final double kLoopPeriodSeconds = 0.02;

  private final KopDrive drive;
  private final KopTrajectory trajectory;
  private final BooleanSupplier mirror;
  private final Timer timer = new Timer();
  private final KopTrajectory.State setpoint = new KopTrajectory.State();
  private final KopTrajectory.State feedforwardSetpoint = new KopTrajectory.State();
  private boolean started;
  private boolean closedLoop;
  private boolean mirrored;
  private boolean finished;
  private double leftStart;
  private double rightStart;
  // Encoder-only odometry in the trajectory's frame.
  private double odomX;
  private double odomY;
  private double odomHeading;
  private double lastLeft;
  private double lastRight;

  /**
   * @param mirror when true at start, the path is mirrored (left and right turns swap), e.g. to
   *     run the same auto from the other side of the field.
   */
  public FollowKopTrajectory(KopDrive drive, KopTrajectory trajectory, BooleanSupplier mirror) {
    this.drive = drive;
    this.trajectory = trajectory;
    this.mirror = mirror;
    addRequirements(drive);
  }

  public FollowKopTrajectory(KopDrive drive, KopTrajectory trajectory) {
    this(drive, trajectory, () -> false);
  }

  @Override
  public void initialize() {
    closedLoop = kUseEncoders && drive.hasEncoders();
    mirrored = mirror.getAsBoolean();
    finished = false;
    started = false;
    leftStart = drive.getLeftDistanceMeters();
    rightStart = drive.getRightDistanceMeters();
    trajectory.sample(0.0, setpoint);
    odomX = setpoint.x;
    odomY = setpoint.y;
    odomHeading = setpoint.heading;
    lastLeft = 0.0;
    lastRight = 0.0;
  }

  @Override
  public void execute() {
    // The clock starts on the first loop so setpoints line up with the encoder readings.
    if (!started) {
      timer.restart();
      started = true;
    }
    double t = timer.get();
    double total = trajectory.getTotalTimeSeconds();
    boolean profileDone = t >= total;
    trajectory.sample(Math.min(t, total), setpoint);
    // Feedforward targets the middle of the coming loop period.
    trajectory.sample(Math.min(t + kLoopPeriodSeconds / 2.0, total), feedforwardSetpoint);

    // Everything below works in the trajectory's frame; a mirrored path swaps the sides.
    double leftVolts =
        profileDone
            ? 0.0
            : feedforward(feedforwardSetpoint.leftVelocity, feedforwardSetpoint.leftAcceleration);
    double rightVolts =
        profileDone
            ? 0.0
            : feedforward(feedforwardSetpoint.rightVelocity, feedforwardSetpoint.rightAcceleration);

    if (closedLoop) {
      double left = drive.getLeftDistanceMeters() - leftStart;
      double right = drive.getRightDistanceMeters() - rightStart;
      double leftVel = drive.getLeftVelocityMetersPerSecond();
      double rightVel = drive.getRightVelocityMetersPerSecond();
      if (mirrored) {
        double swap = left;
        left = right;
        right = swap;
        swap = leftVel;
        leftVel = rightVel;
        rightVel = swap;
      }
      updateOdometry(left, right);
      double shift = profileDone ? 0.0 : steeringShift();
      double leftError = setpoint.leftPosition - shift - left;
      double rightError = setpoint.rightPosition + shift - right;
      boolean inTolerance =
          Math.abs(leftError) < kPositionToleranceMeters
              && Math.abs(rightError) < kPositionToleranceMeters;
      if (profileDone && (inTolerance || t >= total + kMaxSettleSeconds)) {
        finished = true;
        drive.stopDrive();
        return;
      }
      double headingError = (rightError - leftError) / 2.0;
      leftVolts +=
          kP * leftError + kD * (setpoint.leftVelocity - leftVel) - kPTurn * headingError;
      rightVolts +=
          kP * rightError + kD * (setpoint.rightVelocity - rightVel) + kPTurn * headingError;
      if (profileDone) {
        // Settling on the final position: push through static friction.
        if (Math.abs(leftError) >= kPositionToleranceMeters) {
          leftVolts += kS * Math.signum(leftError);
        }
        if (Math.abs(rightError) >= kPositionToleranceMeters) {
          rightVolts += kS * Math.signum(rightError);
        }
      }
    } else if (profileDone) {
      finished = true;
      drive.stopDrive();
      return;
    }

    if (mirrored) {
      drive.setWheelVoltages(clamp(rightVolts), clamp(leftVolts));
      drive.setTargetPose(setpoint.x, kFieldWidthMeters - setpoint.y, -setpoint.heading);
    } else {
      drive.setWheelVoltages(clamp(leftVolts), clamp(rightVolts));
      drive.setTargetPose(setpoint.x, setpoint.y, setpoint.heading);
    }
  }

  @Override
  public boolean isFinished() {
    return finished;
  }

  @Override
  public void end(boolean interrupted) {
    timer.stop();
    drive.stopDrive();
  }

  private void updateOdometry(double left, double right) {
    double dLeft = left - lastLeft;
    double dRight = right - lastRight;
    lastLeft = left;
    lastRight = right;
    double dHeading = (dRight - dLeft) / kTrackWidthMeters;
    double distance = (dLeft + dRight) / 2.0;
    odomX += distance * Math.cos(odomHeading + dHeading / 2.0);
    odomY += distance * Math.sin(odomHeading + dHeading / 2.0);
    odomHeading += dHeading;
  }

  /** Wheel distance added to the right setpoint (and taken from the left) to steer onto the path. */
  private double steeringShift() {
    double velocity = (setpoint.leftVelocity + setpoint.rightVelocity) / 2.0;
    if (kLateral <= 0.0 || Math.abs(velocity) < 1e-3) {
      return 0.0;
    }
    double dx = setpoint.x - odomX;
    double dy = setpoint.y - odomY;
    double lateralError = -Math.sin(odomHeading) * dx + Math.cos(odomHeading) * dy;
    double speedScale = Math.min(1.0, Math.abs(velocity) / kSteerFullSpeed);
    double steer =
        Math.max(-kMaxSteerRadians, Math.min(kMaxSteerRadians, Math.atan(kLateral * lateralError)));
    return Math.signum(velocity) * speedScale * steer * kTrackWidthMeters / 2.0;
  }

  private static double feedforward(double velocity, double acceleration) {
    double direction =
        Math.abs(velocity) > 1e-4 ? Math.signum(velocity) : Math.signum(acceleration);
    return kS * direction + kV * velocity + kA * acceleration;
  }

  private static double clamp(double volts) {
    return Math.max(-kMaxVoltage, Math.min(kMaxVoltage, volts));
  }
}
`;
}

function namedCommandsFile(pkg: string): string {
  return `package ${pkg};

import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Registry for the named commands used in the planner (actions and markers). Register every name
 * before building the autos, for example in the RobotContainer constructor.
 */
public final class KopNamedCommands {
  private static final Map<String, Supplier<Command>> commands = new HashMap<>();

  private KopNamedCommands() {}

  /** Registers a factory; a new command instance is created each time the name is used. */
  public static void register(String name, Supplier<Command> factory) {
    commands.put(name, factory);
  }

  public static boolean isRegistered(String name) {
    return commands.containsKey(name);
  }

  /** Creates the command for a name, or a warning placeholder if it was never registered. */
  public static Command get(String name) {
    Supplier<Command> factory = commands.get(name);
    if (factory == null) {
      DriverStation.reportWarning("KOP auto: named command '" + name + "' is not registered", false);
      return Commands.print("[KOP auto] missing named command: " + name);
    }
    return factory.get();
  }
}
`;
}

function drivetrainFile(pkg: string, robot: RobotConfig): string {
  const info = CONTROLLERS[robot.controller];
  const enc = effectiveEncoder(robot);
  const imports = new Set<string>([
    'edu.wpi.first.math.geometry.Rotation2d',
    'edu.wpi.first.wpilibj.drive.DifferentialDrive',
    'edu.wpi.first.wpilibj.smartdashboard.Field2d',
    'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard',
    'edu.wpi.first.wpilibj2.command.Command',
    'edu.wpi.first.wpilibj2.command.SubsystemBase',
    'java.util.function.DoubleSupplier',
  ]);
  const fields: string[] = [];
  const init: string[] = [];
  const helpers: string[] = [];
  let setVolts: string[];
  let setPercent: string[];
  let leftDist = '0.0';
  let rightDist = '0.0';
  let leftVel = '0.0';
  let rightVel = '0.0';
  let hardwareDoc: string;

  fields.push(
    '  private static final double kLeftSign = kInvertLeft ? -1.0 : 1.0;',
    '  private static final double kRightSign = kInvertRight ? -1.0 : 1.0;',
  );

  if (info.family === 'pwm') {
    const cls = PWM_CLASS[robot.controller] as string;
    imports.add(`edu.wpi.first.wpilibj.motorcontrol.${cls}`);
    hardwareDoc = `${cls} motor controllers on PWM ports (set brake/coast with the controller's button or jumper).`;
    fields.push(
      `  private final ${cls}[] leftMotors = new ${cls}[kLeftMotorIds.length];`,
      `  private final ${cls}[] rightMotors = new ${cls}[kRightMotorIds.length];`,
    );
    init.push(
      '    for (int i = 0; i < kLeftMotorIds.length; i++) {',
      `      leftMotors[i] = new ${cls}(kLeftMotorIds[i]);`,
      '    }',
      '    for (int i = 0; i < kRightMotorIds.length; i++) {',
      `      rightMotors[i] = new ${cls}(kRightMotorIds[i]);`,
      '    }',
    );
    setVolts = [
      `    for (${cls} motor : leftMotors) {`,
      '      motor.setVoltage(kLeftSign * leftVolts);',
      '    }',
      `    for (${cls} motor : rightMotors) {`,
      '      motor.setVoltage(kRightSign * rightVolts);',
      '    }',
    ];
    setPercent = [
      `    for (${cls} motor : leftMotors) {`,
      '      motor.set(kLeftSign * left);',
      '    }',
      `    for (${cls} motor : rightMotors) {`,
      '      motor.set(kRightSign * right);',
      '    }',
    ];
  } else if (info.family === 'ctre') {
    const leaderCls = robot.controller === 'can-victorspx' ? 'WPI_VictorSPX' : 'WPI_TalonSRX';
    const followerCls = robot.controller === 'can-talonsrx' ? 'WPI_TalonSRX' : 'WPI_VictorSPX';
    imports.add('com.ctre.phoenix.motorcontrol.NeutralMode');
    imports.add('com.ctre.phoenix.motorcontrol.can.BaseMotorController');
    imports.add(`com.ctre.phoenix.motorcontrol.can.${leaderCls}`);
    imports.add(`com.ctre.phoenix.motorcontrol.can.${followerCls}`);
    hardwareDoc = `CTRE ${leaderCls.replace('WPI_', '')} leader + ${followerCls.replace('WPI_', '')} followers per side (Phoenix 5 vendor library).`;
    fields.push(
      `  private final ${leaderCls} leftLeader = new ${leaderCls}(kLeftMotorIds[0]);`,
      `  private final ${leaderCls} rightLeader = new ${leaderCls}(kRightMotorIds[0]);`,
      `  private final ${followerCls}[] leftFollowers = new ${followerCls}[kLeftMotorIds.length - 1];`,
      `  private final ${followerCls}[] rightFollowers = new ${followerCls}[kRightMotorIds.length - 1];`,
    );
    init.push(
      '    configureMotor(leftLeader);',
      '    configureMotor(rightLeader);',
      '    for (int i = 1; i < kLeftMotorIds.length; i++) {',
      `      leftFollowers[i - 1] = new ${followerCls}(kLeftMotorIds[i]);`,
      '      configureMotor(leftFollowers[i - 1]);',
      '      leftFollowers[i - 1].follow(leftLeader);',
      '    }',
      '    for (int i = 1; i < kRightMotorIds.length; i++) {',
      `      rightFollowers[i - 1] = new ${followerCls}(kRightMotorIds[i]);`,
      '      configureMotor(rightFollowers[i - 1]);',
      '      rightFollowers[i - 1].follow(rightLeader);',
      '    }',
    );
    if (leaderCls === 'WPI_TalonSRX') {
      init.push(
        '    for (WPI_TalonSRX talon : new WPI_TalonSRX[] {leftLeader, rightLeader}) {',
        '      talon.configContinuousCurrentLimit(kCurrentLimitAmps);',
        '      talon.configPeakCurrentLimit(0);',
        '      talon.enableCurrentLimit(true);',
        '    }',
      );
    }
    helpers.push(
      '  private static void configureMotor(BaseMotorController motor) {',
      '    motor.configFactoryDefault();',
      '    motor.setNeutralMode(kBrakeMode ? NeutralMode.Brake : NeutralMode.Coast);',
      '  }',
    );
    setVolts = ['    leftLeader.setVoltage(kLeftSign * leftVolts);', '    rightLeader.setVoltage(kRightSign * rightVolts);'];
    setPercent = ['    leftLeader.set(kLeftSign * left);', '    rightLeader.set(kRightSign * right);'];
    if (enc === 'integrated') {
      imports.add('com.ctre.phoenix.motorcontrol.FeedbackDevice');
      init.push(
        '    leftLeader.configSelectedFeedbackSensor(FeedbackDevice.CTRE_MagEncoder_Relative, 0, 30);',
        '    rightLeader.configSelectedFeedbackSensor(FeedbackDevice.CTRE_MagEncoder_Relative, 0, 30);',
      );
      fields.push(
        '  private static final double kLeftEncoderSign = kLeftSign * (kInvertLeftEncoder ? -1.0 : 1.0);',
        '  private static final double kRightEncoderSign = kRightSign * (kInvertRightEncoder ? -1.0 : 1.0);',
      );
      leftDist = 'kLeftEncoderSign * leftLeader.getSelectedSensorPosition() * kMetersPerEncoderUnit';
      rightDist = 'kRightEncoderSign * rightLeader.getSelectedSensorPosition() * kMetersPerEncoderUnit';
      // Talon SRX velocity is reported in sensor units per 100 ms.
      leftVel = 'kLeftEncoderSign * leftLeader.getSelectedSensorVelocity() * 10.0 * kMetersPerEncoderUnit';
      rightVel = 'kRightEncoderSign * rightLeader.getSelectedSensorVelocity() * 10.0 * kMetersPerEncoderUnit';
    }
  } else {
    const flex = robot.controller === 'can-sparkflex';
    const brushless = flex || robot.controller === 'can-sparkmax-brushless';
    const cls = flex ? 'SparkFlex' : 'SparkMax';
    const cfg = `${cls}Config`;
    imports.add('com.revrobotics.PersistMode');
    imports.add('com.revrobotics.ResetMode');
    imports.add('com.revrobotics.spark.SparkLowLevel.MotorType');
    imports.add(`com.revrobotics.spark.${cls}`);
    imports.add('com.revrobotics.spark.config.SparkBaseConfig.IdleMode');
    imports.add(`com.revrobotics.spark.config.${cfg}`);
    hardwareDoc = flex
      ? 'REV SPARK Flex controllers with NEO Vortex motors, REVLib 2026 configuration API.'
      : `REV SPARK MAX controllers (${brushless ? 'NEO brushless' : 'brushed CIM'}), REVLib 2026 configuration API.`;
    fields.push(
      `  private final ${cls}[] leftMotors = new ${cls}[kLeftMotorIds.length];`,
      `  private final ${cls}[] rightMotors = new ${cls}[kRightMotorIds.length];`,
    );
    init.push(
      '    for (int i = 0; i < kLeftMotorIds.length; i++) {',
      '      leftMotors[i] = createMotor(kLeftMotorIds[i]);',
      '    }',
      '    for (int i = 0; i < kRightMotorIds.length; i++) {',
      '      rightMotors[i] = createMotor(kRightMotorIds[i]);',
      '    }',
    );
    const encoderFilter =
      enc !== 'integrated'
        ? []
        : flex
          ? [
              '    // Faster NEO Vortex velocity readings for the trajectory follower\'s velocity feedback.',
              '    config.encoder.quadratureMeasurementPeriod(10).quadratureAverageDepth(2);',
            ]
          : [
              '    // Faster NEO velocity readings (default 32 ms window, 8 samples) for the velocity feedback.',
              '    config.encoder.uvwMeasurementPeriod(16).uvwAverageDepth(2);',
            ];
    helpers.push(
      `  private static ${cls} createMotor(int canId) {`,
      `    ${cls} motor = new ${cls}(canId, MotorType.${brushless ? 'kBrushless' : 'kBrushed'});`,
      `    ${cfg} config = new ${cfg}();`,
      '    config.idleMode(kBrakeMode ? IdleMode.kBrake : IdleMode.kCoast).smartCurrentLimit(kCurrentLimitAmps);',
      ...encoderFilter,
      '    // REVLib 2026. With REVLib 2025 import SparkBase.ResetMode / SparkBase.PersistMode instead.',
      '    motor.configure(config, ResetMode.kResetSafeParameters, PersistMode.kPersistParameters);',
      '    return motor;',
      '  }',
    );
    setVolts = [
      `    for (${cls} motor : leftMotors) {`,
      '      motor.setVoltage(kLeftSign * leftVolts);',
      '    }',
      `    for (${cls} motor : rightMotors) {`,
      '      motor.setVoltage(kRightSign * rightVolts);',
      '    }',
    ];
    setPercent = [
      `    for (${cls} motor : leftMotors) {`,
      '      motor.set(kLeftSign * left);',
      '    }',
      `    for (${cls} motor : rightMotors) {`,
      '      motor.set(kRightSign * right);',
      '    }',
    ];
    if (enc === 'integrated') {
      imports.add('com.revrobotics.RelativeEncoder');
      fields.push(
        '  private static final double kLeftEncoderSign = kLeftSign * (kInvertLeftEncoder ? -1.0 : 1.0);',
        '  private static final double kRightEncoderSign = kRightSign * (kInvertRightEncoder ? -1.0 : 1.0);',
        '  private final RelativeEncoder leftEncoder;',
        '  private final RelativeEncoder rightEncoder;',
      );
      init.push('    leftEncoder = leftMotors[0].getEncoder();', '    rightEncoder = rightMotors[0].getEncoder();');
      leftDist = 'kLeftEncoderSign * leftEncoder.getPosition() * kMetersPerEncoderUnit';
      rightDist = 'kRightEncoderSign * rightEncoder.getPosition() * kMetersPerEncoderUnit';
      // getVelocity() is in motor RPM.
      leftVel = 'kLeftEncoderSign * leftEncoder.getVelocity() / 60.0 * kMetersPerEncoderUnit';
      rightVel = 'kRightEncoderSign * rightEncoder.getVelocity() / 60.0 * kMetersPerEncoderUnit';
    }
  }

  if (enc === 'rio') {
    imports.add('edu.wpi.first.wpilibj.Encoder');
    fields.push(
      '  private final Encoder leftEncoder =',
      '      new Encoder(kLeftEncoderPorts[0], kLeftEncoderPorts[1], kInvertLeftEncoder);',
      '  private final Encoder rightEncoder =',
      '      new Encoder(kRightEncoderPorts[0], kRightEncoderPorts[1], kInvertRightEncoder);',
    );
    init.push(
      '    leftEncoder.setDistancePerPulse(kMetersPerEncoderUnit);',
      '    rightEncoder.setDistancePerPulse(kMetersPerEncoderUnit);',
    );
    leftDist = 'leftEncoder.getDistance()';
    rightDist = 'rightEncoder.getDistance()';
    leftVel = 'leftEncoder.getRate()';
    rightVel = 'rightEncoder.getRate()';
  }
  const encoderDoc =
    enc === 'none'
      ? 'No encoders: autos run open loop (time based).'
      : enc === 'rio'
        ? 'Encoders on roboRIO DIO ports.'
        : 'Encoders read through the motor controllers.';

  const sortedImports = [...imports].sort((a, b) => {
    const ga = a.startsWith('java.') ? 1 : 0;
    const gb = b.startsWith('java.') ? 1 : 0;
    return ga - gb || a.localeCompare(b);
  });
  const importLines: string[] = [];
  let lastGroup = -1;
  for (const imp of sortedImports) {
    const g = imp.startsWith('java.') ? 1 : 0;
    if (lastGroup !== -1 && g !== lastGroup) importLines.push('');
    importLines.push(`import ${imp};`);
    lastGroup = g;
  }

  return `package ${pkg};

import static ${pkg}.KopDriveConstants.*;

${importLines.join('\n')}

/**
 * Ready-to-use drivetrain subsystem for the KOP chassis. No gyro is used.
 *
 * <p>${hardwareDoc}
 *
 * <p>${encoderDoc} Before running autos, check on blocks: driving forward must make both
 * distances increase; flip kInvert* in KopDriveConstants if not.
 */
public class KopDrivetrain extends SubsystemBase implements KopDrive {
${fields.join('\n')}

  private final Field2d field = new Field2d();
  // Encoder-only odometry: heading comes from the difference between the wheels.
  private double poseX;
  private double poseY;
  private double poseHeading;
  private double lastLeft;
  private double lastRight;

  public KopDrivetrain() {
${init.join('\n')}
    SmartDashboard.putData("KOP Field", field);
  }

  @Override
  public void setWheelVoltages(double leftVolts, double rightVolts) {
${setVolts.join('\n')}
  }

  /** Open loop percent output per side, -1 to 1. */
  public void tankDrivePercent(double left, double right) {
${setPercent.join('\n')}
  }

  /** Arcade drive for teleop. Rotation is counter-clockwise positive. */
  public void arcadeDrive(double forward, double rotation) {
    DifferentialDrive.WheelSpeeds speeds = DifferentialDrive.arcadeDriveIK(forward, rotation, true);
    tankDrivePercent(speeds.left, speeds.right);
  }

  /** Default teleop command, e.g. arcadeDriveCommand(() -> -stick.getLeftY(), () -> -stick.getRightX()). */
  public Command arcadeDriveCommand(DoubleSupplier forward, DoubleSupplier rotation) {
    return run(() -> arcadeDrive(forward.getAsDouble(), rotation.getAsDouble()))
        .withName("Arcade Drive");
  }

  @Override
  public double getLeftDistanceMeters() {
    return ${leftDist};
  }

  @Override
  public double getRightDistanceMeters() {
    return ${rightDist};
  }

  @Override
  public double getLeftVelocityMetersPerSecond() {
    return ${leftVel};
  }

  @Override
  public double getRightVelocityMetersPerSecond() {
    return ${rightVel};
  }

  @Override
  public boolean hasEncoders() {
    return ${bool(enc !== 'none')};
  }

  @Override
  public void resetPose(double xMeters, double yMeters, double headingRadians) {
    poseX = xMeters;
    poseY = yMeters;
    poseHeading = headingRadians;
    lastLeft = getLeftDistanceMeters();
    lastRight = getRightDistanceMeters();
  }

  @Override
  public void setTargetPose(double xMeters, double yMeters, double headingRadians) {
    field.getObject("Target").setPose(xMeters, yMeters, Rotation2d.fromRadians(headingRadians));
    if (!hasEncoders()) {
      // Without encoders the best estimate is the plan itself.
      poseX = xMeters;
      poseY = yMeters;
      poseHeading = headingRadians;
    }
  }

  @Override
  public void periodic() {
    double left = getLeftDistanceMeters();
    double right = getRightDistanceMeters();
    double dLeft = left - lastLeft;
    double dRight = right - lastRight;
    lastLeft = left;
    lastRight = right;
    double dHeading = (dRight - dLeft) / kTrackWidthMeters;
    double distance = (dLeft + dRight) / 2.0;
    poseX += distance * Math.cos(poseHeading + dHeading / 2.0);
    poseY += distance * Math.sin(poseHeading + dHeading / 2.0);
    poseHeading += dHeading;
    field.setRobotPose(poseX, poseY, Rotation2d.fromRadians(poseHeading));
  }
${helpers.length ? `\n${helpers.join('\n')}\n` : ''}}
`;
}

function stepExpr(step: IRStep, dataClass: string): string | null {
  switch (step.kind) {
    case 'start':
      return `start(drive, mirror, ${float(step.x, 4)}, ${float(step.y, 4)}, ${float(step.heading, 5)})`;
    case 'command':
      return `KopNamedCommands.get(${quote(step.name)})`;
    case 'wait':
      return `Commands.waitSeconds(${float(step.seconds, 3)})`;
    case 'turn':
      return `follow(drive, mirror, ${dataClass}.${step.data})`;
    case 'drive': {
      const follow = `follow(drive, mirror, ${dataClass}.${step.data})`;
      if (step.markers.length === 0) return follow;
      const markers = step.markers.map((m) =>
        m.time < 1e-3
          ? `KopNamedCommands.get(${quote(m.name)})`
          : `Commands.waitSeconds(${float(m.time, 3)}).andThen(KopNamedCommands.get(${quote(m.name)}))`,
      );
      return `Commands.deadline(\n                ${follow},\n                ${markers.join(',\n                ')})`;
    }
  }
}

const JAVA_RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'float', 'for', 'goto',
  'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package',
  'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
  'this', 'throw', 'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while', 'var', 'record', 'yield',
  'start', 'follow', 'buildChooser',
]);

function javaMethodNames(autos: IRAuto[]): string[] {
  return uniqueNames(autos.map((a) => avoidReserved(camelCase(a.words), JAVA_RESERVED, 'Auto')));
}

function autosFile(pkg: string, autos: IRAuto[]): string {
  const methodNames = javaMethodNames(autos);
  const dataClasses = uniqueNames(autos.map((a) => `${pascalCase(a.words)}Data`));
  const allCommands = [...new Set(autos.flatMap((a) => a.commands))].sort();
  const methods: string[] = [];
  const dataBlocks: string[] = [];

  autos.forEach((auto, i) => {
    const method = methodNames[i];
    const dataClass = dataClasses[i];
    const exprs = auto.steps.map((s) => ({ expr: stepExpr(s, dataClass), step: s }));
    const body = exprs
      .map(({ expr, step }) => `            // ${commentSafe(describeStep(step))}\n            ${expr}`)
      .join(',\n');
    const docLines = [
      `${auto.name} (estimated ${num(auto.plan.totalTime, 2)} s, ${num(auto.plan.totalDistance, 2)} m of driving).`,
      '',
      ...(auto.commands.length ? [`<p>Named commands used: ${auto.commands.join(', ')}.`, ''] : []),
      '@param drive the drivetrain',
      '@param mirror evaluated when each motion starts; true mirrors the path (left/right turns swap)',
    ];
    methods.push(`${javadoc(docLines, '  ')}
  public static Command ${method}(KopDrive drive, BooleanSupplier mirror) {
    return Commands.sequence(
${body})
        .withName(${quote(auto.name)});
  }

  /** ${commentSafe(auto.name)}, not mirrored. */
  public static Command ${method}(KopDrive drive) {
    return ${method}(drive, () -> false);
  }`);

    const trajFields = auto.trajectories.map((tr) => {
      const blocks: string[] = [];
      for (let k = 0; k < tr.samples.length; k += ROWS_PER_BLOCK) {
        const rows = tr.samples.slice(k, k + ROWS_PER_BLOCK).map((s) => `            ${formatRow(s).join(',')}`);
        blocks.push(`        """\n${rows.join('\n')}\n            """`);
      }
      return `    static final KopTrajectory ${tr.name} =\n        KopTrajectory.parse(\n${blocks.join(',\n')});`;
    });
    dataBlocks.push(`  /** Trajectory samples for ${commentSafe(auto.name)}. */
  private static final class ${dataClass} {
${trajFields.length ? trajFields.join('\n\n') : '    // This auto has no motion.'}
  }`);
  });

  const chooserLines = autos.map((a, i) => `    chooser.addOption(${quote(a.name)}, ${methodNames[i]}(drive, mirror));`);

  return `package ${pkg};

import edu.wpi.first.wpilibj.smartdashboard.SendableChooser;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import java.util.function.BooleanSupplier;

/**
 * Autonomous routines generated by KOP Path Planner. Regenerate instead of editing by hand.
 *
 * <p>${allCommands.length ? `Register these named commands with KopNamedCommands first: ${allCommands.join(', ')}.` : 'These autos use no named commands.'}
 */
public final class KopAutos {
  private KopAutos() {}

  /** Builds a chooser containing every generated auto (plus "Do Nothing"). */
  public static SendableChooser<Command> buildChooser(KopDrive drive, BooleanSupplier mirror) {
    SendableChooser<Command> chooser = new SendableChooser<>();
    chooser.setDefaultOption("Do Nothing", Commands.none());
${chooserLines.join('\n')}
    return chooser;
  }

  public static SendableChooser<Command> buildChooser(KopDrive drive) {
    return buildChooser(drive, () -> false);
  }

${methods.join('\n\n')}

  private static Command follow(KopDrive drive, BooleanSupplier mirror, KopTrajectory trajectory) {
    return new FollowKopTrajectory(drive, trajectory, mirror);
  }

  private static Command start(
      KopDrive drive, BooleanSupplier mirror, double x, double y, double heading) {
    return Commands.runOnce(
        () -> {
          if (mirror.getAsBoolean()) {
            drive.resetPose(x, KopDriveConstants.kFieldWidthMeters - y, -heading);
          } else {
            drive.resetPose(x, y, heading);
          }
        });
  }

${dataBlocks.join('\n\n')}
}
`;
}

function readmeFile(pkg: string, autos: IRAuto[], methodNames: string[], pwmOnly: boolean): string {
  const commands = [...new Set(autos.flatMap((a) => a.commands))].sort();
  const register = commands.length
    ? commands.map((c) => `    KopNamedCommands.register(${quote(c)}, () -> Commands.print(${quote(`TODO: ${c}`)}));`).join('\n')
    : '    // (no named commands used)';
  return `# KOP autos (Java)

Generated by KOP Path Planner. Copy the \`src\` folder into your WPILib robot project
(package \`${pkg}\`). Only WPILib is required${pwmOnly ? '' : ' plus the vendor library of your motor controllers'}.

## Files

| File | What it is |
| --- | --- |
| \`KopDriveConstants.java\` | Robot measurements, ports and gains. |
| \`KopDrive.java\` | Interface the autos drive through. |
| \`KopDrivetrain.java\` | Ready-made drivetrain subsystem implementing \`KopDrive\`. |
| \`KopTrajectory.java\` | Trajectory sample storage/interpolation. |
| \`FollowKopTrajectory.java\` | Command that follows a trajectory without a gyro. |
| \`KopNamedCommands.java\` | Registry for the commands used by actions/markers. |
| \`KopAutos.java\` | The generated autos and their trajectory data. |

## RobotContainer example

\`\`\`java
import ${pkg}.KopAutos;
import ${pkg}.KopDrivetrain;
import ${pkg}.KopNamedCommands;
import edu.wpi.first.wpilibj.smartdashboard.SendableChooser;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import edu.wpi.first.wpilibj2.command.button.CommandXboxController;

public class RobotContainer {
  private final KopDrivetrain drive = new KopDrivetrain();
  private final CommandXboxController controller = new CommandXboxController(0);
  private final SendableChooser<Command> autoChooser;

  public RobotContainer() {
    // 1. Register named commands BEFORE building the autos.
${register}

    // 2. Build the autos (the lambda decides at runtime whether to mirror the path).
    autoChooser = KopAutos.buildChooser(drive, () -> false);
    SmartDashboard.putData("Auto", autoChooser);

    drive.setDefaultCommand(
        drive.arcadeDriveCommand(() -> -controller.getLeftY(), () -> -controller.getRightX()));
  }

  public Command getAutonomousCommand() {
    return autoChooser.getSelected();
    // Or pick one directly: return KopAutos.${methodNames[0] ?? 'myAuto'}(drive);
  }
}
\`\`\`

## Tuning checklist (no gyro)

1. **Directions**: on blocks, drive forward in teleop. Both wheel distances must increase.
   Fix with \`kInvertLeft/Right\` (motors) and \`kInvertLeft/RightEncoder\`.
2. **Feedforward**: run WPILib SysId (or a quick constant-voltage test) to get kS, kV, kA.
   Even open loop, good feedforward is what makes the robot hit its marks.
3. **Track width**: spin in place 5-10 turns, measure the wheel distances, and set
   \`kTrackWidthMeters = (|left| + |right|) / (2 * PI * turns)\` in the planner. On a 6WD
   drop-center chassis this is usually 5-20% larger than the measured width.
4. **Feedback**: raise \`kP\` until the robot tracks distance well without oscillating, then raise
   \`kPTurn\` to hold heading. Lower \`kD\` (velocity feedback) if the motors buzz.
`;
}

export function generateJava(project: Project, autos: IRAuto[]): GeneratedFile[] {
  const pkg = project.codegen.javaPackage.trim() || 'frc.robot.kop';
  const dir = `src/main/java/${pkg.replace(/\./g, '/')}`;
  const methodNames = javaMethodNames(autos);
  return [
    { path: `${dir}/KopAutos.java`, content: autosFile(pkg, autos) },
    { path: `${dir}/KopDriveConstants.java`, content: constantsFile(pkg, project) },
    { path: `${dir}/KopDrivetrain.java`, content: drivetrainFile(pkg, project.robot) },
    { path: `${dir}/KopDrive.java`, content: driveInterfaceFile(pkg) },
    { path: `${dir}/FollowKopTrajectory.java`, content: followerFile(pkg) },
    { path: `${dir}/KopTrajectory.java`, content: trajectoryFile(pkg) },
    { path: `${dir}/KopNamedCommands.java`, content: namedCommandsFile(pkg) },
    { path: 'KOP_AUTOS_README.md', content: readmeFile(pkg, autos, methodNames, CONTROLLERS[project.robot.controller].family === 'pwm') },
  ];
}
