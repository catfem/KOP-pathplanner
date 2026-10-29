import { setUi, useStore } from '../../model/store';
import { type Plan, type PlanStep, sampleAt } from '../../planner/trajectory';
import { IconButton } from '../components/controls';
import { IconChart, IconPause, IconPlay, IconRestart } from '../components/icons';

function stepLabel(st: PlanStep): string {
  switch (st.kind) {
    case 'drive':
      return st.reversed ? 'Reverse' : 'Drive';
    case 'turn':
      return `Turn ${Math.round(((st.toHeading - st.fromHeading) * 180) / Math.PI)}°`;
    case 'command':
      return st.name;
    case 'wait':
      return `Wait ${st.duration.toFixed(1)}s`;
  }
}

/**
 * `endTime` is where playback stops: the end of the plan, or later when the simulated robot
 * (`simEnd`) needs longer.
 */
export function Timeline({ plan, endTime, simEnd }: { plan: Plan | null; endTime: number; simEnd: number | null }) {
  const time = useStore((s) => s.ui.time);
  const playing = useStore((s) => s.ui.playing);
  const speed = useStore((s) => s.ui.speed);
  const autoPeriod = useStore((s) => s.project.codegen.autoPeriod);
  const field = useStore((s) => s.project.field);
  const chartOpen = useStore((s) => s.ui.chartOpen);
  const total = plan?.totalTime ?? 0;
  const state = plan ? sampleAt(plan, time) : null;
  const hubs = field.elementsEnabled ? field.elements.filter((e) => e.kind === 'hub') : [];
  const hubDistance =
    state && hubs.length ? Math.min(...hubs.map((h) => Math.hypot(h.x - state.x, h.y - state.y))) : null;
  const scaleMax = Math.max(endTime, total, 0.001);
  const simLate = simEnd !== null && simEnd > total + 0.05;

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          type="button"
          className="btn primary play"
          onClick={() => {
            if (!playing && time >= scaleMax) setUi({ time: 0, playing: true });
            else setUi({ playing: !playing });
          }}
          disabled={!plan || total <= 0}
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" className="btn ghost icon-only" onClick={() => setUi({ time: 0, playing: false })} title="Back to start" aria-label="Back to start">
          <IconRestart />
        </button>
        <IconButton title={chartOpen ? 'Hide speed chart' : 'Show speed chart'} active={chartOpen} onClick={() => setUi({ chartOpen: !chartOpen })}>
          <IconChart />
        </IconButton>
        <select className="speed-select" value={speed} onChange={(e) => setUi({ speed: Number(e.target.value) })} aria-label="Playback speed">
          {[0.25, 0.5, 1, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <div className="time-readout">
          <strong>{time.toFixed(2)}</strong>
          <span> / {total.toFixed(2)} s</span>
          {total > autoPeriod && <span className="badge error">over {autoPeriod}s</span>}
          {simLate && (
            <span
              className="sim-time"
              title="The simulated robot is slower than planned. The generated code waits for it instead of cutting corners, so it finishes later."
            >
              · simulated robot {(simEnd as number).toFixed(2)} s
            </span>
          )}
        </div>
        {state && (
          <div className="state-readout" aria-live="off">
            <span className="state-label">{state.label}</span>
            <span>v {state.v.toFixed(2)} m/s</span>
            <span>ω {((state.omega * 180) / Math.PI).toFixed(0)}°/s</span>
            <span>L {state.lVel.toFixed(2)}</span>
            <span>R {state.rVel.toFixed(2)}</span>
            {hubDistance !== null && <span title="Robot center to the nearest HUB center">HUB {hubDistance.toFixed(2)} m</span>}
          </div>
        )}
      </div>
      <div className="steps-track">
        <div className="steps-bar" aria-hidden>
          {plan?.steps.map((st, i) => (
            <div
              key={i}
              className={`step step-${st.kind}`}
              style={{ left: `${(st.start / scaleMax) * 100}%`, width: `${(st.duration / scaleMax) * 100}%` }}
              title={`${stepLabel(st)} · ${st.start.toFixed(2)}–${(st.start + st.duration).toFixed(2)} s`}
            >
              <span>{stepLabel(st)}</span>
            </div>
          ))}
          {simLate && (
            <div
              className="sim-end"
              style={{ left: `${((simEnd as number) / scaleMax) * 100}%` }}
              title={`Simulated robot finishes at ${(simEnd as number).toFixed(2)} s`}
            />
          )}
          <div className="playhead" style={{ left: `${(Math.min(time, scaleMax) / scaleMax) * 100}%` }} />
        </div>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={scaleMax}
          step={0.01}
          value={Math.min(time, scaleMax)}
          onChange={(e) => setUi({ time: Number(e.target.value), playing: false })}
          aria-label="Timeline position"
          disabled={!plan}
        />
      </div>
    </div>
  );
}
