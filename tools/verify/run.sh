#!/usr/bin/env bash
# Verifies the generated robot code end to end:
#   1. dumps generated Java + Python for every motor controller / encoder variant,
#   2. compiles each Java variant against API stubs (tools/verify/java-stubs),
#   3. runs FollowKopTrajectory (Java) against drivetrain plants that do not match the constants
#      (weaker side, heavier and slower, tread scrub, an encoder wired backwards),
#   4. constructs every Python variant with the real RobotPy + vendor libraries and runs the
#      PWM variants through a whole auto, the calibration tests, an encoder fault and a wheel
#      size difference in the RobotPy simulator.
# Needs: node, a JDK (17+), and python with robotpy, robotpy-commands-v2, robotpy-rev, robotpy-ctre.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${KOP_VERIFY_DIR:-$(mktemp -d)}"
PYTHON="${PYTHON:-python3}"
cd "$ROOT"
fail=0

echo "== Generating code into $OUT"
KOP_DUMP_DIR="$OUT/gen" npx vitest run tests/dump-generated.test.ts > "$OUT/dump.log" 2>&1 || { cat "$OUT/dump.log"; exit 1; }

echo "== Compiling Java"
mkdir -p "$OUT/stubs"
javac --release 17 -d "$OUT/stubs" $(find tools/verify/java-stubs -name '*.java')
for dir in "$OUT"/gen/java/*/; do
  variant="$(basename "$dir")"
  classes="$OUT/classes/$variant"
  mkdir -p "$classes"
  if javac --release 17 -Xlint:all,-this-escape -Werror -cp "$OUT/stubs" -d "$classes" $(find "$dir" -name '*.java') \
    tools/verify/harness/frc/robot/kop/FollowerHarness.java 2> "$OUT/javac.log"; then
    echo "ok   javac $variant"
  else
    echo "FAIL javac $variant"; cat "$OUT/javac.log"; fail=1; continue
  fi
  case "$variant" in
    can-talon-victor_rio | pwm-spark_none)
      for traj in 'KopAutos$TwoPieceData DRIVE_1' 'KopAutos$TwoPieceData DRIVE_2' 'KopAutos$DriveAndTurnData TURN_1' \
        'KopCalibration DRIVE' 'KopCalibration TURN'; do
        # shellcheck disable=SC2086
        java -cp "$OUT/stubs:$classes" frc.robot.kop.FollowerHarness $traj || fail=1
      done
      ;;
  esac
done

echo "== Running Python in the RobotPy simulator"
for dir in "$OUT"/gen/python/*/; do
  variant="$(basename "$dir")"
  case "$variant" in
    pwm-*_rio) modes="run calibrate fault balance" ;;
    pwm-*) modes="run calibrate balance" ;;
    *) modes="construct" ;;
  esac
  for mode in $modes; do
    "$PYTHON" tools/verify/robotpy_sim.py "$dir" "$mode" 2>"$OUT/py.log" | grep -E '^(ok|FAIL)' || { echo "FAIL python $variant"; tail -20 "$OUT/py.log"; fail=1; }
  done
done
"$PYTHON" tools/verify/robotpy_sim.py "$OUT/gen/python/pwm-sparkmax_rio" run 0.95 2>/dev/null | grep -E '^(ok|FAIL)' || fail=1

if [ "$fail" -ne 0 ]; then
  echo "Generated code verification FAILED"
  exit 1
fi
echo "Generated code verification passed"
