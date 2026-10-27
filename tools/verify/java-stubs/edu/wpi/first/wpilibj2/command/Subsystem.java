package edu.wpi.first.wpilibj2.command;
public interface Subsystem { default void periodic() {} default Command run(Runnable r) { return null; } default void setDefaultCommand(Command c) {} }
