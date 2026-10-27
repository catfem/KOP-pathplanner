import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { setUi, useStore } from '../model/store';
import type { RobotConfig } from '../model/types';
import { type Plan, feedforwardVolts } from '../planner/trajectory';
import { Segmented } from './controls';

type Mode = 'velocity' | 'voltage';

interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

interface ChartData {
  times: number[];
  series: { key: string; label: string; colorVar: string; values: number[] }[];
  unit: string;
}

/** Samples the whole auto on a common time grid. */
function buildData(plan: Plan, robot: RobotConfig, mode: Mode): ChartData {
  const times: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const center: number[] = [];
  const push = (t: number, l: number, r: number, c: number) => {
    times.push(t);
    left.push(l);
    right.push(r);
    center.push(c);
  };
  for (const st of plan.steps) {
    if (st.kind === 'drive' || st.kind === 'turn') {
      for (const s of st.samples) {
        if (mode === 'velocity') push(st.start + s.t, s.lVel, s.rVel, s.v);
        else push(st.start + s.t, feedforwardVolts(robot, s.lVel, s.lAcc), feedforwardVolts(robot, s.rVel, s.rAcc), 0);
      }
    } else {
      push(st.start, 0, 0, 0);
      push(st.start + st.duration, 0, 0, 0);
    }
  }
  if (times.length === 0) push(0, 0, 0, 0);
  const series =
    mode === 'velocity'
      ? [
          { key: 'left', label: 'Left wheel', colorVar: '--series-1', values: left },
          { key: 'right', label: 'Right wheel', colorVar: '--series-2', values: right },
          { key: 'center', label: 'Robot', colorVar: '--series-3', values: center },
        ]
      : [
          { key: 'left', label: 'Left volts', colorVar: '--series-1', values: left },
          { key: 'right', label: 'Right volts', colorVar: '--series-2', values: right },
        ];
  return { times, series, unit: mode === 'velocity' ? 'm/s' : 'V' };
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

const PAD = { left: 40, right: 12, top: 10, bottom: 22 };

function LineKey({ colorVar, dashed }: { colorVar: string; dashed: boolean }) {
  return (
    <svg className="line-key" width="16" height="6" aria-hidden>
      <line x1="0" y1="3" x2="16" y2="3" stroke={`var(${colorVar})`} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} />
    </svg>
  );
}

export function VelocityChart({ plan }: { plan: Plan | null }) {
  const robot = useStore((s) => s.project.robot);
  const time = useStore((s) => s.ui.time);
  const [mode, setMode] = useState<Mode>('velocity');
  const [hoverX, setHoverX] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = 130;

  const data = useMemo(() => (plan ? buildData(plan, robot, mode) : null), [plan, robot, mode]);
  const total = plan?.totalTime || 1;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const yRange = useMemo(() => {
    if (!data) return { min: -1, max: 1 };
    let lo = 0;
    let hi = 0;
    for (const s of data.series) for (const v of s.values) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (mode === 'voltage') {
      lo = Math.min(lo, -robot.maxVoltage);
      hi = Math.max(hi, robot.maxVoltage);
    }
    const pad = (hi - lo) * 0.08 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [data, mode, robot.maxVoltage]);

  const xOf = (t: number) => PAD.left + (t / total) * (width - PAD.left - PAD.right);
  const yOf = (v: number) => PAD.top + ((yRange.max - v) / (yRange.max - yRange.min)) * (height - PAD.top - PAD.bottom);

  const hoverIndex = useMemo(() => {
    if (hoverX === null || !data) return null;
    const t = ((hoverX - PAD.left) / (width - PAD.left - PAD.right)) * total;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < data.times.length; i++) {
      const d = Math.abs(data.times[i] - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }, [hoverX, data, width, total]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(canvas);
    const css = (n: string) => cs.getPropertyValue(n).trim();
    ctx.clearRect(0, 0, width, height);
    if (!data) return;
    const series: Series[] = data.series.map((s) => ({ ...s, color: css(s.colorVar) }));
    // Gridlines and y ticks.
    const step = niceStep(yRange.max - yRange.min, 4);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = Math.ceil(yRange.min / step) * step; v <= yRange.max; v += step) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? css('--chart-axis') : css('--chart-grid');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.stroke();
      ctx.fillText(`${Number(v.toFixed(2))}`, PAD.left - 6, y);
    }
    // X ticks.
    const xStep = niceStep(total, Math.max(2, Math.floor(width / 90)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= total + 1e-9; t += xStep) {
      ctx.fillText(`${Number(t.toFixed(1))}s`, xOf(t), height - PAD.bottom + 6);
    }
    // Series.
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.setLineDash(s.key === 'center' ? [5, 4] : []);
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = xOf(data.times[i]);
        const y = yOf(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Playhead.
    const px = Math.round(xOf(Math.min(time, total))) + 0.5;
    ctx.strokeStyle = css('--text');
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(px, PAD.top);
    ctx.lineTo(px, height - PAD.bottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Crosshair.
    if (hoverIndex !== null) {
      const hx = Math.round(xOf(data.times[hoverIndex])) + 0.5;
      ctx.strokeStyle = css('--muted');
      ctx.beginPath();
      ctx.moveTo(hx, PAD.top);
      ctx.lineTo(hx, height - PAD.bottom);
      ctx.stroke();
      for (const s of series) {
        ctx.beginPath();
        ctx.arc(hx, yOf(s.values[hoverIndex]), 4, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.strokeStyle = css('--panel');
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  });

  const tooltip =
    hoverIndex !== null && data ? (
      <div
        className="chart-tooltip"
        style={{
          left: Math.min(Math.max(xOf(data.times[hoverIndex]) + 10, 0), Math.max(0, width - 170)),
        }}
      >
        <div className="tt-time">{data.times[hoverIndex].toFixed(2)} s</div>
        {data.series.map((s) => (
          <div className="tt-row" key={s.key}>
            <LineKey colorVar={s.colorVar} dashed={s.key === 'center'} />
            <strong>
              {s.values[hoverIndex].toFixed(2)} {data.unit}
            </strong>
            <span className="tt-label">{s.label}</span>
          </div>
        ))}
      </div>
    ) : null;

  return (
    <div className="chart-panel">
      <div className="chart-head">
        <Segmented
          label="Chart"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'velocity', label: 'Wheel speed' },
            { value: 'voltage', label: 'Feedforward volts' },
          ]}
        />
        <div className="chart-legend">
          {data?.series.map((s) => (
            <span key={s.key} className="legend-item">
              <LineKey colorVar={s.colorVar} dashed={s.key === 'center'} />
              {s.label}
            </span>
          ))}
          <span className="legend-unit">{data?.unit}</span>
        </div>
      </div>
      <div
        className="chart-wrap"
        ref={wrapRef}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(e.clientX - rect.left);
        }}
        onPointerLeave={() => setHoverX(null)}
        onClick={() => {
          if (hoverIndex !== null && data) setUi({ time: data.times[hoverIndex], playing: false });
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height }}
          role="img"
          aria-label={mode === 'velocity' ? 'Left, right and robot speed over the auto' : 'Feedforward voltage per side over the auto'}
        />
        {tooltip}
      </div>
    </div>
  );
}
