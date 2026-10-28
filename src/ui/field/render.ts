// Canvas rendering and hit testing for the field view.

import { KIND_LABELS, bumperDistances, bumperGap, formatDistance } from '../../model/field';
import type { Auto, FieldConfig, FieldElement, RobotConfig } from '../../model/types';
import { type Vec, add, fromPolar, sub } from '../../planner/geometry';
import type { SimResult } from '../../planner/simulate';
import { simPoseAt } from '../../planner/simulate';
import { type Plan, robotCorners, sampleAt, stopIndices } from '../../planner/trajectory';

export interface View {
  /** Pixels per meter. */
  scale: number;
  /** Screen position (css px) of the field origin. */
  ox: number;
  oy: number;
}

export function toScreen(v: View, p: Vec): Vec {
  return { x: v.ox + p.x * v.scale, y: v.oy - p.y * v.scale };
}

export function toField(v: View, s: Vec): Vec {
  return { x: (s.x - v.ox) / v.scale, y: (v.oy - s.y) / v.scale };
}

export function fitView(width: number, height: number, field: FieldConfig, padding = 28): View {
  const scale = Math.max(5, Math.min((width - 2 * padding) / field.length, (height - 2 * padding) / field.width));
  return {
    scale,
    ox: (width - field.length * scale) / 2,
    oy: (height + field.width * scale) / 2,
  };
}

export type HitTarget =
  | { kind: 'point'; index: number }
  | { kind: 'handle'; index: number; which: 'in' | 'out' }
  | { kind: 'facing'; index: number }
  | { kind: 'path'; segment: number };

export function handlePos(auto: Auto, index: number, which: 'in' | 'out'): Vec {
  const w = auto.waypoints[index];
  return which === 'out' ? add(w, fromPolar(w.lenOut, w.angleOut)) : sub(w, fromPolar(w.lenIn, w.angleIn));
}

export function facingKnob(robot: RobotConfig, auto: Auto, index: number): Vec | null {
  const w = auto.waypoints[index];
  if (w.facing === null || w.aimAt) return null;
  return add(w, fromPolar(robot.length / 2 + 0.3, w.facing));
}

function visibleHandles(auto: Auto, index: number): ('in' | 'out')[] {
  const w = auto.waypoints[index];
  const n = auto.waypoints.length;
  const out: ('in' | 'out')[] = [];
  if (index > 0 && w.lenIn > 1e-3) out.push('in');
  if (index < n - 1 && w.lenOut > 1e-3) out.push('out');
  return out;
}

export function hitTest(v: View, robot: RobotConfig, auto: Auto, selected: number | null, s: Vec): HitTarget | null {
  const r2 = (a: Vec, rad: number) => (a.x - s.x) ** 2 + (a.y - s.y) ** 2 <= rad * rad;
  const n = auto.waypoints.length;
  const order = selected !== null ? [selected, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== selected)] : [...Array(n).keys()];
  for (const i of order) {
    const knob = facingKnob(robot, auto, i);
    if (knob && r2(toScreen(v, knob), 9)) return { kind: 'facing', index: i };
    for (const which of visibleHandles(auto, i)) {
      if (r2(toScreen(v, handlePos(auto, i, which)), 8)) return { kind: 'handle', index: i, which };
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    if (r2(toScreen(v, auto.waypoints[i]), 10)) return { kind: 'point', index: i };
  }
  return null;
}

/**
 * Canvas colors, read from CSS custom properties so the field follows the
 * theme. Everything is deliberately muted: no glows, no gradients, no halos.
 */
export interface Palette {
  surround: string;
  carpet: string;
  line: string;
  grid: string;
  blue: string;
  red: string;
  accent: string;
  point: string;
  pointStroke: string;
  start: string;
  end: string;
  handle: string;
  handleIn: string;
  ghost: string;
  robot: string;
  sim: string;
  guide: string;
  aim: string;
  labelBg: string;
  labelText: string;
  bumpHatch: string;
  /** Path speed ramp: hue, saturation and lightness range (HSL). */
  pathHue: number;
  pathSat: number;
  pathLightSlow: number;
  pathLightFast: number;
}

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const n = (name: string, fallback: number) => {
    const x = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(x) ? x : fallback;
  };
  return {
    surround: v('--canvas-surround', '#101214'),
    carpet: v('--canvas-carpet', '#262c2a'),
    line: v('--canvas-line', 'rgba(220,224,230,0.45)'),
    grid: v('--canvas-grid', 'rgba(220,224,230,0.05)'),
    blue: v('--canvas-blue', '#5b84b8'),
    red: v('--canvas-red', '#b86a6a'),
    accent: v('--canvas-accent', '#7aa2d6'),
    point: v('--canvas-point', '#d5d8dd'),
    pointStroke: v('--canvas-point-stroke', '#101214'),
    start: v('--canvas-start', '#7fae8a'),
    end: v('--canvas-end', '#c47a7a'),
    handle: v('--canvas-handle', 'rgba(213,216,221,0.5)'),
    handleIn: v('--canvas-handle-in', '#8c939d'),
    ghost: v('--canvas-ghost', 'rgba(213,216,221,0.22)'),
    robot: v('--canvas-robot', '#7aa2d6'),
    sim: v('--canvas-sim', '#c98f63'),
    guide: v('--canvas-guide', '#c8a45a'),
    aim: v('--canvas-aim', '#c8a45a'),
    labelBg: v('--canvas-label-bg', 'rgba(16,18,20,0.8)'),
    labelText: v('--canvas-label-text', '#d5d8dd'),
    bumpHatch: v('--canvas-bump-hatch', 'rgba(213,216,221,0.16)'),
    pathHue: n('--canvas-path-hue', 172),
    pathSat: n('--canvas-path-sat', 28),
    pathLightSlow: n('--canvas-path-light-slow', 40),
    pathLightFast: n('--canvas-path-light-fast', 68),
  };
}

/** Speed colour: a single muted hue, darker when slow and lighter when fast. */
export function speedColor(fraction: number, pal: Palette): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const l = pal.pathLightSlow + f * (pal.pathLightFast - pal.pathLightSlow);
  return `hsl(${pal.pathHue} ${pal.pathSat}% ${l}%)`;
}

/** Appends an alpha channel to a #rrggbb color (falls back to the color itself). */
function alpha(color: string, a: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return `${color}${Math.round(Math.max(0, Math.min(1, a)) * 255)
      .toString(16)
      .padStart(2, '0')}`;
  }
  return color;
}

export interface RenderInput {
  view: View;
  width: number;
  height: number;
  field: FieldConfig;
  image: HTMLImageElement | null;
  robot: RobotConfig;
  auto: Auto | undefined;
  plan: Plan | null;
  sim: SimResult | null;
  selected: number | null;
  hover: HitTarget | null;
  time: number;
  palette: Palette;
  insertPreview: Vec | null;
  /** Bumper distance guides (start pose to the walls, aimed stops to the HUB). */
  showGuides: boolean;
}

interface RobotStyle {
  fill?: string;
  stroke: string;
  dash?: number[];
  width?: number;
  front: string;
}

function drawRobot(ctx: CanvasRenderingContext2D, v: View, robot: RobotConfig, x: number, y: number, heading: number, style: RobotStyle): void {
  const corners = robotCorners(robot, x, y, heading).map((p) => toScreen(v, p));
  ctx.save();
  ctx.beginPath();
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
  ctx.closePath();
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  ctx.setLineDash(style.dash ?? []);
  ctx.lineWidth = style.width ?? 1.5;
  ctx.strokeStyle = style.stroke;
  ctx.stroke();
  ctx.setLineDash([]);
  // Front marker: a small triangle pointing in the facing direction.
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const local = (lx: number, ly: number) => toScreen(v, { x: x + lx * c - ly * s, y: y + lx * s + ly * c });
  const hl = robot.length / 2;
  const depth = Math.min(0.22, robot.length * 0.25);
  const tip = local(hl - 0.05, 0);
  const l = local(hl - 0.05 - depth, robot.width * 0.18);
  const r = local(hl - 0.05 - depth, -robot.width * 0.18);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(l.x, l.y);
  ctx.lineTo(r.x, r.y);
  ctx.closePath();
  ctx.fillStyle = style.front;
  ctx.fill();
  ctx.restore();
}

function drawField(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, field, image, palette: pal } = input;
  const tl = toScreen(v, { x: 0, y: field.width });
  const w = field.length * v.scale;
  const h = field.width * v.scale;
  if (image) {
    ctx.drawImage(image, tl.x, tl.y, w, h);
  } else {
    ctx.fillStyle = pal.carpet;
    ctx.fillRect(tl.x, tl.y, w, h);
    // Grid every meter.
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < field.length; x++) {
      const s = toScreen(v, { x, y: 0 });
      ctx.moveTo(Math.round(s.x) + 0.5, tl.y);
      ctx.lineTo(Math.round(s.x) + 0.5, tl.y + h);
    }
    for (let y = 1; y < field.width; y++) {
      const s = toScreen(v, { x: 0, y });
      ctx.moveTo(tl.x, Math.round(s.y) + 0.5);
      ctx.lineTo(tl.x + w, Math.round(s.y) + 0.5);
    }
    ctx.stroke();
    // Center line.
    const c = toScreen(v, { x: field.length / 2, y: 0 });
    ctx.strokeStyle = pal.line;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(Math.round(c.x) + 0.5, tl.y);
    ctx.lineTo(Math.round(c.x) + 0.5, tl.y + h);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Alliance labels, quiet.
    ctx.font = `600 ${Math.max(9, Math.min(12, v.scale * 0.24))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.ghost;
    for (const [x, angle, text] of [
      [tl.x + 12, -Math.PI / 2, 'BLUE ALLIANCE'],
      [tl.x + w - 12, Math.PI / 2, 'RED ALLIANCE'],
    ] as const) {
      ctx.save();
      ctx.translate(x, tl.y + h / 2);
      ctx.rotate(angle);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
  // Field border and thin alliance-wall strips (no gradients).
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tl.x, tl.y, w, h);
  ctx.fillStyle = pal.blue;
  ctx.fillRect(tl.x - 4, tl.y, 4, h);
  ctx.fillStyle = pal.red;
  ctx.fillRect(tl.x + w, tl.y, 4, h);
  // Origin axes.
  const o = toScreen(v, { x: 0, y: 0 });
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.end;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + 22, o.y);
  ctx.stroke();
  ctx.strokeStyle = pal.start;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x, o.y - 22);
  ctx.stroke();
}

function elementRect(v: View, e: FieldElement): { x: number; y: number; w: number; h: number } {
  const tl = toScreen(v, { x: e.x - e.sizeX / 2, y: e.y + e.sizeY / 2 });
  return { x: tl.x, y: tl.y, w: e.sizeX * v.scale, h: e.sizeY * v.scale };
}

function smallLabel(ctx: CanvasRenderingContext2D, pal: Palette, text: string, x: number, y: number, rotate = false): void {
  ctx.save();
  ctx.translate(x, y);
  if (rotate) ctx.rotate(-Math.PI / 2);
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.labelText;
  ctx.globalAlpha = 0.75;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** HUBs, BUMPs and TRENCHes (2026). */
function drawElements(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, field, palette: pal } = input;
  if (!field.elementsEnabled) return;
  const order = { trench: 0, bump: 1, hub: 2 };
  for (const e of [...field.elements].sort((a, b) => order[a.kind] - order[b.kind])) {
    const r = elementRect(v, e);
    if (!(r.w > 0 && r.h > 0)) continue;
    const color = e.alliance === 'blue' ? pal.blue : pal.red;
    const big = r.w > 30 && r.h > 30;
    ctx.save();
    if (e.kind === 'hub') {
      ctx.fillStyle = alpha(color, 0.38);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = alpha(color, 0.85);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.4, 0, Math.PI * 2);
      ctx.strokeStyle = alpha(color, 0.6);
      ctx.stroke();
      if (big) smallLabel(ctx, pal, KIND_LABELS.hub, r.x + r.w / 2, r.y + r.h / 2);
    } else if (e.kind === 'bump') {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.strokeStyle = pal.bumpHatch;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -r.h; d < r.w; d += 8) {
        ctx.moveTo(r.x + d, r.y + r.h);
        ctx.lineTo(r.x + d + r.h, r.y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = alpha(color, 0.55);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (big) smallLabel(ctx, pal, KIND_LABELS.bump, r.x + r.w / 2, r.y + r.h / 2, true);
    } else {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = alpha(color, 0.5);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (big) smallLabel(ctx, pal, KIND_LABELS.trench, r.x + r.w / 2, r.y + r.h / 2, true);
    }
    ctx.restore();
  }
}

function drawPath(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, plan, robot, palette: pal } = input;
  if (!plan) return;
  const vmax = Math.max(0.1, robot.maxVelocity);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const st of plan.steps) {
    if (st.kind !== 'drive') continue;
    const pts = st.samples.map((s) => toScreen(v, s));
    // Thin dark casing keeps the path readable on any field image.
    ctx.strokeStyle = pal.labelBg;
    ctx.lineWidth = 5;
    ctx.setLineDash([]);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.lineWidth = 2.5;
    if (st.reversed) ctx.setLineDash([8, 6]);
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = speedColor(Math.abs(st.samples[i].v) / vmax, pal);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawStopGhosts(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, plan, robot, palette: pal, auto } = input;
  if (!plan || !auto) return;
  // Robot outline wherever the robot comes to rest (start, stops, end).
  const poses: { x: number; y: number; heading: number }[] = [plan.startPose];
  for (const st of plan.steps) {
    if (st.kind === 'drive' || st.kind === 'turn') {
      const last = st.samples[st.samples.length - 1];
      poses.push({ x: last.x, y: last.y, heading: last.heading });
    }
  }
  poses.forEach((p, i) => {
    drawRobot(ctx, v, robot, p.x, p.y, p.heading, {
      stroke: i === 0 ? pal.handle : pal.ghost,
      width: 1,
      dash: i === 0 ? undefined : [3, 4],
      front: pal.ghost,
    });
  });
}

function drawHandlesAndPoints(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, auto, selected, hover, palette: pal, robot } = input;
  if (!auto) return;
  const n = auto.waypoints.length;
  const stops = new Set(stopIndices(auto.waypoints));
  for (let i = 0; i < n; i++) {
    const w = auto.waypoints[i];
    const p = toScreen(v, w);
    const isSel = selected === i;
    for (const which of visibleHandles(auto, i)) {
      const h = toScreen(v, handlePos(auto, i, which));
      const hot = hover?.kind === 'handle' && hover.index === i && hover.which === which;
      ctx.globalAlpha = isSel ? 1 : 0.5;
      ctx.strokeStyle = pal.handle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.x, h.y, hot ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = which === 'out' ? pal.accent : pal.handleIn;
      ctx.fill();
      ctx.strokeStyle = pal.pointStroke;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Aim line for stop points that face a field element.
    const target = w.aimAt ? input.field.elements.find((e) => e.id === w.aimAt) : undefined;
    if (target && input.field.elementsEnabled) {
      const t = toScreen(v, target);
      ctx.save();
      ctx.strokeStyle = pal.aim;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
      ctx.moveTo(t.x - 7, t.y);
      ctx.lineTo(t.x + 7, t.y);
      ctx.moveTo(t.x, t.y - 7);
      ctx.lineTo(t.x, t.y + 7);
      ctx.stroke();
      ctx.restore();
    }
    // Facing arrow for stop points that turn to a heading.
    const knob = facingKnob(robot, auto, i);
    if (knob) {
      const k = toScreen(v, knob);
      ctx.strokeStyle = pal.aim;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(k.x, k.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(k.x, k.y, hover?.kind === 'facing' && hover.index === i ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = pal.aim;
      ctx.fill();
      ctx.strokeStyle = pal.pointStroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  for (let i = 0; i < n; i++) {
    const w = auto.waypoints[i];
    const p = toScreen(v, w);
    const isSel = selected === i;
    const hot = hover?.kind === 'point' && hover.index === i;
    const r = hot || isSel ? 6.5 : 5.5;
    ctx.beginPath();
    if (stops.has(i)) ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
    else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? pal.accent : i === 0 ? pal.start : i === n - 1 ? pal.end : pal.point;
    ctx.fill();
    ctx.lineWidth = isSel ? 2 : 1.5;
    ctx.strokeStyle = isSel ? pal.point : pal.pointStroke;
    ctx.stroke();
    // Index label.
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = pal.labelText;
    ctx.fillText(String(i + 1), p.x + 8, p.y - 6);
    // Actions / markers tags.
    const tags = [...w.actions.map((a) => (a.kind === 'command' ? a.name : `wait ${a.seconds}s`)), ...w.markers.map((m) => `▸ ${m}`)];
    if (tags.length) {
      ctx.font = '500 10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      tags.slice(0, 4).forEach((t, k) => {
        const text = k === 3 && tags.length > 4 ? `+${tags.length - 3} more` : t;
        const y = p.y + 9 + k * 14;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = pal.labelBg;
        ctx.fillRect(p.x + 7, y - 1, tw + 8, 13);
        ctx.fillStyle = pal.labelText;
        ctx.fillText(text, p.x + 11, y + 1);
      });
    }
  }
}

function drawSim(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, sim, palette: pal } = input;
  if (!sim || sim.trace.length < 2) return;
  ctx.save();
  ctx.strokeStyle = pal.sim;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  sim.trace.forEach((p, i) => {
    const s = toScreen(v, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawLiveRobots(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, plan, sim, robot, time, palette: pal } = input;
  if (!plan) return;
  if (sim) {
    const sp = simPoseAt(sim, time);
    drawRobot(ctx, v, robot, sp.x, sp.y, sp.heading, { stroke: pal.sim, dash: [4, 4], width: 1.5, front: pal.sim });
  }
  const s = sampleAt(plan, time);
  drawRobot(ctx, v, robot, s.x, s.y, s.heading, {
    fill: alpha(pal.robot, 0.2),
    stroke: pal.robot,
    width: 2,
    front: pal.robot,
  });
}

function drawInsertPreview(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  if (!input.insertPreview) return;
  const p = toScreen(input.view, input.insertPreview);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = input.palette.ghost;
  ctx.fill();
  ctx.strokeStyle = input.palette.point;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A measurement line with end ticks and a distance label. */
function dimension(ctx: CanvasRenderingContext2D, pal: Palette, a: Vec, b: Vec, text: string, color: string): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 4) return;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  for (const p of [a, b]) {
    ctx.moveTo(p.x + nx * 4, p.y + ny * 4);
    ctx.lineTo(p.x - nx * 4, p.y - ny * 4);
  }
  ctx.stroke();
  ctx.font = '500 10px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  ctx.fillStyle = pal.labelBg;
  ctx.fillRect(mx - w / 2, my - 8, w, 16);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, mx, my);
  ctx.restore();
}

/** Bumper placement guides: start pose to the walls, aimed stops to their target. */
function drawGuides(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, plan, robot, field, auto, selected, palette: pal } = input;
  if (!input.showGuides || !plan || !auto) return;
  const start = plan.startPose;
  const d = bumperDistances(robot, start, field);
  const wallX = d.wall.side === 'blue' ? 0 : field.length;
  dimension(ctx, pal, toScreen(v, d.wall.from), toScreen(v, { x: wallX, y: d.wall.from.y }), formatDistance(d.wall.distance), pal.guide);
  const railY = d.rail.side === 'right' ? 0 : field.width;
  dimension(ctx, pal, toScreen(v, d.rail.from), toScreen(v, { x: d.rail.from.x, y: railY }), formatDistance(d.rail.distance), pal.guide);

  if (!field.elementsEnabled) return;
  // Front bumper to the aimed element, for the start point and the selected stop.
  const indices = new Set<number>([0]);
  if (selected !== null) indices.add(selected);
  for (const i of indices) {
    const w = auto.waypoints[i];
    const target = w?.aimAt ? field.elements.find((e) => e.id === w.aimAt) : undefined;
    if (!target) continue;
    const gap = bumperGap(target, w.x, w.y, robot);
    const dir = Math.atan2(target.y - w.y, target.x - w.x);
    const front = { x: w.x + Math.cos(dir) * (robot.length / 2), y: w.y + Math.sin(dir) * (robot.length / 2) };
    const end = { x: front.x + Math.cos(dir) * Math.max(gap, 0), y: front.y + Math.sin(dir) * Math.max(gap, 0) };
    dimension(ctx, pal, toScreen(v, front), toScreen(v, end), `to ${KIND_LABELS[target.kind]} ${formatDistance(gap)}`, gap < 0 ? pal.end : pal.guide);
  }
}

export function renderField(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  ctx.fillStyle = input.palette.surround;
  ctx.fillRect(0, 0, input.width, input.height);
  drawField(ctx, input);
  drawElements(ctx, input);
  drawStopGhosts(ctx, input);
  drawPath(ctx, input);
  drawSim(ctx, input);
  drawLiveRobots(ctx, input);
  drawHandlesAndPoints(ctx, input);
  drawGuides(ctx, input);
  drawInsertPreview(ctx, input);
}
