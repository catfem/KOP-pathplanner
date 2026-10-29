import { useState } from 'react';
import { type CalibrationChange, TEST_DRIVE_METERS, calibrate } from '../../model/calibration';
import { INCH } from '../../model/defaults';
import { effectiveEncoder } from '../../model/hardware';
import { showToast, updateProject, useStore } from '../../model/store';
import { NumberField, Section, Segmented } from '../components/controls';

type TurnResult = 'short' | 'exact' | 'past';

const LABELS: Record<CalibrationChange['key'], string> = {
  wheelDiameter: 'Wheel diameter',
  trackWidth: 'Track width',
  kV: 'kV',
  kA: 'kA',
};

function formatValue(key: CalibrationChange['key'], v: number): string {
  if (key === 'wheelDiameter') return `${(v / INCH).toFixed(3)} in`;
  if (key === 'trackWidth') return `${v.toFixed(3)} m`;
  return v.toFixed(3);
}

/** Rounds a corrected value to what the settings show. */
function rounded(key: CalibrationChange['key'], v: number): number {
  return Number(v.toFixed(key === 'wheelDiameter' || key === 'trackWidth' ? 4 : 3));
}

/**
 * Robot tab section: turns what the robot really did in the calibration autos into corrected
 * settings, both at once, with the turn direction asked explicitly.
 */
export function CalibrationSection() {
  const robot = useStore((s) => s.project.robot);
  const encoders = effectiveEncoder(robot) !== 'none';
  const [drove, setDrove] = useState(TEST_DRIVE_METERS);
  const [turn, setTurn] = useState<TurnResult>('exact');
  const [degrees, setDegrees] = useState(0);
  const turnOffset = turn === 'exact' ? 0 : turn === 'past' ? degrees : -degrees;
  const result = calibrate(robot, { drove, turnOffset }, encoders);

  const apply = () => {
    updateProject((p) => {
      for (const c of result.changes) p.robot[c.key] = rounded(c.key, c.to);
    });
    setDrove(TEST_DRIVE_METERS);
    setTurn('exact');
    setDegrees(0);
    showToast('Calibration applied. Generate the code and deploy it before running the tests again; results from the old code would correct twice.');
  };

  return (
    <Section title="Calibration">
      <p className="muted small">
        Run <strong>Test: drive 2 m</strong> and <strong>Test: turn 360°</strong> with code generated from the current settings (
        {encoders ? `wheel diameter ${(robot.wheelDiameter / INCH).toFixed(3)} in, ` : `kV ${robot.kV.toFixed(3)}, `}
        track width {robot.trackWidth.toFixed(3)} m), then enter what the robot really did. Both may come from the same run: the
        corrections are worked out together.
      </p>
      <NumberField
        label="Test: drive 2 m · distance it really drove"
        unit="m"
        value={drove}
        min={0.5}
        max={4}
        step={0.01}
        decimals={3}
        onChange={setDrove}
      />
      <div className="field">
        <span className="field-label">
          Test: turn 360° · where the front ended up (it turns left)
        </span>
        <Segmented<TurnResult>
          label="Where the front ended up after the turn"
          value={turn}
          onChange={setTurn}
          options={[
            { value: 'short', label: 'Stopped short', title: 'It turned less than a full circle' },
            { value: 'exact', label: 'On the line' },
            { value: 'past', label: 'Went past', title: 'It turned more than a full circle' },
          ]}
        />
      </div>
      {turn !== 'exact' && (
        <NumberField
          label={turn === 'short' ? 'Stopped short of the line by' : 'Went past the line by'}
          unit="°"
          value={degrees}
          min={0}
          max={180}
          step={1}
          decimals={1}
          onChange={setDegrees}
        />
      )}
      {result.changes.length > 0 ? (
        <dl className="calibration-result" aria-label="Corrected settings">
          {result.changes.map((c) => (
            <div key={c.key}>
              <dt>{LABELS[c.key]}</dt>
              <dd>
                {formatValue(c.key, c.from)} → <strong>{formatValue(c.key, c.to)}</strong>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted small">Enter a test result to see the corrected settings.</p>
      )}
      {result.warnings.map((w) => (
        <div key={w} className="warning warn">
          <span>{w}</span>
        </div>
      ))}
      <div className="button-row">
        <button type="button" className="btn primary small" disabled={result.changes.length === 0} onClick={apply}>
          Apply calibration
        </button>
      </div>
    </Section>
  );
}
