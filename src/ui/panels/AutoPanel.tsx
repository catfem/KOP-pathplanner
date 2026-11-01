import { makeAllStraight, mirrorAuto } from '../../model/edit';
import { FRONT_LABELS, autoFront } from '../../model/hardware';
import { setUi, updateAuto, useStore } from '../../model/store';
import type { Auto, RobotFront } from '../../model/types';
import type { Plan, PlanStep } from '../../planner/trajectory';
import { Section, Segmented, TextField } from '../components/controls';

function describe(st: PlanStep): string {
  switch (st.kind) {
    case 'drive':
      return `Drive${st.reversed ? ' backwards' : ''} ${st.distance.toFixed(2)} m (point ${st.waypointIndex + 1} → ${st.toIndex + 1})${
        st.markers.length ? ` + ${st.markers.map((m) => m.name).join(', ')}` : ''
      }`;
    case 'turn': {
      const deg = ((st.toHeading - st.fromHeading) * 180) / Math.PI;
      return `Turn ${deg > 0 ? 'left' : 'right'} ${Math.abs(deg).toFixed(0)}° in place`;
    }
    case 'command':
      return `Run “${st.name}”`;
    case 'wait':
      return `Wait ${st.duration.toFixed(2)} s`;
  }
}

export function AutoPanel({ auto, plan }: { auto: Auto; plan: Plan | null }) {
  const field = useStore((s) => s.project.field);
  const autoPeriod = useStore((s) => s.project.codegen.autoPeriod);
  const robotFront = useStore((s) => s.project.robot.front);
  const front = autoFront(auto, { front: robotFront });
  const lead = (f: RobotFront) => FRONT_LABELS[f].toLowerCase();
  return (
    <div className="panel-scroll">
      <Section title="Auto">
        <TextField label="Name" value={auto.name} onChange={(v) => updateAuto((a) => (a.name = v), { coalesce: `${auto.id}:name` })} />
        <div className="field">
          <span className="field-label">Front in this auto</span>
          <Segmented<RobotFront | 'robot'>
            label="Front in this auto"
            value={auto.front ?? 'robot'}
            onChange={(v) =>
              updateAuto((a) => {
                a.front = v === 'robot' ? null : v;
              })
            }
            options={[
              { value: 'robot', label: `Robot's (${FRONT_LABELS[robotFront]})`, title: 'Use the front set on the Robot tab' },
              { value: 'head', label: FRONT_LABELS.head },
              { value: 'intake', label: FRONT_LABELS.intake },
            ]}
          />
          <div className="hint">
            {front === robotFront
              ? 'The end that leads in this auto, aims at a HUB and touches it. Pick the other end to run just this auto the other way round.'
              : `This auto leads with the ${lead(front)} end; the robot's front is the ${lead(robotFront)} end. The generated code drives it backwards with the sides swapped, so nothing is rewired.`}
          </div>
        </div>
        {plan && (
          <dl className="stats">
            <div>
              <dt>Estimated time</dt>
              <dd className={plan.totalTime > autoPeriod ? 'bad' : undefined}>{plan.totalTime.toFixed(2)} s</dd>
            </div>
            <div>
              <dt>Driving distance</dt>
              <dd>{plan.totalDistance.toFixed(2)} m</dd>
            </div>
            <div>
              <dt>Peak wheel voltage</dt>
              <dd>{plan.peakVoltage.toFixed(1)} V</dd>
            </div>
            <div>
              <dt>Start pose</dt>
              <dd>
                ({plan.startPose.x.toFixed(2)}, {plan.startPose.y.toFixed(2)}) · {((plan.startPose.heading * 180) / Math.PI).toFixed(0)}°
              </dd>
            </div>
          </dl>
        )}
        <div className="button-row">
          <button type="button" className="btn small" onClick={() => updateAuto((a) => makeAllStraight(a))} title="Every point becomes a stop with straight lines: drive, turn in place, drive.">
            Make all straight
          </button>
          <button type="button" className="btn small" onClick={() => updateAuto((a) => mirrorAuto(a, field.width))} title="Mirror across the field's long axis (left/right swap)">
            Mirror left/right
          </button>
        </div>
      </Section>

      {plan && plan.warnings.length > 0 && (
        <Section title={`Checks (${plan.warnings.length})`}>
          <ul className="warnings">
            {plan.warnings.map((w, i) => (
              <li key={i} className={`warning ${w.level}`}>
                <span className="warning-icon" aria-hidden>
                  {w.level === 'error' ? '✕' : w.level === 'warn' ? '!' : 'i'}
                </span>
                <span>
                  <span className="sr-only">{w.level}: </span>
                  {w.message}
                  {w.waypointIndex !== undefined && (
                    <button type="button" className="link" onClick={() => setUi({ selectedIndex: w.waypointIndex ?? null, tab: 'point' })}>
                      Show point {w.waypointIndex + 1}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plan && (
        <Section title="Sequence">
          <ol className="sequence">
            <li>
              <span className="seq-time">0.00</span>
              <span>Start, facing {((plan.startPose.heading * 180) / Math.PI).toFixed(0)}°</span>
            </li>
            {plan.steps.map((st, i) => (
              <li key={i}>
                <button type="button" className="seq-time link" onClick={() => setUi({ time: st.start, playing: false })} title="Jump here">
                  {st.start.toFixed(2)}
                </button>
                <span className={`seq-kind kind-${st.kind}`} aria-hidden />
                <span>{describe(st)}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
