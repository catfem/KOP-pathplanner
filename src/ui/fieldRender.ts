// Canvas rendering and hit testing for the field view.

import { KIND_LABELS, bumperDistances, bumperGap, formatDistance } from '../model/field';
import type { Auto, FieldConfig, FieldElement, RobotConfig } from '../model/types';
import { type Vec, add, fromPolar, sub } from '../planner/geometry';
import type { SimResult } from '../planner/simulate';
import { simPoseAt } from '../planner/simulate';
import { type Plan, robotCorners, sampleAt, stopIndices } from '../planner/trajectory';

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

export interface Palette {
  surround: string;
  carpet: string;
  fieldLine: string;
  grid: string;
  blue: string;
  red: string;
  accent: string;
  pointFill: string;
  pointStroke: string;
  text: string;
  sim: string;
  handle: string;
  ghost: string;
  warn: string;
}

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    surround: v('--field-surround', '#14171b'),
    carpet: v('--field-carpet', '#2f3833'),
    fieldLine: v('--field-line', 'rgba(255,255,255,0.8)'),
    grid: v('--field-grid', 'rgba(255,255,255,0.07)'),
    blue: v('--alliance-blue', '#2a78d6'),
    red: v('--alliance-red', '#e34948'),
    accent: v('--accent', '#3987e5'),
    pointFill: '#ffffff',
    pointStroke: '#0b0b0b',
    text: '#f0efec',
    sim: v('--sim-color', '#eb6834'),
    handle: 'rgba(255,255,255,0.75)',
    ghost: 'rgba(255,255,255,0.35)',
    warn: v('--warn', '#fab219'),
  };
}

/** Speed colour: one hue (teal), dim when slow, bright when fast. */
export function speedColor(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  const l = 48 + f * 40;
  const s = 70 - f * 25;
  return `hsl(172 ${s}% ${l}%)`;
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

function drawRobot(
  ctx: CanvasRenderingContext2D,
  v: View,
  robot: RobotConfig,
  x: number,
  y: number,
  heading: number,
  style: { fill?: string; stroke: string; dash?: number[]; alpha?: number; front?: string; width?: number },
): void {
  const corners = robotCorners(robot, x, y, heading).map((p) => toScreen(v, p));
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.beginPath();
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
  ctx.closePath();
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  ctx.setLineDash(style.dash ?? []);
  ctx.lineWidth = style.width ?? 2;
  ctx.strokeStyle = style.stroke;
  ctx.stroke();
  ctx.setLineDash([]);
  // Front marker: a triangle pointing in the facing direction.
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const local = (lx: number, ly: number) => toScreen(v, { x: x + lx * c - ly * s, y: y + lx * s + ly * c });
  const hl = robot.length / 2;
  const depth = Math.min(0.25, robot.length * 0.3);
  const tip = local(hl - 0.04, 0);
  const l = local(hl - 0.04 - depth, robot.width * 0.22);
  const r = local(hl - 0.04 - depth, -robot.width * 0.22);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(l.x, l.y);
  ctx.lineTo(r.x, r.y);
  ctx.closePath();
  ctx.fillStyle = style.front ?? style.stroke;
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
    // Alliance wall tints.
    const zone = Math.min(2, field.length * 0.12) * v.scale;
    const gradB = ctx.createLinearGradient(tl.x, 0, tl.x + zone, 0);
    gradB.addColorStop(0, `${pal.blue}55`);
    gradB.addColorStop(1, `${pal.blue}00`);
    ctx.fillStyle = gradB;
    ctx.fillRect(tl.x, tl.y, zone, h);
    const gradR = ctx.createLinearGradient(tl.x + w, 0, tl.x + w - zone, 0);
    gradR.addColorStop(0, `${pal.red}55`);
    gradR.addColorStop(1, `${pal.red}00`);
    ctx.fillStyle = gradR;
    ctx.fillRect(tl.x + w - zone, tl.y, zone, h);
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
    ctx.strokeStyle = pal.fieldLine;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(c.x, tl.y);
    ctx.lineTo(c.x, tl.y + h);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Alliance labels.
    ctx.font = `600 ${Math.max(10, Math.min(16, v.scale * 0.3))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.save();
    ctx.translate(tl.x + 14, tl.y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('BLUE ALLIANCE', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(tl.x + w - 14, tl.y + h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('RED ALLIANCE', 0, 0);
    ctx.restore();
  }
  ctx.strokeStyle = pal.fieldLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(tl.x, tl.y, w, h);
  // Origin axes.
  const o = toScreen(v, { x: 0, y: 0 });
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#e34948';
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + 28, o.y);
  ctx.stroke();
  ctx.strokeStyle = '#1baf7a';
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x, o.y - 28);
  ctx.stroke();
}

function drawPath(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, plan, robot } = input;
  if (!plan) return;
  const vmax = Math.max(0.1, robot.maxVelocity);
  for (const st of plan.steps) {
    if (st.kind !== 'drive') continue;
    const pts = st.samples.map((s) => toScreen(v, s));
    // Casing for contrast on any background.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 7;
    ctx.setLineDash([]);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.lineWidth = 3.5;
    if (st.reversed) ctx.setLineDash([10, 6]);
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = speedColor(Math.abs(st.samples[i].v) / vmax);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
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
      stroke: i === 0 ? '#ffffff' : pal.ghost,
      alpha: i === 0 ? 0.7 : 0.8,
      width: i === 0 ? 2 : 1.5,
      dash: i === 0 ? undefined : [4, 4],
      front: i === 0 ? 'rgba(255,255,255,0.7)' : pal.ghost,
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
      ctx.globalAlpha = isSel ? 1 : 0.55;
      ctx.strokeStyle = pal.handle;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.x, h.y, hot ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = which === 'out' ? pal.accent : '#9aa0aa';
      ctx.fill();
      ctx.strokeStyle = '#0b0b0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Aim line for stop points that face a field element.
    const target = w.aimAt ? input.field.elements.find((e) => e.id === w.aimAt) : undefined;
    if (target && input.field.elementsEnabled) {
      const t = toScreen(v, target);
      ctx.strokeStyle = pal.warn;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
      ctx.moveTo(t.x - 9, t.y);
      ctx.lineTo(t.x + 9, t.y);
      ctx.moveTo(t.x, t.y - 9);
      ctx.lineTo(t.x, t.y + 9);
      ctx.stroke();
    }
    // Facing arrow for stop points that turn to a heading.
    const knob = facingKnob(robot, auto, i);
    if (knob) {
      const k = toScreen(v, knob);
      ctx.strokeStyle = pal.warn;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(k.x, k.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(k.x, k.y, hover?.kind === 'facing' && hover.index === i ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = pal.warn;
      ctx.fill();
      ctx.strokeStyle = '#0b0b0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  for (let i = 0; i < n; i++) {
    const w = auto.waypoints[i];
    const p = toScreen(v, w);
    const isSel = selected === i;
    const hot = hover?.kind === 'point' && hover.index === i;
    const r = hot || isSel ? 8 : 6.5;
    ctx.beginPath();
    if (stops.has(i)) {
      ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
    } else {
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = isSel ? pal.accent : i === 0 ? '#1baf7a' : i === n - 1 ? '#e34948' : pal.pointFill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isSel ? '#ffffff' : pal.pointStroke;
    ctx.stroke();
    // Index label.
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = String(i + 1);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(label, p.x + 9, p.y - 7);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, p.x + 9, p.y - 7);
    // Actions / markers badges.
    const tags = [
      ...w.actions.map((a) => (a.kind === 'command' ? a.name : `wait ${a.seconds}s`)),
      ...w.markers.map((m) => `▶ ${m}`),
    ];
    if (tags.length) {
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      tags.slice(0, 4).forEach((t, k) => {
        const text = k === 3 && tags.length > 4 ? `+${tags.length - 3} more` : t;
        const y = p.y + 10 + k * 15;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(11,11,11,0.75)';
        ctx.fillRect(p.x + 8, y - 1, tw + 8, 15);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, p.x + 12, y + 1);
      });
    }
  }
}

function drawSim(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, sim, palette: pal } = input;
  if (!sim || sim.trace.length < 2) return;
  ctx.strokeStyle = pal.sim;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  sim.trace.forEach((p, i) => {
    const s = toScreen(v, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLiveRobots(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { view: v, plan, sim, robot, time, palette: pal } = input;
  if (!plan) return;
  if (sim) {
    const sp = simPoseAt(sim, time);
    drawRobot(ctx, v, robot, sp.x, sp.y, sp.heading, { stroke: pal.sim, dash: [5, 4], width: 2, front: pal.sim, alpha: 0.95 });
  }
  const s = sampleAt(plan, time);
  drawRobot(ctx, v, robot, s.x, s.y, s.heading, {
    fill: `${pal.blue}66`,
    stroke: pal.blue,
    width: 3,
    front: '#ffffff',
  });
}

function drawInsertPreview(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  if (!input.insertPreview) return;
  const p = toScreen(input.view, input.insertPreview);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
  ctx.strokeStyle = '#0b0b0b';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function elementRect(v: View, e: FieldElement): { x: number; y: number; w: number; h: number } {
  const tl = toScreen(v, { x: e.x - e.sizeX / 2, y: e.y + e.sizeY / 2 });
  return { x: tl.x, y: tl.y, w: e.sizeX * v.scale, h: e.sizeY * v.scale };
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, rotate = false): void {
  ctx.save();
  ctx.translate(x, y);
  if (rotate) ctx.rotate(-Math.PI / 2);
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
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
    const color = e.alliance === 'blue' ? pal.blue : pal.red;
    const big = r.w > 34 && r.h > 34;
    ctx.save();
    if (e.kind === 'hub') {
      ctx.fillStyle = `${color}99`;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      // Top opening (41.7 in across).
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      if (big) label(ctx, KIND_LABELS.hub, r.x + r.w / 2, r.y + r.h / 2);
    } else if (e.kind === 'bump') {
      ctx.fillStyle = 'rgba(210,214,220,0.16)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // Ramp hatching.
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(230,232,236,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -r.h; d < r.w; d += 7) {
        ctx.moveTo(r.x + d, r.y + r.h);
        ctx.lineTo(r.x + d + r.h, r.y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = `${color}cc`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      if (big) label(ctx, KIND_LABELS.bump, r.x + r.w / 2, r.y + r.h / 2, true);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = `${color}bb`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      if (big) label(ctx, KIND_LABELS.trench, r.x + r.w / 2, r.y + r.h / 2, true);
    }
    ctx.restore();
  }
}

/** A measurement line with end ticks and a distance label. */
function dimension(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, text: string, color: string): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 4) return;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  for (const p of [a, b]) {
    ctx.moveTo(p.x + nx * 5, p.y + ny * 5);
    ctx.lineTo(p.x - nx * 5, p.y - ny * 5);
  }
  ctx.stroke();
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  ctx.fillStyle = 'rgba(11,11,11,0.82)';
  ctx.fillRect(mx - w / 2, my - 9, w, 18);
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
  const color = '#ffd36b';
  const start = plan.startPose;
  const d = bumperDistances(robot, start, field);
  const wallX = d.wall.side === 'blue' ? 0 : field.length;
  dimension(ctx, toScreen(v, d.wall.from), toScreen(v, { x: wallX, y: d.wall.from.y }), formatDistance(d.wall.distance), color);
  const railY = d.rail.side === 'right' ? 0 : field.width;
  dimension(ctx, toScreen(v, d.rail.from), toScreen(v, { x: d.rail.from.x, y: railY }), formatDistance(d.rail.distance), color);

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
    dimension(ctx, toScreen(v, front), toScreen(v, end), `to ${KIND_LABELS[target.kind]} ${formatDistance(gap)}`, gap < 0 ? pal.red : color);
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
