package com.ctre.phoenix.motorcontrol.can;
import com.ctre.phoenix.ErrorCode;
public class TalonSRX extends BaseMotorController {
  public TalonSRX(int id) {}
  public ErrorCode configContinuousCurrentLimit(int a) { return ErrorCode.OK; }
  public ErrorCode configPeakCurrentLimit(int a) { return ErrorCode.OK; }
  public void enableCurrentLimit(boolean e) {}
}
