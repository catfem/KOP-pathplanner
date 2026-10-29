// Turns what the robot really did in the generated calibration autos into
// corrected settings.
//
// The two tests depend on each other: "Test: turn 360°" measures the turn with
// the encoder distances of the wheel diameter the code was generated with. If
// both tests ran with the same code, the track width must also take the wheel
// diameter correction. Fixing them one at a time by hand from the same run
// leaves the track width off by the wheel diameter error, and reading the turn
// the wrong way round (short vs past the line) doubles the error instead of
// removing it. This module does both corrections together, with the direction
// stated explicitly.

import type { RobotConfig } from './types';

/** Distance of the generated "Test: drive 2 m" auto, m. */
export const TEST_DRIVE_METERS = 2;

export interface CalibrationMeasurements {
  /** How far the robot really drove in "Test: drive 2 m", m. 2 means no correction. */
  drove: number;
  /**
   * Where the robot's front ended after "Test: turn 360°" (a full turn to the left), in degrees
   * from the start line: positive when it went past the line (turned too far), negative when it
   * stopped short. 0 means no correction.
   */
  turnOffset: number;
}

export interface CalibrationChange {
  key: 'wheelDiameter' | 'trackWidth' | 'kV' | 'kA';
  from: number;
  to: number;
}

export interface CalibrationResult {
  /** New values for the robot settings (only the ones that change). */
  changes: CalibrationChange[];
  /** Suspicious measurements, in plain words. */
  warnings: string[];
}

/**
 * Corrected settings from the calibration autos, run with code generated from `robot`.
 * With encoders the drive test corrects the wheel diameter (and kV/kA, which are per meter);
 * open loop it corrects kV. The turn test corrects the track width, including the distance
 * correction because it ran with the same code.
 */
export function calibrate(robot: RobotConfig, m: CalibrationMeasurements, encoders: boolean): CalibrationResult {
  const warnings: string[] = [];
  const changes: CalibrationChange[] = [];
  const drove = Number.isFinite(m.drove) && m.drove > 0 ? m.drove : TEST_DRIVE_METERS;
  const offset = Number.isFinite(m.turnOffset) ? m.turnOffset : 0;
  // Real distance per planned (encoder) distance.
  const scale = drove / TEST_DRIVE_METERS;
  const turned = 360 + offset;

  if (Math.abs(scale - 1) > 1e-9) {
    if (encoders) {
      changes.push({ key: 'wheelDiameter', from: robot.wheelDiameter, to: robot.wheelDiameter * scale });
      // Feedforward gains are volts per (old) meter: keep them right in real meters.
      changes.push({ key: 'kV', from: robot.kV, to: robot.kV / scale });
      changes.push({ key: 'kA', from: robot.kA, to: robot.kA / scale });
    } else {
      changes.push({ key: 'kV', from: robot.kV, to: robot.kV / scale });
    }
    if (scale < 0.85 || scale > 1.18) {
      warnings.push(
        encoders
          ? `The robot went ${drove.toFixed(2)} m instead of ${TEST_DRIVE_METERS} m. Worn or soft wheels change this by a few percent; a bigger difference usually means a wrong encoder setting (cycles per revolution, encoder on the motor shaft, gear ratio). Check those before calibrating.`
          : `The robot went ${drove.toFixed(2)} m instead of ${TEST_DRIVE_METERS} m. Open loop that much error usually means kS is off too: run the feedforward test once you have encoders.`,
      );
    }
  }

  if (turned <= 0) {
    warnings.push('A turn of 360° or more short cannot be right: check the direction and count full turns.');
  } else if (Math.abs(offset) > 1e-9 || Math.abs(scale - 1) > 1e-9) {
    const trackWidth = robot.trackWidth * (360 / turned) * scale;
    if (Math.abs(trackWidth - robot.trackWidth) > 1e-9) changes.push({ key: 'trackWidth', from: robot.trackWidth, to: trackWidth });
    if (Math.abs(offset) > 90) {
      warnings.push(
        'More than 90° off after one turn: check that the code on the robot was generated from these settings, and that you counted full turns.',
      );
    }
    // The effective track width of a tank drive is about the wheel spacing, up to ~1.5x with scrub.
    const frame = robot.width;
    if (trackWidth < frame * 0.45 || trackWidth > frame * 1.6) {
      warnings.push(
        `A track width of ${trackWidth.toFixed(3)} m is unusual for a ${frame.toFixed(2)} m wide robot. Check the turn direction: "went past" means it turned more than a full circle.`,
      );
    }
  }
  return { changes, warnings };
}
