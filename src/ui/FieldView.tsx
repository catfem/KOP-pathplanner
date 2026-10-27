import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appendWaypoint, dragHandle, insertWaypoint, nearestOnPath, round } from '../model/edit';
import { checkpoint, setUi, updateAuto, useStore } from '../model/store';
import type { Auto } from '../model/types';
import { type Vec, angleOf, bezierPoint, sub } from '../planner/geometry';
import type { SimResult } from '../planner/simulate';
import { type Plan, segmentBezier } from '../planner/trajectory';
import { IconButton, Segmented } from './controls';
import { type HitTarget, type View, fitView, hitTest, readPalette, renderField, speedColor, toField } from './fieldRender';
import { IconCurve, IconFit, IconLine, IconMagnet, IconPlus, IconPointer } from './icons';

type Drag =
  | { kind: 'point'; index: number; offset: Vec }
  | { kind: 'handle'; index: number; which: 'in' | 'out' }
  | { kind: 'facing'; index: number }
  | { kind: 'pan'; start: Vec; view: View; moved: boolean };

const SNAP_POS = 0.05;
const SNAP_DEG = 15;

export function FieldView({ plan, sim }: { plan: Plan | null; sim: SimResult | null }) {
  const project = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const fieldImage = useStore((s) => s.fieldImage);
  const auto = project.autos.find((a) => a.id === ui.selectedAutoId);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const userMovedView = useRef(false);
  const [hover, setHover] = useState<HitTarget | null>(null);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [insertPreview, setInsertPreview] = useState<Vec | null>(null);
  const drag = useRef<Drag | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!fieldImage) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = fieldImage;
  }, [fieldImage]);

  // Track container size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (size.w > 0 && size.h > 0) setView(fitView(size.w, size.h, project.field));
    userMovedView.current = false;
  }, [size.w, size.h, project.field]);

  useEffect(() => {
    if (!userMovedView.current || !view) fit();
    // Refit when the field size changes or the container resizes (unless the user zoomed).
  }, [size.w, size.h, project.field.length, project.field.width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderField(ctx, {
      view,
      width: size.w,
      height: size.h,
      field: project.field,
      image,
      robot: project.robot,
      auto,
      plan,
      sim,
      selected: ui.selectedIndex,
      hover,
      time: ui.time,
      palette: readPalette(canvas),
      insertPreview,
    });
  });

  // Wheel zoom (non-passive so the page does not scroll).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (!v) return v;
        const rect = canvas.getBoundingClientRect();
        const s = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const f = toField(v, s);
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.max(8, Math.min(600, v.scale * factor));
        userMovedView.current = true;
        return { scale, ox: s.x - f.x * scale, oy: s.y + f.y * scale };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const localPoint = (e: React.PointerEvent | React.MouseEvent): Vec => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const snapPos = (p: Vec): Vec => (ui.snap ? { x: round(p.x, SNAP_POS), y: round(p.y, SNAP_POS) } : p);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const s = localPoint(e);
    const f = toField(view, s);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || !auto) {
      drag.current = { kind: 'pan', start: s, view, moved: false };
      return;
    }
    const hit = hitTest(view, project.robot, auto, ui.selectedIndex, s);
    if (hit?.kind === 'point') {
      setUi({ selectedIndex: hit.index, tab: 'point' });
      checkpoint();
      const w = auto.waypoints[hit.index];
      if (e.altKey && hit.index < auto.waypoints.length - 1) {
        drag.current = { kind: 'handle', index: hit.index, which: 'out' };
      } else {
        drag.current = { kind: 'point', index: hit.index, offset: sub(f, w) };
      }
      return;
    }
    if (hit?.kind === 'handle') {
      setUi({ selectedIndex: hit.index, tab: 'point' });
      checkpoint();
      drag.current = { kind: 'handle', index: hit.index, which: hit.which };
      return;
    }
    if (hit?.kind === 'facing') {
      setUi({ selectedIndex: hit.index, tab: 'point' });
      checkpoint();
      drag.current = { kind: 'facing', index: hit.index };
      return;
    }
    if (ui.tool === 'add') {
      const p = snapPos(f);
      let index = 0;
      updateAuto((a) => {
        index = appendWaypoint(a, p, ui.newPointStyle);
      });
      setUi({ selectedIndex: index, tab: 'point' });
      return;
    }
    drag.current = { kind: 'pan', start: s, view, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const s = localPoint(e);
    const f = toField(view, s);
    setCursor(f);
    const d = drag.current;
    if (!d) {
      if (!auto) return;
      const hit = hitTest(view, project.robot, auto, ui.selectedIndex, s);
      setHover(hit);
      if (!hit && ui.tool === 'select') {
        const near = nearestOnPath(auto, f);
        setInsertPreview(near && near.distance * view.scale < 8 ? pointOnSegment(auto, near.segment, near.t) : null);
      } else {
        setInsertPreview(null);
      }
      return;
    }
    if (d.kind === 'pan') {
      const dx = s.x - d.start.x;
      const dy = s.y - d.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      userMovedView.current = true;
      setView({ ...d.view, ox: d.view.ox + dx, oy: d.view.oy + dy });
      return;
    }
    const snapAngle = ui.snap || e.shiftKey ? SNAP_DEG : null;
    updateAuto(
      (a) => {
        const w = a.waypoints[d.index];
        if (!w) return;
        if (d.kind === 'point') {
          const p = snapPos(sub(f, d.offset));
          w.x = p.x;
          w.y = p.y;
        } else if (d.kind === 'handle') {
          dragHandle(w, d.which, f, snapAngle, d.index === 0, d.index === a.waypoints.length - 1);
        } else if (d.kind === 'facing') {
          let angle = angleOf(sub(f, w));
          if (snapAngle) angle = round(angle, snapAngle);
          w.facing = angle;
        }
      },
      { history: false },
    );
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    try {
      (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be gone.
    }
    if (d?.kind === 'pan' && !d.moved && e.button === 0 && ui.tool === 'select') {
      setUi({ selectedIndex: null });
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!view || !auto) return;
    const s = localPoint(e);
    if (hitTest(view, project.robot, auto, ui.selectedIndex, s)) return;
    const near = nearestOnPath(auto, toField(view, s));
    if (near && near.distance * view.scale < 10) {
      let index = 0;
      updateAuto((a) => {
        index = insertWaypoint(a, near.segment, near.t);
      });
      setUi({ selectedIndex: index, tab: 'point' });
      setInsertPreview(null);
    }
  };

  const cursorStyle = drag.current
    ? 'grabbing'
    : hover
      ? 'grab'
      : insertPreview
        ? 'copy'
        : ui.tool === 'add'
          ? 'crosshair'
          : 'default';

  const vmax = project.robot.maxVelocity;
  return (
    <div className="field-view" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="field-canvas"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setCursor(null);
          setHover(null);
          setInsertPreview(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        role="img"
        aria-label={`Field view of ${auto?.name ?? 'auto'}: ${auto?.waypoints.length ?? 0} waypoints`}
      />
      <div className="field-toolbar" role="toolbar" aria-label="Field tools">
        <IconButton title="Select and move (V)" active={ui.tool === 'select'} onClick={() => setUi({ tool: 'select' })}>
          <IconPointer />
        </IconButton>
        <IconButton title="Add waypoints at the end (A)" active={ui.tool === 'add'} onClick={() => setUi({ tool: 'add' })}>
          <IconPlus />
        </IconButton>
        <span className="toolbar-sep" />
        <Segmented
          label="Style of new points"
          value={ui.newPointStyle}
          onChange={(v) => setUi({ newPointStyle: v, tool: 'add' })}
          options={[
            { value: 'smooth', label: <IconCurve />, title: 'New points: smooth curve' },
            { value: 'stop', label: <IconLine />, title: 'New points: stop, turn in place, straight line' },
          ]}
        />
        <span className="toolbar-sep" />
        <IconButton title={`Snap to ${SNAP_POS * 100} cm / ${SNAP_DEG}°`} active={ui.snap} onClick={() => setUi({ snap: !ui.snap })}>
          <IconMagnet />
        </IconButton>
        <IconButton title="Fit field to view" onClick={fit}>
          <IconFit />
        </IconButton>
      </div>
      <div className="field-legend" aria-hidden>
        <div className="legend-row">
          <span className="legend-label">Speed</span>
          <span
            className="speed-bar"
            style={{ background: `linear-gradient(90deg, ${speedColor(0)}, ${speedColor(0.5)}, ${speedColor(1)})` }}
          />
          <span className="legend-value">0–{vmax.toFixed(1)} m/s</span>
        </div>
        <div className="legend-row">
          <span className="legend-swatch planned" /> Planned
          {sim && (
            <>
              <span className="legend-swatch simulated" /> Simulated
            </>
          )}
          <span className="legend-swatch reverse" /> Reverse
        </div>
      </div>
      <div className="field-status">
        {cursor ? `x ${cursor.x.toFixed(2)} m · y ${cursor.y.toFixed(2)} m` : ui.tool === 'add' ? 'Click to add a point' : 'Drag points/handles · double-click path to insert · Alt-drag a point to pull a handle'}
      </div>
    </div>
  );
}

function pointOnSegment(auto: Auto, segment: number, t: number): Vec {
  return bezierPoint(segmentBezier(auto.waypoints[segment], auto.waypoints[segment + 1]), t);
}
