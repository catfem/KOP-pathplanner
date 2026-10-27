package com.revrobotics.spark.config;
public abstract class SparkBaseConfig {
  public enum IdleMode { kCoast, kBrake }
  public SparkBaseConfig idleMode(IdleMode m) { return this; }
  public SparkBaseConfig smartCurrentLimit(int a) { return this; }
}
