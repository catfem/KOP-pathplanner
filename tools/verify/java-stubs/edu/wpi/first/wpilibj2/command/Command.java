package edu.wpi.first.wpilibj2.command;
public abstract class Command implements edu.wpi.first.util.sendable.Sendable {
  protected Command() {}
  public void initialize() {} public void execute() {} public void end(boolean interrupted) {} public boolean isFinished() { return false; }
  public final void addRequirements(Subsystem... requirements) {}
  public Command withName(String name) { return this; }
  public Command andThen(Command... next) { return this; }
}
