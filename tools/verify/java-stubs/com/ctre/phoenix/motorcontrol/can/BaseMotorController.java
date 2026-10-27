package com.ctre.phoenix.motorcontrol.can;
import com.ctre.phoenix.ErrorCode; import com.ctre.phoenix.motorcontrol.*;
public abstract class BaseMotorController implements IMotorController {
  public ErrorCode configFactoryDefault() { return ErrorCode.OK; }
  public void setNeutralMode(NeutralMode m) {}
  public void follow(IMotorController leader) {}
  public ErrorCode configSelectedFeedbackSensor(FeedbackDevice d, int pidIdx, int timeoutMs) { return ErrorCode.OK; }
  public double getSelectedSensorPosition() { return 0; }
  public double getSelectedSensorVelocity() { return 0; }
}
