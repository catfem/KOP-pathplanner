import { useEffect } from 'react';
import { setUi } from '../model/store';
import { IconButton } from './controls';
import { IconX } from './icons';

export function HelpModal() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUi({ helpOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUi({ helpOpen: false })}>
      <div className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="modal-head">
          <h2 id="help-title">KOP Path Planner</h2>
          <div className="spacer" />
          <IconButton title="Close (Esc)" onClick={() => setUi({ helpOpen: false })}>
            <IconX />
          </IconButton>
        </header>
        <div className="help-body">
          <p className="lead">
            Plan autonomous routines for the FRC Kit-of-Parts drivetrain (AM14U-style tank drive), preview them, and generate ready-to-run WPILib
            code. <strong>No gyroscope needed.</strong>
          </p>

          <h3>Quick start</h3>
          <ol>
            <li>
              <strong>Robot tab:</strong> enter your gear ratio, wheel size, motor controllers and encoders. The defaults are a typical KOP chassis:
              Toughbox Mini 10.71:1, 6&quot; wheels, 2 CIMs per side.
            </li>
            <li>
              <strong>Draw the path:</strong> pick the <em>+</em> tool and click on the field. Curve mode makes smooth paths; line mode makes
              &quot;drive, stop, turn, drive&quot; paths, the most predictable option without a gyro.
            </li>
            <li>
              <strong>Edit:</strong> drag points and their handles, double-click the path to insert a point, select a point to make it a stop,
              drive backwards, face a heading, or run commands (e.g. <em>Shoot</em>) and markers (e.g. <em>Intake</em> while driving).
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
              <strong>With encoders:</strong> position + velocity feedback on each wheel, a heading-hold term on the left/right difference, and path
              correction from encoder-only odometry. Errors stay small unless the wheels slip.
            </li>
          </ul>

          <h3>Calibration checklist</h3>
          <ol>
            <li>On blocks, drive forward: both encoder distances must go up. Flip the invert options if not.</li>
            <li>Measure kS/kV/kA with WPILib SysId (or use &quot;Estimate kV/kA&quot; as a starting point).</li>
            <li>
              Effective track width: spin in place N turns, read both distances, and use (|left| + |right|) / (2π·N). Scrub on 6-wheel drop-center
              chassis makes this larger than the tape-measured width.
            </li>
            <li>Run an auto, compare where the robot stops with the plan, and adjust.</li>
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
      </div>
    </div>
  );
}
