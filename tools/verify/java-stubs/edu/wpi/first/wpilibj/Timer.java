package edu.wpi.first.wpilibj;
public class Timer { public static double now; private double start; public void restart() { start = now; } public double get() { return now - start; } public void stop() {} }
