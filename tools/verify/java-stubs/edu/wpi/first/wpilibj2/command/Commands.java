package edu.wpi.first.wpilibj2.command;
public final class Commands {
  public static Command none() { return null; }
  public static Command print(String m) { return null; }
  public static Command waitSeconds(double s) { return null; }
  public static Command waitUntil(java.util.function.BooleanSupplier condition) { return null; }
  public static Command runOnce(Runnable r, Subsystem... reqs) { return null; }
  public static Command sequence(Command... c) { return null; }
  public static Command deadline(Command d, Command... others) { return null; }
}
