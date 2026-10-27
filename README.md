# KOP Path Planner

A web app that plans, simulates and **generates autonomous code** for the FRC Kit-of-Parts
chassis (AM14U-style tank / west coast drive). It works like PathPlanner, but it is built for a
plain KOP drivetrain and **does not need a gyroscope**. It runs with roboRIO encoders, motor
controller encoders, or no sensors at all.

![KOP Path Planner](docs/screenshot.png)

## Features

- **Field editor**: draw paths with Bezier curves or "drive, stop, turn, drive" straight lines.
  Drag points and handles, double-click to insert, snap to grid, zoom and pan, undo/redo, and
  upload your own field image.
- **Stop points**: stop anywhere to turn in place, face a heading, drive backwards, or run a
  sequence of named commands and waits (e.g. *Shoot*, *Score*).
- **Markers**: start commands while driving (e.g. *Intake*) at any point of the path.
- **Trajectory planning** for a differential drive: time-optimal velocity profile limited by max
  speed, acceleration, centripetal acceleration, per-wheel speed and per-segment speed limits.
  Includes turn-in-place profiles.
- **Simulation**: play the auto back with a timeline, a step bar and wheel speed / voltage
  charts. A **physics simulation of the generated controller** runs on an imperfect robot (weaker
  side, wrong kS, wheel scrub) so you can see how far the auto drifts without a gyro.
- **Checks**: auto period overrun, bumpers leaving the field, voltage saturation, sharp corners.
- **Code generation** for **Java (WPILib command-based)** and **Python (RobotPy commands2)**:
  a drivetrain subsystem, a gyro-less trajectory follower, a named-command registry and
  one method per auto. Download everything as a `.zip`.
- **Hardware** supported out of the box: Talon SRX / Victor SPX (CAN, Phoenix 5), SPARK MAX
  (brushless NEO or brushed CIM, REVLib 2026), and PWM SPARK MAX / Victor SPX / Talon SRX /
  SPARK / Victor SP. Encoders: none, roboRIO DIO quadrature, or through the motor controller.
- Projects autosave in the browser and can be saved/opened as files. PathPlanner `.path` files
  can be imported.

## Getting started

Use the hosted version (GitHub Pages, deployed from `main`), or run it locally:

```bash
npm ci
npm run dev      # http://localhost:5173
```

`npm run build` produces a static site in `dist/` that works from any web server or sub-path.

### Workflow

1. **Robot tab**: gear ratio, wheel size, motors, motor controller IDs, encoders and gains.
   The defaults are a stock KOP chassis: Toughbox Mini 10.71:1, 6" wheels, 2 CIMs per side,
   Talon SRX + Victor SPX, E4T encoders on the roboRIO.
2. **Draw** the path with the **+** tool. Curve mode gives smooth paths; line mode gives
   "drive, stop, turn in place, drive", the most predictable option without a gyro.
3. **Select a point** to edit it: stop or drive through, direction, handle lengths, drive
   backwards, face a heading, actions and markers.
4. **Play** the auto and check the Auto tab for warnings. On the **Simulate** tab, add
   imperfections and watch the orange dashed robot.
5. **Generate code**, download the zip, and copy it into your robot project. The included
   `KOP_AUTOS_README.md` shows the few lines to add to `RobotContainer` / `robot.py`:

```java
KopNamedCommands.register("Shoot", () -> shooter.shootCommand());   // before building autos
autoChooser = KopAutos.buildChooser(drive);                          // drive = new KopDrivetrain()
SmartDashboard.putData("Auto", autoChooser);
```

## How it works without a gyro

On a tank drive the heading is fixed by the *difference* in distance travelled by the left and
right wheels. The planner converts the path into a position / velocity / acceleration profile for
**each wheel**. If both wheels follow their profiles, the robot follows the path, with no
heading sensor involved.

| Mode | What the generated follower does |
| --- | --- |
| **No encoders** | Plays back per-wheel feedforward voltages (kS + kV·v + kA·a) by time. Simple; drift grows with path length. |
| **Encoders** | Feedforward plus per-wheel position/velocity feedback, a heading-hold term on the left/right error difference, and path correction from encoder-only odometry (steers back when the robot drifts sideways). |

The only error encoders cannot see is wheel slip and scrub. Calibrate the **effective track
width** (spin in place N turns: `(|left| + |right|) / (2π·N)`) and measure kS/kV/kA with WPILib
SysId. The **Estimate kV/kA** button gives a physics-based starting point.

## Generated code

| Java (`src/main/java/frc/robot/kop/`) | Python (`kop/`) | Purpose |
| --- | --- | --- |
| `KopDriveConstants.java` | `constants.py` | Measurements, IDs, gains |
| `KopDrive.java` | — (duck typing) | Interface the autos drive through |
| `KopDrivetrain.java` | `drive.py` | Ready-made drivetrain subsystem with teleop arcade drive and encoder odometry |
| `KopTrajectory.java` | `trajectory.py` | Sampled wheel trajectories with interpolation |
| `FollowKopTrajectory.java` | `follow.py` | Gyro-less trajectory follower command |
| `KopNamedCommands.java` | `named_commands.py` | Registry for action/marker commands |
| `KopAutos.java` | `autos.py`, `auto_data.py` | One command per auto, plus `buildChooser` |

Every auto can be **mirrored at runtime** (`KopAutos.myAuto(drive, () -> mirror)`), which swaps
left and right turns to run the same routine from the other side of the field. Trajectories are
embedded in the source code, so there are no deploy files to forget.

## Development

```bash
npm run dev             # dev server
npm run typecheck       # TypeScript
npm test                # planner, simulator, codegen and editor unit tests (Vitest)
npm run build           # production build
npm run verify:codegen  # end-to-end check of the generated robot code (see below)
```

`npm run verify:codegen` (`tools/verify/run.sh`) generates code for every controller/encoder
combination, then:

- compiles every Java variant with `javac --release 17 -Werror` against API stubs of WPILib,
  Phoenix 5 and REVLib (`tools/verify/java-stubs`);
- runs the generated `FollowKopTrajectory` against a drivetrain plant model;
- constructs every Python variant with the real **RobotPy 2026** and vendor libraries, and
  runs whole autos in the RobotPy simulator, checking the commands ran and where the robot
  stopped.

It needs a JDK and `pip install -r tools/verify/requirements.txt`. CI runs it on every pull
request.

```
src/
  model/      data types, defaults, store (undo/redo, autosave), editing operations
  planner/    geometry, trajectory generation, follower physics simulation
  codegen/    Java + Python generators, zip writer
  ui/         React components (field canvas, timeline, chart, inspector panels, modals)
tests/        Vitest unit tests
tools/verify/ generated-code verification (javac stubs, Java harness, RobotPy simulation)
```

## Notes and limitations

- Paths are relative to the starting pose. Place the robot where the plan starts, facing the
  planned heading. Field position only matters for the preview.
- Vendor APIs change between seasons. The generated CAN code targets Phoenix 5 and REVLib 2026;
  vendor-specific lines are isolated in `KopDrivetrain` / `drive.py` and marked.
- Brushed SPARK MAX controllers have no built-in encoder: use roboRIO encoders or open loop.
- Two markers that require the same subsystem cannot run in the same segment (WPILib parallel
  group rule).

## License

[MIT](LICENSE)
