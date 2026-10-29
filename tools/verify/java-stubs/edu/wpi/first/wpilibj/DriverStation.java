package edu.wpi.first.wpilibj;
public final class DriverStation {
  /** Harness hook: the last message reported (not part of WPILib). */
  public static String lastReport;
  public static void reportWarning(String w, boolean trace) { lastReport = w; }
  public static void reportError(String e, boolean trace) { lastReport = e; }
}
