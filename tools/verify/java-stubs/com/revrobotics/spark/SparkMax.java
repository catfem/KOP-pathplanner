package com.revrobotics.spark;
import com.revrobotics.*;
public class SparkMax extends SparkLowLevel {
  public SparkMax(int id, MotorType t) {}
  public REVLibError configure(com.revrobotics.spark.config.SparkBaseConfig c, ResetMode r, PersistMode p) { return REVLibError.kOk; }
  public RelativeEncoder getEncoder() { return null; }
  public void set(double s) {} public void setVoltage(double v) {}
}
