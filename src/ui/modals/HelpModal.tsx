import { setUi } from '../../model/store';
import { Modal } from '../components/Modal';

export function HelpModal() {
  return (
    <Modal title="KOP Path Planner" onClose={() => setUi({ helpOpen: false })}>
      <div className="help-body">
        <p className="lead">
          Plan autonomous routines for the FRC Kit-of-Parts drivetrain (AM14U-style tank drive), preview them, and generate ready-to-run WPILib
          code. <strong>No gyroscope needed.</strong>
        </p>

        <h3>Quick start</h3>
        <ol>
          <li>
            <strong>Robot tab:</strong> pick a drivetrain preset (CIM + Talon/Victor, <strong>NEO + SPARK MAX</strong>, NEO Vortex + SPARK
            Flex…), then check gear ratio, wheel size, IDs and encoders. The defaults are a typical KOP chassis: Toughbox Mini 10.71:1, 6&quot;
            wheels, 2 CIMs per side.
          </li>
          <li>
            <strong>Field tab:</strong> the 2026 field shows both <strong>HUBs</strong> (positions from the official AprilTag layout), the
            BUMPs beside them and the TRENCHes. The planner slows down on BUMPs and warns if the robot would hit a HUB.
          </li>
          <li>
            <strong>Draw the path:</strong> pick the <em>+</em> tool and click on the field. Curve mode makes smooth paths; line mode makes
            &quot;drive, stop, turn, drive&quot; paths, the most predictable option without a gyro.
          </li>
          <li>
            <strong>Edit:</strong> drag points and their handles, double-click the path to insert a point, select a point to make it a stop,
            drive backwards, face a heading or <strong>aim at a HUB</strong>, or run commands (e.g. <em>Shoot</em>) and markers (e.g.{' '}
            <em>Intake</em> while driving). &quot;Bumper against the HUB&quot; moves a shooting spot so the front bumper touches the HUB.
          </li>
          <li>
            <strong>Place the robot:</strong> the yellow guides show how far the starting bumpers are from the alliance wall and guardrail, and
            how far the front bumper is from the HUB. Measure those on the real field.
          </li>
          <li>
            <strong>Preview:</strong> press play. The orange dashed robot is a physics simulation of the generated controller on an imperfect
            robot. Tune the imperfections on the Simulate tab.
          </li>
          <li>
            <strong>Generate code:</strong> download the zip and copy it into your robot project. The included README shows the few lines to add to
            RobotContainer / robot.py.
          </li>
        </ol>

        <h3>How it works without a gyro</h3>
        <p>
          A tank drive&apos;s heading is set by the difference between how far the left and right wheels travel. The planner turns the path into a
          position/velocity profile for <em>each wheel</em>. If both wheels follow their profiles, the robot follows the path, so no heading sensor
          is needed.
        </p>
        <ul>
          <li>
            <strong>No encoders (open loop):</strong> the robot replays the per-wheel voltages from feedforward (kS, kV, kA) by time. It is simple,
            but drift grows with path length and battery voltage.
          </li>
          <li>
            <strong>With encoders:</strong> position + velocity feedback on each wheel, heading hold on the left/right difference, and path
            correction from encoder-only odometry. When the robot falls behind, the setpoints wait for it, so it keeps the path&apos;s shape
            and takes longer instead of cutting corners. A wheel stuck short of its target gets extra voltage, and an encoder that reads
            backwards or not at all is caught before the robot runs away. Errors stay small unless the wheels slip.
          </li>
        </ul>

        <h3>Calibration checklist</h3>
        <p>The generated code adds calibration autos to the auto chooser. Run them on the real robot, in this order:</p>
        <ol>
          <li>
            Directions: roll the robot forward by hand while it is disabled. The dashboard values KOP/Left distance and KOP/Right distance must
            both go up. Flip the invert options if not.
          </li>
          <li>&quot;Test: measure feedforward&quot; reports kS and kV. Enter them on the Robot tab.</li>
          <li>&quot;Test: drive 2 m&quot;: measure how far the robot went and correct the wheel diameter as reported.</li>
          <li>
            &quot;Test: turn 360°&quot;: tape a line along a bumper first and correct the track width as reported. Scrub on 6-wheel drop-center
            chassis makes it larger than the tape-measured width.
          </li>
          <li>Generate the code again and run your autos.</li>
        </ol>

        <h3>Shortcuts</h3>
        <table className="shortcuts">
          <tbody>
            <tr>
              <td>
                <kbd>V</kbd> / <kbd>A</kbd>
              </td>
              <td>Select tool / add tool</td>
            </tr>
            <tr>
              <td>
                <kbd>Space</kbd>
              </td>
              <td>Play / pause</td>
            </tr>
            <tr>
              <td>
                <kbd>Del</kbd>
              </td>
              <td>Delete the selected point</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>
              </td>
              <td>Undo / redo</td>
            </tr>
            <tr>
              <td>Arrow keys</td>
              <td>Nudge the selected point 5 cm (Shift: 25 cm)</td>
            </tr>
            <tr>
              <td>
                <kbd>Shift</kbd> while dragging
              </td>
              <td>Snap angles to 15°</td>
            </tr>
            <tr>
              <td>
                <kbd>Alt</kbd>-drag a point
              </td>
              <td>Pull out its handle</td>
            </tr>
            <tr>
              <td>Mouse wheel / right-drag</td>
              <td>Zoom / pan</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">Projects are saved in this browser automatically. Use Project → Save to keep a file or share it with your team.</p>
      </div>
    </Modal>
  );
}
