import { useEffect, useMemo } from 'react';
import { deleteWaypoint } from './model/edit';
import { type InspectorTab, getState, redo, setUi, undo, updateAuto, useStore } from './model/store';
import { simulatePlan } from './planner/simulate';
import { planAuto } from './planner/trajectory';
import { AutoPanel } from './ui/AutoPanel';
import { CodeModal } from './ui/CodeModal';
import { FieldPanel } from './ui/FieldPanel';
import { FieldView } from './ui/FieldView';
import { Header } from './ui/Header';
import { HelpModal } from './ui/HelpModal';
import { PointPanel } from './ui/PointPanel';
import { RobotPanel } from './ui/RobotPanel';
import { Sidebar } from './ui/Sidebar';
import { SimPanel } from './ui/SimPanel';
import { Timeline } from './ui/Timeline';
import { VelocityChart } from './ui/VelocityChart';

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'point', label: 'Point' },
  { id: 'auto', label: 'Auto' },
  { id: 'robot', label: 'Robot' },
  { id: 'field', label: 'Field' },
  { id: 'sim', label: 'Simulate' },
];

const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);

/** True when keys should go to a text field instead of the app shortcuts. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && TEXT_INPUTS.has((t as HTMLInputElement).type);
}

export function App() {
  const project = useStore((s) => s.project);
  const selectedAutoId = useStore((s) => s.ui.selectedAutoId);
  const tab = useStore((s) => s.ui.tab);
  const playing = useStore((s) => s.ui.playing);
  const showSim = useStore((s) => s.ui.showSim);
  const simSettings = useStore((s) => s.ui.sim);
  const codeOpen = useStore((s) => s.ui.codeOpen);
  const helpOpen = useStore((s) => s.ui.helpOpen);
  const theme = useStore((s) => s.ui.theme);
  const toast = useStore((s) => s.toast);
  const auto = project.autos.find((a) => a.id === selectedAutoId) ?? project.autos[0];

  const plan = useMemo(
    () =>
      auto && auto.waypoints.length > 0
        ? planAuto(auto, project.robot, {
            sampleTime: 0.02,
            commands: project.commands,
            autoPeriod: project.codegen.autoPeriod,
            field: project.field,
          })
        : null,
    [auto, project.robot, project.commands, project.codegen.autoPeriod, project.field],
  );
  const sim = useMemo(() => (plan && showSim ? simulatePlan(plan, project.robot, simSettings) : null), [plan, showSim, project.robot, simSettings]);

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { ui } = getState();
      const total = plan?.totalTime ?? 0;
      const t = ui.time + dt * ui.speed;
      if (t >= total) {
        setUi({ time: total, playing: false });
        return;
      }
      setUi({ time: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, plan]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ui } = getState();
      if (ui.codeOpen || ui.helpOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping(e)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (isTyping(e)) return;
        e.preventDefault();
        redo();
        return;
      }
      if (isTyping(e) || mod) return;
      const sel = ui.selectedIndex;
      switch (e.key) {
        case ' ':
          if ((e.target as HTMLElement | null)?.closest('button, input, select, a')) return;
          e.preventDefault();
          setUi({ playing: !ui.playing, time: !ui.playing && plan && ui.time >= plan.totalTime ? 0 : ui.time });
          break;
        case 'v':
        case 'V':
          setUi({ tool: 'select' });
          break;
        case 'a':
        case 'A':
          setUi({ tool: 'add' });
          break;
        case 'Escape':
          setUi({ tool: 'select', selectedIndex: null });
          break;
        case 'Delete':
        case 'Backspace':
          if (sel !== null && auto && auto.waypoints.length > 2) {
            e.preventDefault();
            updateAuto((a) => deleteWaypoint(a, sel));
            setUi({ selectedIndex: Math.min(sel, auto.waypoints.length - 2) });
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (sel === null) return;
          e.preventDefault();
          const step = e.shiftKey ? 0.25 : 0.05;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
          updateAuto(
            (a) => {
              const w = a.waypoints[sel];
              if (w) {
                w.x += dx;
                w.y += dy;
              }
            },
            { coalesce: `nudge:${sel}` },
          );
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [auto, plan]);

  return (
    <div className="app">
      <Header />
      <div className="workspace">
        <Sidebar />
        <main className="center" aria-label="Field and timeline">
          <FieldView plan={plan} sim={sim} />
          <Timeline plan={plan} />
          <VelocityChart plan={plan} />
        </main>
        <aside className="inspector" aria-label="Inspector">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="inspector-panel"
                className={tab === t.id ? 'active' : undefined}
                onClick={() => setUi({ tab: t.id })}
              >
                {t.label}
                {t.id === 'auto' && plan && plan.warnings.some((w) => w.level !== 'info') && <span className="dot" aria-label="has warnings" />}
              </button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel" id="inspector-panel" aria-labelledby={`tab-${tab}`}>
            {tab === 'point' && auto && <PointPanel auto={auto} plan={plan} />}
            {tab === 'auto' && auto && <AutoPanel auto={auto} plan={plan} />}
            {tab === 'robot' && <RobotPanel />}
            {tab === 'field' && <FieldPanel />}
            {tab === 'sim' && <SimPanel sim={sim} />}
          </div>
        </aside>
      </div>
      <datalist id="command-names">
        {project.commands.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      {codeOpen && <CodeModal />}
      {helpOpen && <HelpModal />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
