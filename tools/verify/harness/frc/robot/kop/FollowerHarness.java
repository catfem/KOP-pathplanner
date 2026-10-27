package frc.robot.kop;

import static frc.robot.kop.KopDriveConstants.*;

import edu.wpi.first.wpilibj.Timer;

/**
 * Runs a generated trajectory through FollowKopTrajectory against a simple drivetrain plant (kS,
 * kV, kA per side) and checks the wheels end on target. Usage: FollowerHarness DataClass FIELD.
 */
public class FollowerHarness {
  static class FakeDrive extends edu.wpi.first.wpilibj2.command.SubsystemBase implements KopDrive {
    double leftPos;
    double rightPos;
    double leftVel;
    double rightVel;
    double leftVolts;
    double rightVolts;
    final double leftScale;

    FakeDrive(double leftScale) {
      this.leftScale = leftScale;
    }

    public void setWheelVoltages(double l, double r) {
      leftVolts = l;
      rightVolts = r;
    }

    public double getLeftDistanceMeters() {
      return leftPos;
    }

    public double getRightDistanceMeters() {
      return rightPos;
    }

    public double getLeftVelocityMetersPerSecond() {
      return leftVel;
    }

    public double getRightVelocityMetersPerSecond() {
      return rightVel;
    }

    public boolean hasEncoders() {
      return kUseEncoders;
    }

    /** Returns {position, velocity} after dt. */
    static double[] side(double pos, double vel, double volts, double dt) {
      if (Math.abs(vel) < 1e-3 && Math.abs(volts) <= kS) {
        return new double[] {pos, 0};
      }
      double dir = Math.abs(vel) >= 1e-3 ? Math.signum(vel) : Math.signum(volts);
      double acc = (volts - kS * dir - kV * vel) / kA;
      double next = vel + acc * dt;
      if (Math.abs(vel) >= 1e-3 && Math.signum(next) != Math.signum(vel)) {
        next = 0;
      }
      return new double[] {pos + next * dt, next};
    }

    void step(double dt) {
      for (int i = 0; i < 10; i++) {
        double[] l = side(leftPos, leftVel, leftVolts * leftScale, dt / 10);
        leftPos = l[0];
        leftVel = l[1];
        double[] r = side(rightPos, rightVel, rightVolts, dt / 10);
        rightPos = r[0];
        rightVel = r[1];
      }
    }
  }

  public static void main(String[] args) throws Exception {
    var field = Class.forName("frc.robot.kop.KopAutos$" + args[0]).getDeclaredField(args[1]);
    field.setAccessible(true);
    KopTrajectory trajectory = (KopTrajectory) field.get(null);
    KopTrajectory.State end = trajectory.sample(1e9, new KopTrajectory.State());
    boolean ok = true;
    for (double scale : new double[] {1.0, 0.95}) {
      FakeDrive drive = new FakeDrive(scale);
      FollowKopTrajectory command = new FollowKopTrajectory(drive, trajectory);
      Timer.now = 0;
      command.initialize();
      int loops = 0;
      while (!command.isFinished() && loops < 5000) {
        command.execute();
        drive.step(0.02);
        Timer.now += 0.02;
        loops++;
      }
      command.end(false);
      double error = Math.max(Math.abs(drive.leftPos - end.leftPosition), Math.abs(drive.rightPos - end.rightPosition));
      boolean pass = !kUseEncoders || error < 0.03;
      ok &= pass;
      System.out.printf(
          "%s %s %s leftScale=%.2f: %.2fs (plan %.2fs) wheel error %.3f m%n",
          pass ? "ok  " : "FAIL",
          args[0],
          args[1],
          scale,
          Timer.now,
          trajectory.getTotalTimeSeconds(),
          error);
    }
    System.exit(ok ? 0 : 1);
  }
}
