"""Runs a generated Python auto in the RobotPy HAL simulator against a simple drivetrain plant.

Usage: python robotpy_sim.py <generated project dir> <run|construct> [left side strength]

"construct" only builds the drivetrain and the autos (works for CAN controllers too, using the
vendor libraries' simulation). "run" also drives the plant through the whole "Two Piece" auto
(PWM controllers + optional roboRIO encoders) and checks where the robot ends up.
"""

import math
import os
import sys

import commands2
import wpilib
import wpilib.simulation as sim

gen_dir, mode = sys.argv[1], sys.argv[2]
variant = os.path.basename(os.path.normpath(gen_dir))
left_scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
sys.path.insert(0, gen_dir)

from kop import autos, named_commands  # noqa: E402
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
autos.build_chooser(drive)  # builds every auto

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

auto = autos.two_piece(drive)
scheduler = commands2.CommandScheduler.getInstance()
scheduler.schedule(auto)
lp = lv = rp = rv = 0.0
x = y = heading = None
for loop in range(2000):
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
    if left_enc:
        left_enc.setDistance(lp)
        left_enc.setRate(lv)
        right_enc.setDistance(rp)
        right_enc.setRate(rv)
    sim.stepTiming(0.02)
    if not auto.isScheduled():
        break

error = math.hypot(x - target[0], y - target[1])
closed = drive.has_encoders()
limit = 0.1 if closed else 0.25
ok = not auto.isScheduled() and ran == ["Shoot", "Intake", "Shoot"] and error < limit
print(
    f"{'ok  ' if ok else 'FAIL'} run {variant} left x{left_scale}: "
    f"{loop * 0.02:.2f}s, commands {ran}, end ({x:.3f}, {y:.3f}) {math.degrees(heading):.1f} deg, "
    f"plan ({target[0]:.3f}, {target[1]:.3f}) {math.degrees(target[2]):.1f} deg, error {error:.3f} m"
)
sys.exit(0 if ok else 1)
