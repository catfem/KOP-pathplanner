import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appendWaypoint, dragHandle, insertWaypoint, nearestOnPath, round } from '../../model/edit';
import { checkpoint, revertCheckpoint, setUi, updateAuto, useStore } from '../../model/store';
import type { Auto } from '../../model/types';
import { type Vec, angleOf, bezierPoint, sub } from '../../planner/geometry';
import type { SimResult } from '../../planner/simulate';
import { type Plan, segmentBezier } from '../../planner/trajectory';
import { IconButton, Segmented } from '../components/controls';
import { IconCurve, IconFit, IconLine, IconMagnet, IconPlus, IconPointer, IconRuler } from '../components/icons';
import { type HitTarget, type RenderInput, type View, fitView, hitTest, readPalette, renderField, speedColor, toField } from './render';

type Drag =
  | { kind: 'point'; index: number; offset: Vec; changed: boolean }
  | { kind: 'handle'; index: number; which: 'in' | 'out'; changed: boolean }
  | { kind: 'facing'; index: number; changed: boolean }
  | { kind: 'pan'; start: Vec; view: View; moved: boolean };

const SNAP_POS = 0.05;
const SNAP_DEG = 15;
const MIN_SCALE = 8;
const MAX_SCALE = 600;

function pointOnSegment(auto: Auto, segment: number, t: number): Vec {
  return bezierPoint(segmentBezier(auto.waypoints[segment], auto.waypoints[segment + 1]), t);
}

interface Props {
  plan: Plan | null;
  sim: SimResult | null;
  /** Planner failure to show over the field. */
  planError?: string | null;
}

export function FieldView({ plan, sim, planError }: Props) {
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
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // ---- Field image ----
  useEffect(() => {
    if (!fieldImage) {
      setImage(null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setImage(img);
    img.onerror = () => alive && setImage(null);
    img.src = fieldImage;
    return () => {
      alive = false;
    };
  }, [fieldImage]);

  // ---- Size and view ----
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(0, el.clientWidth), h: Math.max(0, el.clientHeight) });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (size.w > 0 && size.h > 0) setView(fitView(size.w, size.h, project.field));
    userMovedView.current = false;
  }, [size.w, size.h, project.field]);

  useEffect(() => {
    // Refit when the field size changes or the container resizes (unless the user zoomed).
    if (!userMovedView.current || !view) fit();
  }, [size.w, size.h, project.field.length, project.field.width]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Drawing: at most once per animation frame, always with the latest input ----
  const input = useRef<Omit<RenderInput, 'palette'> | null>(null);
  const frame = useRef(0);
  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const data = input.current;
    if (!canvas || !data || data.width <= 0 || data.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(data.width * dpr);
    const h = Math.round(data.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      renderField(ctx, { ...data, palette: readPalette(document.documentElement) });
    } catch (err) {
      // A drawing bug must not take the editor down; log it and keep going.
      console.error('KOP Path Planner: field drawing failed', err);
    }
  }, []);
  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  input.current = view
    ? {
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
        insertPreview,
        showGuides: ui.showGuides,
      }
    : null;
  useEffect(requestDraw);

  // Redraw when the theme or the screen's pixel ratio changes.
  useEffect(() => {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
    const dpr = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dark?.addEventListener('change', requestDraw);
    dpr?.addEventListener('change', requestDraw);
    return () => {
      dark?.removeEventListener('change', requestDraw);
      dpr?.removeEventListener('change', requestDraw);
    };
  }, [requestDraw]);

  // ---- Zoom ----
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
        const delta = Math.max(-200, Math.min(200, e.deltaY));
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * Math.exp(-delta * 0.0015)));
        userMovedView.current = true;
        return { scale, ox: s.x - f.x * scale, oy: s.y + f.y * scale };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ---- Dragging ----
  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  /** Escape cancels a drag in progress and puts the point back. */
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const d = drag.current;
      e.stopPropagation();
      e.preventDefault();
      if (d && d.kind !== 'pan' && d.changed) revertCheckpoint();
      endDrag();
    };
    const onBlur = () => endDrag();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [dragging, endDrag]);

  const localPoint = (e: React.PointerEvent | React.MouseEvent): Vec => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const snapPos = (p: Vec): Vec => (ui.snap ? { x: round(p.x, SNAP_POS), y: round(p.y, SNAP_POS) } : p);

  const startDrag = (e: React.PointerEvent<HTMLCanvasElement>, d: Drag) => {
    drag.current = d;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic events; dragging still works while over the canvas.
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view || drag.current) return;
    const s = localPoint(e);
    const f = toField(view, s);
    if (e.button === 1 || e.button === 2 || !auto) {
      startDrag(e, { kind: 'pan', start: s, view, moved: false });
      return;
    }
    if (e.button !== 0) return;
    const hit = hitTest(view, project.robot, auto, ui.selectedIndex, s);
    if (hit?.kind === 'point') {
      setUi({ selectedIndex: hit.index, tab: 'point' });
      const w = auto.waypoints[hit.index];
      if (e.altKey && hit.index < auto.waypoints.length - 1) {
        startDrag(e, { kind: 'handle', index: hit.index, which: 'out', changed: false });
      } else {
        startDrag(e, { kind: 'point', index: hit.index, offset: sub(f, w), changed: false });
      }
      return;
    }
    if (hit?.kind === 'handle') {
      setUi({ selectedIndex: hit.index, tab: 'point' });
      startDrag(e, { kind: 'handle', index: hit.index, which: hit.which, changed: false });
      return;
    }
    if (hit?.kind === 'facing') {
      setUi({ selectedIndex: hit.index, tab: 'point' });
      startDrag(e, { kind: 'facing', index: hit.index, changed: false });
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
    startDrag(e, { kind: 'pan', start: s, view, moved: false });
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
      if (d.moved) {
        userMovedView.current = true;
        setView({ ...d.view, ox: d.view.ox + dx, oy: d.view.oy + dy });
      }
      return;
    }
    // The undo step is recorded on the first real move, so a plain click adds no history.
    if (!d.changed) {
      checkpoint();
      d.changed = true;
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
        } else {
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
    endDrag();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
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

  const cursorStyle = dragging ? 'grabbing' : hover ? 'grab' : insertPreview ? 'copy' : ui.tool === 'add' ? 'crosshair' : 'default';
  const vmax = project.robot.maxVelocity;
  const palette = readPalette(document.documentElement);

  return (
    <div className="field-view" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="field-canvas"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
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
        <IconButton
          title="Bumper distance guides (start to walls, stops to the HUB)"
          active={ui.showGuides}
          onClick={() => setUi({ showGuides: !ui.showGuides })}
        >
          <IconRuler />
        </IconButton>
        <IconButton title="Fit field to view" onClick={fit}>
          <IconFit />
        </IconButton>
      </div>
      {planError && (
        <div className="field-banner" role="alert">
          Could not plan this auto: {planError}
        </div>
      )}
      <div className="field-legend" aria-hidden>
        <div className="legend-row">
          <span className="legend-label">Speed</span>
          <span
            className="speed-bar"
            style={{ background: `linear-gradient(90deg, ${speedColor(0, palette)}, ${speedColor(1, palette)})` }}
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
        {cursor
          ? `x ${cursor.x.toFixed(2)} m · y ${cursor.y.toFixed(2)} m`
          : ui.tool === 'add'
            ? 'Click to add a point'
            : 'Drag points/handles · double-click path to insert · Alt-drag a point to pull a handle · Esc cancels a drag'}
      </div>
    </div>
  );
}
