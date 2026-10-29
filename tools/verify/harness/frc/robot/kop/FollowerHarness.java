package frc.robot.kop;

import static frc.robot.kop.KopDriveConstants.*;

import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.Timer;

/**
 * Runs a generated trajectory through FollowKopTrajectory against a drivetrain plant (kS, kV, kA
 * per side) that does not match the constants, and checks where the wheels end up. Usage:
 * FollowerHarness Class FIELD, e.g. FollowerHarness 'KopAutos$TwoPieceData' DRIVE_1.
 */
public class FollowerHarness {
  /** How the simulated robot differs from the constants. */
  record Robot(
      String name,
      double leftScale,
      double kSScale,
      double kVScale,
      double kAScale,
      double scrubVolts,
      double leftEncoder,
      double rightEncoder,
      boolean canDelay) {}

  static class FakeDrive extends edu.wpi.first.wpilibj2.command.SubsystemBase implements KopDrive {
    final Robot robot;
    double leftPos;
    double rightPos;
    double leftVel;
    double rightVel;
    double leftVolts;
    double rightVolts;
    // Readings as the follower sees them: one loop late with CAN encoders.
    double[] reading = new double[4];

    FakeDrive(Robot robot) {
      this.robot = robot;
    }

    public void setWheelVoltages(double l, double r) {
      leftVolts = l;
      rightVolts = r;
    }

    public double getLeftDistanceMeters() {
      return robot.canDelay() ? reading[0] : leftPos * robot.leftEncoder();
    }

    public double getRightDistanceMeters() {
      return robot.canDelay() ? reading[1] : rightPos * robot.rightEncoder();
    }

    public double getLeftVelocityMetersPerSecond() {
      return robot.canDelay() ? reading[2] : leftVel * robot.leftEncoder();
    }

    public double getRightVelocityMetersPerSecond() {
      return robot.canDelay() ? reading[3] : rightVel * robot.rightEncoder();
    }

    public boolean hasEncoders() {
      return kUseEncoders;
    }

    /** Returns {position, velocity} after dt. */
    double[] side(double pos, double vel, double volts, double friction, double dt) {
      double kv = kV * robot.kVScale();
      double ka = kA * robot.kAScale();
      if (Math.abs(vel) < 1e-3 && Math.abs(volts) <= friction) {
        return new double[] {pos, 0};
      }
      double dir = Math.abs(vel) >= 1e-3 ? Math.signum(vel) : Math.signum(volts);
      double acc = (volts - friction * dir - kv * vel) / ka;
      double next = vel + acc * dt;
      if (Math.abs(vel) >= 1e-3 && Math.signum(next) != Math.signum(vel)) {
        next = 0;
      }
      return new double[] {pos + next * dt, next};
    }

    void step(double dt) {
      reading =
          new double[] {
            leftPos * robot.leftEncoder(),
            rightPos * robot.rightEncoder(),
            leftVel * robot.leftEncoder(),
            rightVel * robot.rightEncoder()
          };
      for (int i = 0; i < 10; i++) {
        double l = Math.max(-12, Math.min(12, leftVolts)) * robot.leftScale();
        double r = Math.max(-12, Math.min(12, rightVolts));
        // Tread scrub: extra friction while turning.
        double a = Math.abs(leftVel) + Math.abs(rightVel) > 1e-3 ? leftVel : l;
        double b = Math.abs(leftVel) + Math.abs(rightVel) > 1e-3 ? rightVel : r;
        double sum = Math.abs(a) + Math.abs(b);
        double turning = sum > 1e-6 ? Math.abs(b - a) / sum : 0;
        double friction = kS * robot.kSScale() + robot.scrubVolts() * turning;
        double[] left = side(leftPos, leftVel, l, friction, dt / 10);
        leftPos = left[0];
        leftVel = left[1];
        double[] right = side(rightPos, rightVel, r, friction, dt / 10);
        rightPos = right[0];
        rightVel = right[1];
      }
    }
  }

  public static void main(String[] args) throws Exception {
    var field = Class.forName("frc.robot.kop." + args[0]).getDeclaredField(args[1]);
    field.setAccessible(true);
    KopTrajectory trajectory = (KopTrajectory) field.get(null);
    KopTrajectory.State end = trajectory.sample(1e9, new KopTrajectory.State());
    double turnTolerance = kTrackWidthMeters / 2.0 * Math.toRadians(0.75);
    Robot[] robots = {
      new Robot("matches the model", 1.0, 1.0, 1.0, 1.0, 0.0, 1, 1, false),
      new Robot("left side -5%", 0.95, 1.0, 1.0, 1.0, 0.0, 1, 1, false),
      new Robot("heavy, slow, scrubbing", 0.92, 1.4, 1.15, 1.5, 2.0, 1, 1, false),
      new Robot("CAN encoders a loop late, left -10%", 0.9, 1.0, 1.0, 1.0, 0.0, 1, 1, true),
      new Robot("CAN delay, heavy, slow, scrubbing", 0.92, 1.4, 1.15, 1.5, 2.0, 1, 1, true),
      new Robot("left encoder backwards", 1.0, 1.0, 1.0, 1.0, 0.0, -1, 1, false),
    };
    boolean ok = true;
    for (Robot robot : robots) {
      boolean faulty = robot.leftEncoder() < 0;
      if (faulty && !kUseEncoders) {
        continue;
      }
      FollowKopTrajectory.clearEncoderFault();
      FakeDrive drive = new FakeDrive(robot);
      FollowKopTrajectory command = new FollowKopTrajectory(drive, trajectory);
      Timer.now = 0;
      command.initialize();
      int loops = 0;
      double farthest = 0;
      while (!command.isFinished() && loops < 5000) {
        command.execute();
        drive.step(0.02);
        Timer.now += 0.02;
        farthest = Math.max(farthest, Math.max(Math.abs(drive.leftPos), Math.abs(drive.rightPos)));
        loops++;
      }
      command.end(false);
      double leftError = end.leftPosition - drive.leftPos;
      double rightError = end.rightPosition - drive.rightPos;
      double distanceError = Math.abs(leftError + rightError) / 2;
      double turnError = Math.abs(rightError - leftError) / 2;
      double planned = Math.max(Math.abs(end.leftPosition), Math.abs(end.rightPosition));
      boolean pass;
      String detail;
      if (faulty) {
        // The follower must notice, say how to fix it, and not run away.
        String fault = FollowKopTrajectory.getEncoderFault();
        pass =
            fault != null
                && fault.contains("kInvertLeftEncoder")
                && DriverStation.lastReport != null
                && farthest < planned + 1.0
                && loops < 5000;
        detail = "fault: " + fault;
      } else {
        pass =
            loops < 5000
                && (!kUseEncoders
                    || (distanceError < kPositionToleranceMeters * 1.5
                        && turnError < turnTolerance * 1.5
                        && FollowKopTrajectory.getEncoderFault() == null));
        detail = String.format("distance error %.3f m, turn error %.4f m", distanceError, turnError);
      }
      ok &= pass;
      System.out.printf(
          "%s %s %s, %s: %.2fs (plan %.2fs) %s%n",
          pass ? "ok  " : "FAIL",
          args[0],
          args[1],
          robot.name(),
          Timer.now,
          trajectory.getTotalTimeSeconds(),
          detail);
    }
    System.exit(ok ? 0 : 1);
  }
}
