// Java (WPILib command-based) code generator.

import { CONTROLLERS, PWM_CLASS, effectiveEncoder, metersPerEncoderUnit } from '../model/hardware';
import type { Project, RobotConfig, RobotFront } from '../model/types';
import { FOLLOWER } from '../planner/follower';
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
  realRobotChecklist,
  TEST_DRIVE_METERS,
  testTrajectories,
  uniqueNames,
} from './common';
import type { TrajState } from '../planner/trajectory';

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
  /**
   * How much farther the right wheels travel than the left ones for the same encoder count
   * (without encoders: for the same voltage), as a fraction. Wheel wear or a different tread makes
   * a robot curve on a straight line even with encoders. Set it from the sideways drift of the drive
   * 2 m test auto (planner Robot tab, Calibration).
   */
  public static final double kWheelBalance = ${float(r.wheelBalance, 5)};
  /**
   * ${enc === 'none' ? "Each side's voltage is divided by these" : 'Encoder distances are multiplied by these'} to even out the sides.
   */
  public static final double kLeftDistanceScale = 1.0 - kWheelBalance / 2.0;
  public static final double kRightDistanceScale = 1.0 + kWheelBalance / 2.0;
  /** Motor rotations per wheel rotation. */
  public static final double kGearRatio = ${float(r.gearRatio, 4)};
  /** Field width, used to mirror poses shown on the dashboard. */
  public static final double kFieldWidthMeters = ${float(project.field.width, 3)};

  // ---- Motor controllers (${CONTROLLERS[r.controller].label}) ----
  /** Left and right are seen from behind the robot's front, the ${r.front} end (planner Robot tab). */
  public static final int[] kLeftMotorIds = ${intArray(r.leftIds)};
  public static final int[] kRightMotorIds = ${intArray(r.rightIds)};
  public static final boolean kInvertLeft = ${bool(r.invertLeft)};
  public static final boolean kInvertRight = ${bool(r.invertRight)};
  public static final boolean kBrakeMode = ${bool(r.brakeMode)};
  public static final int kCurrentLimitAmps = ${Math.round(r.currentLimit)};
  /** Teleop joystick deadband for arcadeDrive. */
  public static final double kJoystickDeadband = 0.05;

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
  const F = FOLLOWER;
  return `package ${pkg};

import static ${pkg}.KopDriveConstants.*;

import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import java.util.function.BooleanSupplier;

/**
 * Follows a {@link KopTrajectory} on a differential drive without a gyro.
 *
 * <p>Each side gets feedforward (kS, kV, kA) from its wheel profile. With encoders it adds:
 *
 * <ul>
 *   <li>wheel position/velocity feedback (kP, kD),
 *   <li>heading hold on the difference between the left and right errors (kPTurn, plus an integral
 *       so a weaker side does not leave a steady heading error),
 *   <li>path correction from encoder-only odometry: when the robot drifts sideways it steers back
 *       towards the path (kLateral),
 *   <li>a progress clock: when the robot falls behind (heavier or slower than planned, low battery,
 *       tread scrub on turns) the setpoints slow down and wait for it, so the path keeps its shape,
 *   <li>a settle phase: the step ends once both wheels are on target and slow, pushing harder on a
 *       wheel that is stuck short of its target,
 *   <li>encoder checks: a side that moves the wrong way or does not count stops the closed loop
 *       (no runaway); the auto finishes open loop and the Driver Station shows the fix.
 * </ul>
 *
 * <p>Without encoders the profile is played back open loop (time based).
 */
public class FollowKopTrajectory extends Command {
  private static final double kLoopPeriodSeconds = 0.02;
  // Progress clock: slows down when a wheel lags its setpoint by kLagSlowMeters, stops at kLagStopMeters.
  private static final double kLagSlowMeters = ${float(F.lagSlow)};
  private static final double kLagStopMeters = ${float(F.lagStop)};
  private static final double kRateDownPerSecond = ${float(F.rateDown)};
  private static final double kRateUpPerSecond = ${float(F.rateUp)};
  // A step ends when both wheels are slower than this (m/s) and the heading is within tolerance.
  private static final double kSettleSpeed = ${float(F.settleSpeed)};
  private static final double kHeadingToleranceDegrees = ${float(F.headingTolerance)};
  // Settling: a wheel should approach its target at kApproachGain * error (at most kApproachSpeed);
  // extra volts build up while it is slower (static friction, scrub) and drain while it is faster.
  private static final double kApproachGain = ${float(F.approachGain)};
  private static final double kApproachSpeed = ${float(F.approachSpeed)};
  private static final double kBoostVoltsPerSecond = ${float(F.boostRate)};
  private static final double kBoostMaxVolts = ${float(F.boostMax)};
  // Heading integral (integral time, limit).
  private static final double kTurnIntegralSeconds = ${float(F.turnIntegralTime)};
  private static final double kTurnIntegralMaxVolts = ${float(F.turnIntegralMax)};
  // Path correction.
  private static final double kMaxSteerRadians = ${float(F.maxSteer)};
  private static final double kSteerFullSpeed = ${float(F.steerFullSpeed)};
  // Above this speed the correction steers less, in proportion, so it closes a sideways error at the
  // same rate at any speed (steering harder at speed weaves once CAN encoder readings lag).
  private static final double kSteerRefSpeed = ${float(F.steerRefSpeed)};
  // Encoder checks. Only volts above kS + kFaultFrictionVolts count as a strong push, so a wheel
  // held by static friction or tread scrub is never mistaken for a broken encoder.
  // - Backwards: the encoder moved kCheckBackwardsMeters against a strong push.
  // - Not counting: the encoder stayed within kCheckSilentMeters while its side got enough push to
  //   travel kDeadEffortMeters and the other side moved kCheckPlannedMeters.
  // - Neither counting: both setpoints moved kCheckPlannedMeters and both encoders stayed within
  //   kCheckSilentMeters for kSilentSeconds.
  private static final double kCheckPlannedMeters = ${float(F.checkPlanned)};
  private static final double kCheckSilentMeters = ${float(F.checkSilent)};
  private static final double kCheckBackwardsMeters = ${float(F.checkBackwards)};
  private static final double kFaultFrictionVolts = ${float(F.faultFriction)};
  private static final double kDeadEffortMeters = ${float(F.deadEffort)};
  private static final double kSilentSeconds = ${float(F.silentTime)};

  /** Set when an encoder could not be trusted; every later trajectory then runs open loop. */
  private static String encoderFault;

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
  private double progress;
  private double rate;
  private double lastTime;
  private double settleTime;
  private double silentTime;
  // Volts applied in the last loop (trajectory frame) and the travel they should have produced.
  private double lastLeftVolts;
  private double lastRightVolts;
  private double leftEffort;
  private double rightEffort;
  // Distance each wheel has moved against a strong push from its motors (a backwards encoder).
  private double leftAgainst;
  private double rightAgainst;
  private double checkedLeft;
  private double checkedRight;
  // Where each encoder last moved, and the other side's reading at that moment.
  private double leftAnchor;
  private double rightAnchor;
  private double rightAtLeftAnchor;
  private double leftAtRightAnchor;
  private double leftBoost;
  private double rightBoost;
  private double turnIntegral;
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

  /** The encoder problem found during an auto, or null. Cleared when the robot code restarts. */
  public static String getEncoderFault() {
    return encoderFault;
  }

  /** Trusts the encoders again (after fixing the problem without restarting the robot code). */
  public static void clearEncoderFault() {
    encoderFault = null;
    SmartDashboard.putString("KOP/Encoder fault", "");
  }

  /** Progress along the trajectory in seconds. Markers trigger on this, not on wall time. */
  public double getProgressSeconds() {
    return progress;
  }

  @Override
  public void initialize() {
    closedLoop = kUseEncoders && drive.hasEncoders() && encoderFault == null;
    mirrored = mirror.getAsBoolean();
    finished = false;
    started = false;
    progress = 0.0;
    rate = 1.0;
    lastTime = 0.0;
    settleTime = 0.0;
    silentTime = 0.0;
    lastLeftVolts = 0.0;
    lastRightVolts = 0.0;
    leftEffort = 0.0;
    rightEffort = 0.0;
    leftAgainst = 0.0;
    rightAgainst = 0.0;
    checkedLeft = 0.0;
    checkedRight = 0.0;
    leftAnchor = 0.0;
    rightAnchor = 0.0;
    rightAtLeftAnchor = 0.0;
    leftAtRightAnchor = 0.0;
    leftBoost = 0.0;
    rightBoost = 0.0;
    turnIntegral = 0.0;
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
    double now = timer.get();
    double dt = Math.max(0.0, Math.min(0.1, now - lastTime));
    lastTime = now;
    double total = trajectory.getTotalTimeSeconds();
    progress = Math.min(total, progress + rate * dt);
    boolean following = progress < total;
    trajectory.sample(progress, setpoint);
    // Feedforward targets the middle of the coming loop period.
    trajectory.sample(
        Math.min(total, progress + rate * kLoopPeriodSeconds / 2.0), feedforwardSetpoint);

    double leftVolts =
        following
            ? feedforward(feedforwardSetpoint.leftVelocity, feedforwardSetpoint.leftAcceleration)
            : 0.0;
    double rightVolts =
        following
            ? feedforward(feedforwardSetpoint.rightVelocity, feedforwardSetpoint.rightAcceleration)
            : 0.0;

    if (!closedLoop) {
      if (following) {
        output(leftVolts, rightVolts);
      } else {
        finish();
      }
      return;
    }

    // Everything below works in the trajectory's frame; a mirrored path swaps the sides.
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

    if (checkEncoders(left, right, dt)) {
      // No encoders from here on: finish the step open loop.
      rate = 1.0;
      if (following) {
        output(leftVolts, rightVolts);
      } else {
        finish();
      }
      return;
    }

    updateOdometry(left, right);
    double shift = following ? steeringShift() : 0.0;
    double leftError = setpoint.leftPosition - shift - left;
    double rightError = setpoint.rightPosition + shift - right;

    if (following) {
      // Slow the clock while the robot lags behind its setpoints, and stop it when far behind.
      double behind =
          Math.max(
              0.0,
              Math.max(
                  lag(setpoint.leftPosition - left, setpoint.leftVelocity),
                  lag(setpoint.rightPosition - right, setpoint.rightVelocity)));
      double target =
          Math.max(
              0.0,
              Math.min(1.0, 1.0 - (behind - kLagSlowMeters) / (kLagStopMeters - kLagSlowMeters)));
      rate =
          target < rate
              ? Math.max(target, rate - kRateDownPerSecond * dt)
              : Math.min(target, rate + kRateUpPerSecond * dt);
    } else {
      settleTime += dt;
      double distanceError = Math.abs(leftError + rightError) / 2.0;
      double turnError = Math.abs(rightError - leftError) / 2.0;
      boolean onTarget = distanceError < kPositionToleranceMeters && turnError < turnTolerance();
      boolean slow = Math.abs(leftVel) < kSettleSpeed && Math.abs(rightVel) < kSettleSpeed;
      if ((onTarget && slow) || settleTime >= kMaxSettleSeconds) {
        finish();
        return;
      }
    }
    if (now > 2.0 * total + 2.0) {
      // Blocked (e.g. against a wall): give up on this step instead of stalling the auto.
      DriverStation.reportWarning(
          "KOP auto: a step could not reach its target in time (robot blocked or too weak for the"
              + " plan), moving on",
          false);
      finish();
      return;
    }

    double headingError = (rightError - leftError) / 2.0;
    if (following) {
      turnIntegral =
          Math.max(
              -kTurnIntegralMaxVolts,
              Math.min(
                  kTurnIntegralMaxVolts,
                  turnIntegral + kPTurn * headingError / kTurnIntegralSeconds * dt));
    } else {
      turnIntegral = 0.0;
    }
    double turnVolts = kPTurn * headingError + turnIntegral;
    leftVolts += kP * leftError + kD * (rate * setpoint.leftVelocity - leftVel) - turnVolts;
    rightVolts += kP * rightError + kD * (rate * setpoint.rightVelocity - rightVel) + turnVolts;
    if (!following) {
      // Settling on the final position: push through static friction, harder while a wheel is stuck.
      leftBoost = boost(leftBoost, leftError, leftVel, dt);
      rightBoost = boost(rightBoost, rightError, rightVel, dt);
      leftVolts += kS * Math.signum(leftError) + leftBoost;
      rightVolts += kS * Math.signum(rightError) + rightBoost;
    }
    output(leftVolts, rightVolts);
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

  private void finish() {
    finished = true;
    lastLeftVolts = 0.0;
    lastRightVolts = 0.0;
    drive.stopDrive();
  }

  /** Limits both sides by the same factor so the robot keeps turning at the planned ratio. */
  private void output(double leftVolts, double rightVolts) {
    double peak = Math.max(Math.abs(leftVolts), Math.abs(rightVolts));
    if (peak > kMaxVoltage) {
      leftVolts *= kMaxVoltage / peak;
      rightVolts *= kMaxVoltage / peak;
    }
    lastLeftVolts = leftVolts;
    lastRightVolts = rightVolts;
    if (mirrored) {
      drive.setWheelVoltages(rightVolts, leftVolts);
      drive.setTargetPose(setpoint.x, kFieldWidthMeters - setpoint.y, -setpoint.heading);
    } else {
      drive.setWheelVoltages(leftVolts, rightVolts);
      drive.setTargetPose(setpoint.x, setpoint.y, setpoint.heading);
    }
  }

  /** Wheel error (m) that keeps the heading within kHeadingToleranceDegrees. */
  private static double turnTolerance() {
    return kTrackWidthMeters / 2.0 * Math.toRadians(kHeadingToleranceDegrees);
  }

  /** Distance a wheel is behind its setpoint along its direction of travel (negative when ahead). */
  private static double lag(double error, double velocity) {
    return Math.abs(velocity) > 0.02 ? error * Math.signum(velocity) : 0.0;
  }

  /**
   * Extra voltage for one wheel while settling (signed). It builds up while the wheel approaches its
   * target too slowly, drains while it is too fast, and resets once the wheel reaches or passes it.
   */
  private static double boost(double current, double error, double velocity, double dt) {
    if (Math.abs(error) <= turnTolerance() / 2.0 || current * error < 0.0) {
      return 0.0;
    }
    double toward = velocity * Math.signum(error);
    double wanted = Math.min(kApproachSpeed, kApproachGain * Math.abs(error));
    double size = Math.abs(current);
    if (toward < wanted * 0.75) {
      size = Math.min(kBoostMaxVolts, size + kBoostVoltsPerSecond * dt);
    } else if (toward > wanted * 1.25) {
      size = Math.max(0.0, size - kBoostVoltsPerSecond * dt);
    }
    return size * Math.signum(error);
  }

  /**
   * Compares how each side's encoder moved with how hard its motors pushed (and, when neither moves,
   * with the setpoints). Returns true, and stops using the encoders, when one cannot be trusted.
   */
  private boolean checkEncoders(double left, double right, double dt) {
    // A wheel reads backwards when its encoder keeps moving against a strong push from its motors:
    // with the sign wrong, every correction drives it further the wrong way. A wheel held by
    // friction does not move, and a braking wheel only coasts a little against the push.
    leftAgainst = against(leftAgainst, left - checkedLeft, lastLeftVolts, dt);
    rightAgainst = against(rightAgainst, right - checkedRight, lastRightVolts, dt);
    checkedLeft = left;
    checkedRight = right;
    // A dead encoder stays put while its side is driven hard and the other side keeps moving. The
    // effort restarts whenever the encoder moves, so a wheel that pauses (held by friction, or
    // turning around on a tight curve) does not add up.
    if (Math.abs(left - leftAnchor) >= kCheckSilentMeters) {
      leftAnchor = left;
      leftEffort = 0.0;
      rightAtLeftAnchor = right;
    }
    if (Math.abs(right - rightAnchor) >= kCheckSilentMeters) {
      rightAnchor = right;
      rightEffort = 0.0;
      leftAtRightAnchor = left;
    }
    leftEffort += push(lastLeftVolts, dt);
    rightEffort += push(lastRightVolts, dt);
    boolean leftDead =
        leftEffort > kDeadEffortMeters && Math.abs(right - rightAtLeftAnchor) > kCheckPlannedMeters;
    boolean rightDead =
        rightEffort > kDeadEffortMeters && Math.abs(left - leftAtRightAnchor) > kCheckPlannedMeters;
    String leftKind =
        leftAgainst > kCheckBackwardsMeters ? "backwards" : leftDead ? "not counting" : null;
    String rightKind =
        rightAgainst > kCheckBackwardsMeters ? "backwards" : rightDead ? "not counting" : null;
    String message = null;
    if (leftKind != null || rightKind != null) {
      // Report the physical side: a mirrored path swapped them.
      boolean physicalLeft = (leftKind != null) != mirrored;
      message = faultMessage(physicalLeft, leftKind != null ? leftKind : rightKind);
    } else {
      // Both silent while both setpoints moved: wait a moment in case the robot is slow to start.
      boolean bothSilent =
          silent(setpoint.leftPosition, left) && silent(setpoint.rightPosition, right);
      silentTime = bothSilent ? silentTime + dt : 0.0;
      if (silentTime > kSilentSeconds) {
        message = "neither encoder is counting. Check their wiring, ports or CAN IDs.";
      }
    }
    if (message == null) {
      return false;
    }
    encoderFault = message;
    closedLoop = false;
    DriverStation.reportError("KOP auto: " + message + " Finishing the auto open loop.", false);
    SmartDashboard.putString("KOP/Encoder fault", message);
    return true;
  }

  /** Travel (m) the volts above friction should produce in dt. */
  private static double push(double volts, double dt) {
    return Math.max(0.0, Math.abs(volts) - kS - kFaultFrictionVolts) * dt / Math.max(0.1, kV);
  }

  private static String faultMessage(boolean left, String kind) {
    String side = left ? "left" : "right";
    String constant = left ? "kInvertLeft" : "kInvertRight";
    if (kind.equals("backwards")) {
      return "the "
          + side
          + " side moved the opposite way to its motors. If the "
          + side
          + " wheels turned the wrong way, flip "
          + constant
          + "; otherwise flip "
          + constant
          + "Encoder.";
    }
    return "the "
        + side
        + " side is not moving or its encoder is not counting. Check the encoder wiring, ports or"
        + " CAN ID (a thrown chain or tripped breaker looks the same).";
  }

  /** Adds a wheel's movement against a strong push to {@code total}; moving with the push clears it. */
  private static double against(double total, double moved, double volts, double dt) {
    if (push(volts, dt) > 0.0 && moved * volts < 0.0) {
      return total + Math.abs(moved);
    }
    return moved * volts > 0.0 ? 0.0 : total;
  }

  private static boolean silent(double planned, double measured) {
    return Math.abs(planned) > kCheckPlannedMeters && Math.abs(measured) < kCheckSilentMeters;
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
    double gain = kLateral * Math.min(1.0, kSteerRefSpeed / Math.abs(velocity));
    double steer =
        Math.max(-kMaxSteerRadians, Math.min(kMaxSteerRadians, Math.atan(gain * lateralError)));
    return Math.signum(velocity) * speedScale * steer * kTrackWidthMeters / 2.0;
  }

  private double feedforward(double velocity, double acceleration) {
    double direction =
        Math.abs(velocity) > 1e-4
            ? Math.signum(velocity)
            : Math.abs(acceleration) > 1e-4 ? Math.signum(acceleration) : 0.0;
    return kS * direction + kV * rate * velocity + kA * rate * rate * acceleration;
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
    'edu.wpi.first.math.MathUtil',
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
      '    // Average the rate over a whole encoder cycle (4x decoding) for a steadier speed reading.',
      '    leftEncoder.setSamplesToAverage(4);',
      '    rightEncoder.setSamplesToAverage(4);',
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
 * <p>${encoderDoc} Before running autos, check the directions. The front is the ${robot.front} end,
 * and left and right are seen from behind it. With the robot disabled, roll it towards its front
 * (or turn the wheels that way on blocks) and watch KOP/Left distance and KOP/Right distance on the
 * dashboard. Both must go up; flip kInvert*Encoder in KopDriveConstants if not. Then drive forward
 * in teleop: the ${robot.front} end must lead. If a side spins backwards, flip kInvertLeft/kInvertRight.
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
${enc === 'none' ? '    // No encoders: the wheel balance evens out the sides by voltage.\n    leftVolts /= kLeftDistanceScale;\n    rightVolts /= kRightDistanceScale;\n' : ''}${setVolts.join('\n')}
  }

  /** Open loop percent output per side, -1 to 1. */
  public void tankDrivePercent(double left, double right) {
${setPercent.join('\n')}
  }

  /** Arcade drive for teleop. Rotation is counter-clockwise positive. */
  public void arcadeDrive(double forward, double rotation) {
    DifferentialDrive.WheelSpeeds speeds =
        DifferentialDrive.arcadeDriveIK(
            MathUtil.applyDeadband(forward, kJoystickDeadband),
            MathUtil.applyDeadband(rotation, kJoystickDeadband),
            true);
    tankDrivePercent(speeds.left, speeds.right);
  }

  /** Default teleop command, e.g. arcadeDriveCommand(() -> -stick.getLeftY(), () -> -stick.getRightX()). */
  public Command arcadeDriveCommand(DoubleSupplier forward, DoubleSupplier rotation) {
    return run(() -> arcadeDrive(forward.getAsDouble(), rotation.getAsDouble()))
        .withName("Arcade Drive");
  }

  @Override
  public double getLeftDistanceMeters() {
    return ${enc === 'none' ? leftDist : `kLeftDistanceScale * ${leftDist}`};
  }

  @Override
  public double getRightDistanceMeters() {
    return ${enc === 'none' ? rightDist : `kRightDistanceScale * ${rightDist}`};
  }

  @Override
  public double getLeftVelocityMetersPerSecond() {
    return ${enc === 'none' ? leftVel : `kLeftDistanceScale * ${leftVel}`};
  }

  @Override
  public double getRightVelocityMetersPerSecond() {
    return ${enc === 'none' ? rightVel : `kRightDistanceScale * ${rightVel}`};
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
    // Roll the robot forward by hand: both distances must go up (see KOP_AUTOS_README.md).
    SmartDashboard.putNumber("KOP/Left distance (m)", left);
    SmartDashboard.putNumber("KOP/Right distance (m)", right);
    SmartDashboard.putNumber("KOP/Left speed (m per s)", getLeftVelocityMetersPerSecond());
    SmartDashboard.putNumber("KOP/Right speed (m per s)", getRightVelocityMetersPerSecond());
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
      if (step.markers.length === 0) return `follow(drive, mirror, ${dataClass}.${step.data})`;
      const markers = step.markers.map((m) => `marker(${float(m.time, 3)}, ${quote(m.name)})`);
      return `follow(\n                drive,\n                mirror,\n                ${dataClass}.${step.data},\n                ${markers.join(',\n                ')})`;
    }
  }
}

const JAVA_RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'float', 'for', 'goto',
  'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package',
  'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
  'this', 'throw', 'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while', 'var', 'record', 'yield',
  'start', 'follow', 'marker', 'buildChooser',
]);

function javaMethodNames(autos: IRAuto[]): string[] {
  return uniqueNames(autos.map((a) => avoidReserved(camelCase(a.words), JAVA_RESERVED, 'Auto')));
}

/** A KopTrajectory field parsed from text blocks of sample rows. */
function trajectoryField(modifiers: string, name: string, samples: TrajState[]): string {
  const blocks: string[] = [];
  for (let k = 0; k < samples.length; k += ROWS_PER_BLOCK) {
    const rows = samples.slice(k, k + ROWS_PER_BLOCK).map((s) => `            ${formatRow(s).join(',')}`);
    blocks.push(`        """\n${rows.join('\n')}\n            """`);
  }
  return `    ${modifiers} KopTrajectory ${name} =\n        KopTrajectory.parse(\n${blocks.join(',\n')});`;
}

function testsFile(pkg: string, project: Project): string {
  const r = project.robot;
  const encoders = effectiveEncoder(r) !== 'none';
  const { drive, turn } = testTrajectories(project);
  const halfTurn = (r.trackWidth / 2) * 2 * Math.PI;
  // Both reports name the settings this code was generated with: the planner's Calibration
  // section must start from those.
  const driveAdvice = encoders
    ? `"drive 2 m: the encoders measured left %.3f m, right %.3f m. Measure how far the robot"
                              + " really went, and how far it ended left or right of a straight line, and"
                              + " enter both on the planner's Robot tab, under Calibration (this code:"
                              + " wheel diameter %.4f m, wheel balance %.4f)."`
    : `"drive 2 m (open loop). Measure how far the robot really went, and how far it ended"
                              + " left or right of a straight line, and enter both on the planner's Robot"
                              + " tab, under Calibration (this code: kV %.3f, wheel balance %.4f)."`;
  const driveArgs = encoders ? 'left, right, kWheelDiameterMeters, kWheelBalance' : 'kV, kWheelBalance';
  const turnAdvice = encoders
    ? `"turn 360: the robot turned left (counter-clockwise); the encoders measured left %.3f m,"
                              + " right %.3f m (planned ${float(-halfTurn, 3)} / ${float(halfTurn, 3)} m). Check whether the front stopped"
                              + " short of the start line or went past it, and by how many degrees, and enter"
                              + " that on the planner's Robot tab, under Calibration (this code: track width"
                              + " %.4f m)."`
    : `"turn 360 (open loop): the robot turned left (counter-clockwise). Check whether the"
                              + " front stopped short of the start line or went past it, and by how many"
                              + " degrees, and enter that on the planner's Robot tab, under Calibration (this"
                              + " code: track width %.4f m)."`;
  const turnArgs = encoders ? 'left, right, kTrackWidthMeters' : 'kTrackWidthMeters';
  return `package ${pkg};

import static ${pkg}.KopDriveConstants.*;

import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj.smartdashboard.SendableChooser;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;

/**
 * Calibration autos for the real robot. Run them in autonomous on carpet with room around the
 * robot, then read the result in the Driver Station console (also on the dashboard as KOP/Test
 * result) and enter what the robot really did on the planner's Robot tab, under Calibration. Run
 * both tests with the same code; the planner corrects the two settings together.
 *
 * <ul>
 *   <li><b>Test: drive 2 m</b> drives straight ahead. Measure how far the robot really went and how
 *       far it ended to the left or right of a straight line (tape a line along a bumper first).
 *   <li><b>Test: turn 360</b> turns one full circle to the left. Put a strip of tape along a bumper
 *       first, then check whether the front stopped short of the start line or went past it.${
    encoders
      ? `
 *   <li><b>Test: measure feedforward</b> slowly ramps the voltage, about 1.5 m forwards and back
 *       again, and fits kS and kV to the measured speeds.`
      : ''
  }
 * </ul>
 */
public final class KopCalibration {
  private static final double kRampVoltsPerSecond = 0.75;
  private static final double kRampMaxVolts = 7.0;
  private static final double kRampDistanceMeters = 1.5;
  private static final double kRampPauseSeconds = 1.0;
  private static final double kMinSpeed = 0.05;

  private KopCalibration() {}

  /** Adds the tests to an auto chooser. */
  public static void addTo(SendableChooser<Command> chooser, KopDrive drive) {
    chooser.addOption("Test: drive 2 m", driveTest(drive));
    chooser.addOption("Test: turn 360\\u00b0", turnTest(drive));${
      encoders ? `
    chooser.addOption("Test: measure feedforward", new MeasureFeedforward(drive));` : ''
    }
  }

  /** Drives ${TEST_DRIVE_METERS} m straight ahead and reports what the encoders measured. */
  public static Command driveTest(KopDrive drive) {
    double[] start = new double[2];
    return Commands.sequence(
            Commands.runOnce(
                () -> {
                  start[0] = drive.getLeftDistanceMeters();
                  start[1] = drive.getRightDistanceMeters();
                  drive.resetPose(0.0, 0.0, 0.0);
                }),
            new FollowKopTrajectory(drive, DRIVE),
            Commands.waitSeconds(0.5),
            Commands.runOnce(
                () -> {
                  double left = drive.getLeftDistanceMeters() - start[0];
                  double right = drive.getRightDistanceMeters() - start[1];
                  report(
                      String.format(
                          ${driveAdvice},
                          ${driveArgs}));
                }))
        .withName("Test: drive 2 m");
  }

  /** Turns one full circle to the left in place and reports what the encoders measured. */
  public static Command turnTest(KopDrive drive) {
    double[] start = new double[2];
    return Commands.sequence(
            Commands.runOnce(
                () -> {
                  start[0] = drive.getLeftDistanceMeters();
                  start[1] = drive.getRightDistanceMeters();
                  drive.resetPose(0.0, 0.0, 0.0);
                }),
            new FollowKopTrajectory(drive, TURN),
            Commands.waitSeconds(0.5),
            Commands.runOnce(
                () -> {
                  double left = drive.getLeftDistanceMeters() - start[0];
                  double right = drive.getRightDistanceMeters() - start[1];
                  report(
                      String.format(
                          ${turnAdvice},
                          ${turnArgs}));
                }))
        .withName("Test: turn 360\\u00b0");
  }

  private static void report(String message) {
    DriverStation.reportWarning("KOP test: " + message, false);
    SmartDashboard.putString("KOP/Test result", message);
  }
${
  encoders
    ? `
  /**
   * Ramps the voltage slowly, forwards until a wheel has driven ${float(1.5, 1)} m and then backwards for
   * as long, and fits kS (volts to get moving) and kV (volts per m/s) to the measured speeds.
   */
  private static final class MeasureFeedforward extends Command {
    private final KopDrive drive;
    private final Timer timer = new Timer();
    private final Fit left = new Fit();
    private final Fit right = new Fit();
    private int phase;
    private double phaseStart;
    private double forwardSeconds;
    private double leftStart;
    private double rightStart;

    MeasureFeedforward(KopDrive drive) {
      this.drive = drive;
      addRequirements(drive);
      setName("Test: measure feedforward");
    }

    @Override
    public void initialize() {
      left.clear();
      right.clear();
      phase = 0;
      phaseStart = 0.0;
      leftStart = drive.getLeftDistanceMeters();
      rightStart = drive.getRightDistanceMeters();
      timer.restart();
    }

    @Override
    public void execute() {
      double now = timer.get();
      double t = now - phaseStart;
      double travelled =
          Math.max(
              Math.abs(drive.getLeftDistanceMeters() - leftStart),
              Math.abs(drive.getRightDistanceMeters() - rightStart));
      double volts = 0.0;
      if (phase == 0) {
        volts = kRampVoltsPerSecond * t;
        if (volts > kRampMaxVolts || travelled > kRampDistanceMeters) {
          phase = 1;
          phaseStart = now;
          forwardSeconds = t;
          volts = 0.0;
        }
      } else if (phase == 1) {
        if (t > kRampPauseSeconds) {
          phase = 2;
          phaseStart = now;
        }
      } else if (phase == 2) {
        // Same ramp backwards, for as long, so the robot ends up near where it started.
        volts = -kRampVoltsPerSecond * t;
        if (t > forwardSeconds) {
          phase = 3;
          volts = 0.0;
        }
      }
      drive.setWheelVoltages(volts, volts);
      if (volts != 0.0) {
        left.add(volts, drive.getLeftVelocityMetersPerSecond());
        right.add(volts, drive.getRightVelocityMetersPerSecond());
      }
    }

    @Override
    public boolean isFinished() {
      return phase == 3;
    }

    @Override
    public void end(boolean interrupted) {
      drive.stopDrive();
      if (!interrupted) {
        report(summary());
      }
    }

    private String summary() {
      String leftProblem = left.problem("left", "Left");
      String rightProblem = right.problem("right", "Right");
      if (leftProblem != null || rightProblem != null) {
        return "feedforward: "
            + (leftProblem != null ? leftProblem : "")
            + (leftProblem != null && rightProblem != null ? "; " : "")
            + (rightProblem != null ? rightProblem : "")
            + ".";
      }
      String result =
          String.format(
              "feedforward: kS = %.2f V, kV = %.2f V per m/s (left %.2f / %.2f, right %.2f /"
                  + " %.2f). Enter kS and kV on the planner's Robot tab and generate the code again.",
              (left.kS() + right.kS()) / 2.0,
              (left.kV() + right.kV()) / 2.0,
              left.kS(),
              left.kV(),
              right.kS(),
              right.kV());
      double ratio = left.kV() / right.kV();
      if (ratio > 1.1 || ratio < 1.0 / 1.1) {
        result +=
            String.format(
                " The %s side needs %.0f%% more voltage for the same speed: check it for friction"
                    + " (chain tension, bearings, a weak motor).",
                ratio > 1.0 ? "left" : "right",
                (Math.max(ratio, 1.0 / ratio) - 1.0) * 100.0);
      }
      return result;
    }
  }

  /** Least-squares fit of |volts| = kS + kV * |speed| over samples where the wheel moved as driven. */
  private static final class Fit {
    private int count;
    private int wrongWay;
    private double sumX;
    private double sumY;
    private double sumXX;
    private double sumXY;

    void clear() {
      count = 0;
      wrongWay = 0;
      sumX = 0.0;
      sumY = 0.0;
      sumXX = 0.0;
      sumXY = 0.0;
    }

    void add(double volts, double speed) {
      if (Math.abs(speed) < kMinSpeed) {
        return;
      }
      if (Math.signum(speed) != Math.signum(volts)) {
        wrongWay++;
        return;
      }
      double x = Math.abs(speed);
      double y = Math.abs(volts);
      count++;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }

    double kV() {
      double d = count * sumXX - sumX * sumX;
      return Math.abs(d) < 1e-9 ? 0.0 : (count * sumXY - sumX * sumY) / d;
    }

    double kS() {
      if (count == 0) {
        return 0.0;
      }
      // The ramp still accelerates the robot (by about ramp / kV): take that kA * a back out.
      double kv = kV();
      double accelerationVolts = kv > 0.1 ? kA * kRampVoltsPerSecond / kv : 0.0;
      return (sumY - kv * sumX) / count - accelerationVolts;
    }

    String problem(String side, String constantSide) {
      if (wrongWay > count) {
        return "the "
            + side
            + " side moved the opposite way to its motors (flip kInvert"
            + constantSide
            + " if the wheels turned backwards, otherwise kInvert"
            + constantSide
            + "Encoder)";
      }
      if (count < 10) {
        return "the " + side + " side hardly moved or its encoder is not counting";
      }
      return null;
    }
  }
`
    : ''
}
${trajectoryField('private static final', 'DRIVE', drive)}

${trajectoryField('private static final', 'TURN', turn)}
}
`;
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

    const trajFields = auto.trajectories.map((tr) => trajectoryField('static final', tr.name, tr.samples));
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

  /**
   * Builds a chooser containing every generated auto, "Do Nothing" (the default) and the
   * calibration tests from {@link KopCalibration}.
   */
  public static SendableChooser<Command> buildChooser(KopDrive drive, BooleanSupplier mirror) {
    SendableChooser<Command> chooser = new SendableChooser<>();
    chooser.setDefaultOption("Do Nothing", Commands.none());
${chooserLines.join('\n')}
    KopCalibration.addTo(chooser, drive);
    return chooser;
  }

  public static SendableChooser<Command> buildChooser(KopDrive drive) {
    return buildChooser(drive, () -> false);
  }

${methods.join('\n\n')}

  /** A named command that starts when the robot reaches a point of the path. */
  private record Marker(double seconds, String name) {}

  private static Marker marker(double seconds, String name) {
    return new Marker(seconds, name);
  }

  /**
   * Follows a trajectory. Markers start when the follower's progress reaches their time, so they
   * stay at the right place on the path even when the robot runs slower than planned.
   */
  private static Command follow(
      KopDrive drive, BooleanSupplier mirror, KopTrajectory trajectory, Marker... markers) {
    FollowKopTrajectory follower = new FollowKopTrajectory(drive, trajectory, mirror);
    if (markers.length == 0) {
      return follower;
    }
    Command[] parallel = new Command[markers.length];
    for (int i = 0; i < markers.length; i++) {
      Marker marker = markers[i];
      parallel[i] =
          Commands.waitUntil(() -> follower.getProgressSeconds() >= marker.seconds())
              .andThen(KopNamedCommands.get(marker.name()));
    }
    return Commands.deadline(follower, parallel);
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

function readmeFile(pkg: string, autos: IRAuto[], methodNames: string[], pwmOnly: boolean, encoders: boolean, front: RobotFront): string {
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
| \`KopCalibration.java\` | Calibration autos (drive 2 m, turn 360°${encoders ? ', measure feedforward' : ''}). |

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

${realRobotChecklist('java', encoders, front)}`;
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
    { path: `${dir}/KopCalibration.java`, content: testsFile(pkg, project) },
    { path: 'KOP_AUTOS_README.md', content: readmeFile(pkg, autos, methodNames, CONTROLLERS[project.robot.controller].family === 'pwm', effectiveEncoder(project.robot) !== 'none', project.robot.front) },
  ];
}
