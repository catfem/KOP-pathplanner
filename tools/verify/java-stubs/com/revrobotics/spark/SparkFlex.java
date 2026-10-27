package com.revrobotics.spark;
import com.revrobotics.*;
public class SparkFlex extends SparkLowLevel {
  public SparkFlex(int id, MotorType t) {}
  public REVLibError configure(com.revrobotics.spark.config.SparkBaseConfig c, ResetMode r, PersistMode p) { return REVLibError.kOk; }
  public RelativeEncoder getEncoder() { return null; }
  public void set(double s) {} public void setVoltage(double v) {}
}
