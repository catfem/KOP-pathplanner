import { useEffect, useRef, useState } from 'react';
import { defaultProject } from '../model/defaults';
import { importPathPlanner, uniqueAutoName } from '../model/edit';
import { getState, normalizeProject, redo, replaceProject, setUi, showToast, undo, updateProject, useStore } from '../model/store';
import { downloadBlob, pickFile } from './files';
import { IconCode, IconHelp, IconMonitor, IconMoon, IconRedo, IconSun, IconUndo } from './icons';
import { IconButton } from './controls';

function ProjectMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const run = (fn: () => void | Promise<void>) => async () => {
    setOpen(false);
    try {
      await fn();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Project ▾
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={run(async () => {
              const file = await pickFile('.json,.kop.json,application/json');
              if (!file) return;
              const project = normalizeProject(JSON.parse(await file.text()));
              replaceProject(project);
              showToast(`Opened ${file.name}`);
            })}
          >
            Open project…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => {
              downloadBlob('kop-autos.kop.json', JSON.stringify(getState().project, null, 2), 'application/json');
            })}
          >
            Save project file
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(async () => {
              const file = await pickFile('.path,.json');
              if (!file) return;
              const base = file.name.replace(/\.path$|\.json$/i, '');
              const names = getState().project.autos.map((a) => a.name);
              const auto = importPathPlanner(JSON.parse(await file.text()), uniqueAutoName(names, base));
              updateProject((p) => p.autos.push(auto));
              setUi({ selectedAutoId: auto.id, selectedIndex: null, time: 0 });
              showToast(`Imported ${file.name}. Rotation targets are ignored (tank drive); markers snap to the nearest point.`);
            })}
          >
            Import PathPlanner path…
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => {
              if (window.confirm('Start a new project? The current one is replaced (Undo still works).')) replaceProject(defaultProject());
            })}
          >
            New project (examples)
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const theme = useStore((s) => s.ui.theme);
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  return (
    <header className="app-header">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="7" width="24" height="18" rx="4" fill="var(--accent)" />
          <path d="M8 21C12 9 20 23 24 11" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
        <span className="brand-name">KOP Path Planner</span>
        <span className="brand-tag">tank drive · no gyro</span>
      </div>
      <div className="header-actions">
        <IconButton title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <IconUndo />
        </IconButton>
        <IconButton title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
          <IconRedo />
        </IconButton>
        <ProjectMenu />
        <IconButton title={`Theme: ${theme} (switch to ${nextTheme})`} onClick={() => setUi({ theme: nextTheme })}>
          {theme === 'light' ? <IconSun /> : theme === 'dark' ? <IconMoon /> : <IconMonitor />}
        </IconButton>
        <IconButton title="Help" onClick={() => setUi({ helpOpen: true })}>
          <IconHelp />
        </IconButton>
        <button type="button" className="btn primary" onClick={() => setUi({ codeOpen: true })}>
          <IconCode /> Generate code
        </button>
      </div>
    </header>
  );
}
