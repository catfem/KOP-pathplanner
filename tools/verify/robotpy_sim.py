"""Runs generated Python code in the RobotPy HAL simulator against a simple drivetrain plant.

Usage: python robotpy_sim.py <generated project dir> <mode> [left side strength]

construct  only builds the drivetrain and the autos (works for CAN controllers too, using the
           vendor libraries' simulation).
run        drives the plant through the whole "Two Piece" auto (PWM controllers, optional roboRIO
           encoders) and checks where the robot ends up.
calibrate  runs the calibration autos (drive 2 m, turn 360, measure feedforward) and checks their
           reports against the plant.
fault      wires the left encoder backwards and checks that the follower notices, says what to
           flip, and does not run away.
"""

import math
import os
import re
import sys

import commands2
import wpilib
import wpilib.simulation as sim

gen_dir, mode = sys.argv[1], sys.argv[2]
variant = os.path.basename(os.path.normpath(gen_dir))
left_scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
sys.path.insert(0, gen_dir)

from kop import autos, calibration, follow, named_commands  # noqa: E402
from kop import constants as c  # noqa: E402
from kop.drive import KopDrivetrain  # noqa: E402

sim.pauseTiming()
sim.DriverStationSim.setEnabled(True)
sim.DriverStationSim.setAutonomous(True)
sim.DriverStationSim.notifyNewData()

drive = KopDrivetrain()
ran = []
for name in ("Shoot", "Intake", "Score"):
    named_commands.register(name, lambda n=name: commands2.InstantCommand(lambda: ran.append(n)))
autos.build_chooser(drive)  # builds every auto and the calibration tests

if mode == "construct":
    print(f"ok   construct {variant} (encoders: {drive.has_encoders()})")
    sys.exit(0)

left_pwm = sim.PWMSim(c.LEFT_MOTOR_IDS[0])
right_pwm = sim.PWMSim(c.RIGHT_MOTOR_IDS[0])
left_enc = sim.EncoderSim.createForChannel(c.LEFT_ENCODER_PORTS[0]) if drive.has_encoders() else None
right_enc = sim.EncoderSim.createForChannel(c.RIGHT_ENCODER_PORTS[0]) if drive.has_encoders() else None
left_sign = -1.0 if c.INVERT_LEFT else 1.0
right_sign = -1.0 if c.INVERT_RIGHT else 1.0


def side(pos, vel, volts, dt):
    if abs(vel) < 1e-3 and abs(volts) <= c.KS:
        return pos, 0.0
    d = math.copysign(1, vel) if abs(vel) >= 1e-3 else math.copysign(1, volts)
    acc = (volts - c.KS * d - c.KV * vel) / c.KA
    nv = vel + acc * dt
    if abs(vel) >= 1e-3 and math.copysign(1, nv) != math.copysign(1, vel):
        nv = 0.0
    return pos + nv * dt, nv


# Remember the last planned pose the follower reports: that is where the robot should end.
target = [0.0, 0.0, 0.0]
report_target = drive.set_target_pose


def record_target(tx, ty, th):
    target[:] = [tx, ty, th]
    report_target(tx, ty, th)


drive.set_target_pose = record_target

# Capture the calibration reports.
reports = []
original_report = calibration._report


def record_report(message):
    reports.append(message)
    original_report(message)


calibration._report = record_report


# Wheel positions and speeds persist from one command to the next, like on a real robot.
plant = {"lp": 0.0, "lv": 0.0, "rp": 0.0, "rv": 0.0}


def simulate(command, left_encoder=1.0, max_loops=2500):
    """Runs a command against the plant. Returns (x, y, heading, loops, farthest wheel travel)."""
    scheduler = commands2.CommandScheduler.getInstance()
    scheduler.schedule(command)
    lp, lv, rp, rv = plant["lp"], plant["lv"], plant["rp"], plant["rv"]
    start_l, start_r = lp, rp
    x = y = heading = None
    farthest = 0.0
    loop = 0
    for loop in range(max_loops):
        scheduler.run()
        if x is None:
            x, y, heading = drive.pose_x, drive.pose_y, drive.pose_heading
        l_volts = left_pwm.getSpeed() * 12.0 * left_sign * left_scale
        r_volts = right_pwm.getSpeed() * 12.0 * right_sign
        for _ in range(10):
            lp0, rp0 = lp, rp
            lp, lv = side(lp, lv, l_volts, 0.002)
            rp, rv = side(rp, rv, r_volts, 0.002)
            dl, dr = lp - lp0, rp - rp0
            dh = (dr - dl) / c.TRACK_WIDTH
            x += (dl + dr) / 2 * math.cos(heading + dh / 2)
            y += (dl + dr) / 2 * math.sin(heading + dh / 2)
            heading += dh
        farthest = max(farthest, abs(lp - start_l), abs(rp - start_r))
        if left_enc:
            left_enc.setDistance(lp * left_encoder)
            left_enc.setRate(lv * left_encoder)
            right_enc.setDistance(rp)
            right_enc.setRate(rv)
        sim.stepTiming(0.02)
        if not command.isScheduled():
            break
    plant.update(lp=lp, lv=lv, rp=rp, rv=rv)
    return x, y, heading, loop, farthest


def finish(ok, message):
    print(f"{'ok  ' if ok else 'FAIL'} {mode} {variant}: {message}")
    sys.exit(0 if ok else 1)


if mode == "run":
    auto = autos.two_piece(drive)
    x, y, heading, loop, _ = simulate(auto)
    error = math.hypot(x - target[0], y - target[1])
    closed = drive.has_encoders()
    limit = 0.1 if closed else 0.25
    ok = not auto.isScheduled() and ran == ["Shoot", "Intake", "Shoot"] and error < limit
    finish(
        ok,
        f"left x{left_scale}: {loop * 0.02:.2f}s, commands {ran}, end ({x:.3f}, {y:.3f}) "
        f"{math.degrees(heading):.1f} deg, plan ({target[0]:.3f}, {target[1]:.3f}) "
        f"{math.degrees(target[2]):.1f} deg, error {error:.3f} m",
    )

if mode == "calibrate":
    problems = []
    tests = [calibration.drive_test(drive), calibration.turn_test(drive)]
    if drive.has_encoders():
        tests.append(calibration.MeasureFeedforward(drive))
    for test in tests:
        reports.clear()
        simulate(test, max_loops=3000)
        if test.isScheduled() or len(reports) != 1:
            problems.append(f"{test.getName()} did not finish with one report: {reports}")
            continue
        text = reports[0]
        numbers = [float(v) for v in re.findall(r"-?\d+\.\d+", text)]
        if test.getName() == "Test: drive 2 m" and drive.has_encoders():
            if not (abs(numbers[0] - 2.0) < 0.05 and abs(numbers[1] - 2.0) < 0.05):
                problems.append(f"drive test: {text}")
        elif test.getName() == "Test: turn 360°" and drive.has_encoders():
            planned = math.pi * c.TRACK_WIDTH
            if not (abs(numbers[0] + planned) < 0.05 and abs(numbers[1] - planned) < 0.05):
                problems.append(f"turn test: {text}")
        elif test.getName() == "Test: measure feedforward":
            ks, kv = (numbers + [math.nan, math.nan])[:2]
            if not (abs(ks - c.KS) < 0.06 and abs(kv - c.KV) / c.KV < 0.05):
                problems.append(f"feedforward fit kS {ks} kV {kv} (plant {c.KS} / {c.KV}): {text}")
        print(f"     {text}")
    finish(not problems, "; ".join(problems) or f"{len(tests)} calibration tests reported correctly")

if mode == "fault":
    follow.clear_encoder_fault()
    auto = autos.two_piece(drive)
    x, y, heading, loop, farthest = simulate(auto, left_encoder=-1.0)
    fault = follow.get_encoder_fault()
    ok = (
        fault is not None
        and "INVERT_LEFT_ENCODER" in fault
        and not auto.isScheduled()
        and farthest < 7.0  # the whole auto drives about 5 m per wheel
    )
    finish(ok, f"fault {fault!r}, auto finished in {loop * 0.02:.2f}s, farthest wheel travel {farthest:.2f} m")

finish(False, f"unknown mode {mode}")
