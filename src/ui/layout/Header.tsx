import { defaultProject } from '../../model/defaults';
import { importPathPlanner, uniqueAutoName } from '../../model/edit';
import { getState, normalizeProject, redo, replaceProject, setUi, showToast, undo, updateProject, useStore } from '../../model/store';
import { confirmAction } from '../components/Confirm';
import { IconButton } from '../components/controls';
import { IconCode, IconHelp, IconMonitor, IconMoon, IconPanelLeft, IconPanelRight, IconRedo, IconSun, IconUndo } from '../components/icons';
import { Menu } from '../components/Menu';
import { downloadBlob, pickFile } from '../lib/files';

/** Runs a menu action and reports failures (bad files, parse errors) as a toast. */
function guarded(fn: () => void | Promise<void>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };
}

async function readJson(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name} is not a valid JSON file.`);
  }
}

const projectMenu = [
  {
    label: 'Open project…',
    onSelect: guarded(async () => {
      const file = await pickFile('.json,.kop.json,application/json');
      if (!file) return;
      replaceProject(normalizeProject(await readJson(file)));
      showToast(`Opened ${file.name}`);
    }),
  },
  {
    label: 'Save project file',
    onSelect: guarded(() => downloadBlob('kop-autos.kop.json', JSON.stringify(getState().project, null, 2), 'application/json')),
  },
  {
    label: 'Import PathPlanner path…',
    onSelect: guarded(async () => {
      const file = await pickFile('.path,.json');
      if (!file) return;
      const base = file.name.replace(/\.path$|\.json$/i, '');
      const names = getState().project.autos.map((a) => a.name);
      const auto = importPathPlanner(await readJson(file), uniqueAutoName(names, base));
      updateProject((p) => p.autos.push(auto));
      setUi({ selectedAutoId: auto.id, selectedIndex: null, time: 0 });
      showToast(`Imported ${file.name}. Rotation targets are ignored (tank drive); markers snap to the nearest point.`);
    }),
  },
  {
    label: 'New project (examples)',
    separatorBefore: true,
    danger: true,
    onSelect: guarded(async () => {
      const ok = await confirmAction({
        title: 'Start a new project?',
        message: 'The current project is replaced by the examples. Undo still brings it back.',
        confirmLabel: 'Start new project',
        danger: true,
      });
      if (ok) replaceProject(defaultProject());
    }),
  },
];

export function Header() {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const theme = useStore((s) => s.ui.theme);
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const inspectorOpen = useStore((s) => s.ui.inspectorOpen);
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  return (
    <header className="app-header">
      <div className="brand">
        <IconButton title={sidebarOpen ? 'Hide autos list' : 'Show autos list'} active={sidebarOpen} onClick={() => setUi({ sidebarOpen: !sidebarOpen })}>
          <IconPanelLeft />
        </IconButton>
        <svg className="brand-mark" width="20" height="20" viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="7" width="24" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M9 20C12 11 19 22 23 12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
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
        <span className="header-sep" aria-hidden />
        <Menu label="Project" items={projectMenu} buttonContent={<>Project ▾</>} />
        <IconButton title={`Theme: ${theme} (switch to ${nextTheme})`} onClick={() => setUi({ theme: nextTheme })}>
          {theme === 'light' ? <IconSun /> : theme === 'dark' ? <IconMoon /> : <IconMonitor />}
        </IconButton>
        <IconButton title="Help" onClick={() => setUi({ helpOpen: true })}>
          <IconHelp />
        </IconButton>
        <IconButton title={inspectorOpen ? 'Hide inspector' : 'Show inspector'} active={inspectorOpen} onClick={() => setUi({ inspectorOpen: !inspectorOpen })}>
          <IconPanelRight />
        </IconButton>
        <button type="button" className="btn primary" onClick={() => setUi({ codeOpen: true })}>
          <IconCode /> Generate code
        </button>
      </div>
    </header>
  );
}
