import { setUi, useStore } from '../../model/store';
import { effectiveEncoder } from '../../model/hardware';
import { DEFAULT_SIM, type SimResult, type SimSettings } from '../../planner/simulate';
import { Checkbox, Section } from '../components/controls';

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

export function SimPanel({ sim }: { sim: SimResult | null }) {
  const showSim = useStore((s) => s.ui.showSim);
  const settings = useStore((s) => s.ui.sim);
  const robot = useStore((s) => s.project.robot);
  const closed = effectiveEncoder(robot) !== 'none';
  const set = (patch: Partial<SimSettings>) => setUi({ sim: { ...settings, ...patch } });

  return (
    <div className="panel-scroll">
      <Section title="Real-world simulation">
        <p className="muted small">
          Runs the generated controller ({closed ? 'encoder feedback' : 'open loop, no sensors'}) on a robot that does not exactly match your
          settings, then draws where it really ends up (dashed orange). Use it to see how far an auto drifts without a gyro.
        </p>
        <Checkbox label="Show simulated robot" checked={showSim} onChange={(v) => setUi({ showSim: v })} />
        {sim && showSim && (
          <dl className="stats">
            <div>
              <dt>End position error</dt>
              <dd className={sim.positionError > 0.3 ? 'bad' : sim.positionError > 0.1 ? 'meh' : 'good'}>{(sim.positionError * 100).toFixed(1)} cm</dd>
            </div>
            <div>
              <dt>End heading error</dt>
              <dd className={Math.abs(sim.headingErrorDeg) > 10 ? 'bad' : Math.abs(sim.headingErrorDeg) > 3 ? 'meh' : 'good'}>{sim.headingErrorDeg.toFixed(1)}°</dd>
            </div>
            <div>
              <dt>Simulated time</dt>
              <dd>{sim.totalTime.toFixed(2)} s</dd>
            </div>
          </dl>
        )}
      </Section>
      <Section title="Robot imperfections">
        <Slider label="Left side strength" value={settings.leftScale} min={0.8} max={1.2} step={0.01} format={pct} onChange={(v) => set({ leftScale: v })} />
        <Slider label="Right side strength" value={settings.rightScale} min={0.8} max={1.2} step={0.01} format={pct} onChange={(v) => set({ rightScale: v })} />
        <Slider label="Friction (kS) error" value={settings.kSScale} min={0.5} max={1.5} step={0.05} format={pct} onChange={(v) => set({ kSScale: v })} />
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
          Wheel scrub is the one error encoders cannot see: calibrate the effective track width on the Robot tab to remove it.
        </p>
        <div className="button-row">
          <button type="button" className="btn small" onClick={() => setUi({ sim: DEFAULT_SIM })}>
            Reset
          </button>
          <button type="button" className="btn small" onClick={() => setUi({ sim: { leftScale: 1, rightScale: 1, kSScale: 1, trackScale: 1 } })}>
            Perfect robot
          </button>
        </div>
      </Section>
    </div>
  );
}
