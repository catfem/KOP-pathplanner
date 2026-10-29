import { setUi, useStore } from '../../model/store';
import { effectiveEncoder } from '../../model/hardware';
import { faultMessage } from '../../planner/follower';
import { DEFAULT_SIM, PERFECT_SIM, type SimResult, type SimSettings } from '../../planner/simulate';
import { Checkbox, Section } from '../components/controls';
import type { SimComparison } from '../hooks/usePlanning';

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <strong>{format(value)}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

const pct = (v: number) => `${v >= 1 ? '+' : ''}${((v - 1) * 100).toFixed(0)}%`;

const positionClass = (m: number) => (m > 0.3 ? 'bad' : m > 0.1 ? 'meh' : 'good');
const headingClass = (deg: number) => (Math.abs(deg) > 10 ? 'bad' : Math.abs(deg) > 3 ? 'meh' : 'good');

/** "stray up to 48 cm from the path and end 3 cm and 0.4° off", with the same colors as the stats. */
function Outcome({ result }: { result: SimResult }) {
  return (
    <>
      stray up to <strong className={positionClass(result.maxPathDeviation)}>{(result.maxPathDeviation * 100).toFixed(0)} cm</strong> from the
      path and end <strong className={positionClass(result.positionError)}>{(result.positionError * 100).toFixed(0)} cm</strong> and{' '}
      <strong className={headingClass(result.headingErrorDeg)}>{Math.abs(result.headingErrorDeg).toFixed(1)}°</strong> off
    </>
  );
}

export function SimPanel({ sim, comparison }: { sim: SimResult | null; comparison: SimComparison | null }) {
  const showSim = useStore((s) => s.ui.showSim);
  const settings = useStore((s) => s.ui.sim);
  const robot = useStore((s) => s.project.robot);
  const autoPeriod = useStore((s) => s.project.codegen.autoPeriod);
  const closed = effectiveEncoder(robot) !== 'none';
  const set = (patch: Partial<SimSettings>) => setUi({ sim: { ...settings, ...patch } });

  return (
    <div className="panel-scroll">
      <Section title="Real-world simulation">
        <p className="muted small">
          Runs the generated code ({closed ? 'encoder feedback' : 'open loop, no sensors'}) on a robot that does not match your settings (the
          imperfections below) and draws where it really goes (dashed orange). Playback continues until the simulated robot has finished.
        </p>
        <Checkbox label="Show simulated robot" checked={showSim} onChange={(v) => setUi({ showSim: v })} />
        {sim && showSim && (
          <dl className="stats">
            <div>
              <dt>End position error</dt>
              <dd className={positionClass(sim.positionError)}>{(sim.positionError * 100).toFixed(1)} cm</dd>
            </div>
            <div>
              <dt>End heading error</dt>
              <dd className={headingClass(sim.headingErrorDeg)}>{sim.headingErrorDeg.toFixed(1)}°</dd>
            </div>
            <div>
              <dt>Farthest from the path</dt>
              <dd className={positionClass(sim.maxPathDeviation)}>{(sim.maxPathDeviation * 100).toFixed(1)} cm</dd>
            </div>
            <div>
              <dt>Simulated time</dt>
              <dd className={sim.totalTime > autoPeriod ? 'bad' : undefined}>{sim.totalTime.toFixed(2)} s</dd>
            </div>
          </dl>
        )}
        {sim && showSim && comparison && !comparison.withEncoders && (
          <p className="sim-compare">
            The encoder feedback in the generated code corrects these imperfections. Without it, this robot would{' '}
            <Outcome result={comparison.result} />.
          </p>
        )}
        {sim && showSim && comparison?.withEncoders && (
          <div className="warning warn">
            <span>
              No encoders: the generated code plays the plan back and cannot notice or correct these imperfections. With encoders, this robot
              would <Outcome result={comparison.result} />.
            </span>
          </div>
        )}
        {sim && showSim && closed && Math.abs(settings.trackScale - 1) > 0.02 && sim.positionError > 0.1 && (
          <p className="muted small">
            Most of the remaining error is wheel scrub, which encoders cannot see. Calibrate the track width on the real robot with the
            generated &ldquo;Test: turn 360°&rdquo; auto.
          </p>
        )}
        {sim && showSim && sim.fault && (
          <div className="warning error" role="alert">
            <span>Encoder check: {faultMessage(sim.fault)} The robot finishes open loop.</span>
          </div>
        )}
        {sim && showSim && sim.timeouts > 0 && (
          <div className="warning warn">
            <span>
              {sim.timeouts === 1 ? 'One step' : `${sim.timeouts} steps`} gave up before reaching the target. The robot is too weak for the
              plan: lower the speed limits or check kS/kV/kA.
            </span>
          </div>
        )}
      </Section>
      <Section title="Robot imperfections">
        <Slider label="Left side strength" value={settings.leftScale} min={0.8} max={1.2} step={0.01} format={pct} onChange={(v) => set({ leftScale: v })} />
        <Slider label="Right side strength" value={settings.rightScale} min={0.8} max={1.2} step={0.01} format={pct} onChange={(v) => set({ rightScale: v })} />
        <Slider label="Friction (kS) error" value={settings.kSScale} min={0.5} max={1.5} step={0.05} format={pct} onChange={(v) => set({ kSScale: v })} />
        <Slider label="Slower than planned (kV)" value={settings.kVScale} min={0.9} max={1.4} step={0.01} format={pct} onChange={(v) => set({ kVScale: v })} />
        <Slider label="Heavier than planned (kA)" value={settings.kAScale} min={0.8} max={2} step={0.05} format={pct} onChange={(v) => set({ kAScale: v })} />
        <Slider
          label="Wheel scrub (track width error)"
          value={settings.trackScale}
          min={0.85}
          max={1.25}
          step={0.01}
          format={pct}
          onChange={(v) => set({ trackScale: v })}
        />
        <p className="muted small">
          These sliders only describe how the real robot differs from the Robot tab; they never change the generated code. With
          encoders, the follower waits for a slow or heavy robot instead of cutting corners, so those errors mostly cost time. Wheel scrub
          is the one error encoders cannot see: calibrate the track width with the generated &ldquo;Test: turn 360°&rdquo; auto and the
          Calibration section on the Robot tab, then set Wheel scrub back to 0% here so it is not counted twice.
        </p>
        <div className="button-row">
          <button type="button" className="btn small" onClick={() => setUi({ sim: DEFAULT_SIM })}>
            Reset
          </button>
          <button type="button" className="btn small" onClick={() => setUi({ sim: PERFECT_SIM })}>
            Perfect robot
          </button>
        </div>
      </Section>
    </div>
  );
}
