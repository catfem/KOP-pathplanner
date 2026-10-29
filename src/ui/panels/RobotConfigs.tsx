import { type FormEvent, useState } from 'react';
import {
  type RobotSettings,
  type SavedRobotConfig,
  configFileName,
  describeSettings,
  parseRobotConfig,
  sameSettings,
  toConfigFile,
} from '../../model/robotConfigs';
import {
  applyRobotSettings,
  deleteRobotConfig,
  findRobotConfig,
  getState,
  saveRobotConfig,
  showToast,
  useStore,
} from '../../model/store';
import { confirmAction } from '../components/Confirm';
import { Section } from '../components/controls';
import { IconMore } from '../components/icons';
import { Menu } from '../components/Menu';
import { downloadBlob, pickFile } from '../lib/files';

/** Downloads robot settings as a .robot.json file. */
export function downloadRobotConfig(name: string, settings: RobotSettings = getState().project): void {
  const file = toConfigFile({ id: '', name, savedAt: new Date().toISOString(), robot: settings.robot, codegen: settings.codegen });
  downloadBlob(configFileName(name), JSON.stringify(file, null, 2), 'application/json');
}

/** The saved config whose settings are the ones in the project, if any. */
export function currentConfig(): SavedRobotConfig | undefined {
  const { configs, project } = getState();
  return configs.find((c) => sameSettings(c, project));
}

/**
 * Lets the user pick a robot config file (or a project file), saves it to the list and loads
 * it into the project. Errors are reported as a toast.
 */
export async function importRobotConfigFile(): Promise<void> {
  try {
    const file = await pickFile('.json,.robot.json,.kop.json,application/json');
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} is not a valid JSON file.`);
    }
    const imported = parseRobotConfig(raw, file.name);
    // Keep a different config that already has this name: save the import next to it.
    let name = imported.name;
    for (let n = 2; findRobotConfig(name) && !sameSettings(findRobotConfig(name) as SavedRobotConfig, imported); n++) {
      name = `${imported.name} (${n})`;
    }
    const saved = saveRobotConfig(name, imported);
    applyRobotSettings(saved);
    showToast(`Loaded robot config “${saved.name}” from ${file.name}. Undo (Ctrl+Z) brings back the previous settings.`);
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error');
  }
}

function savedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Robot tab section: save, load, download and import robot configurations. */
export function RobotConfigs() {
  const configs = useStore((s) => s.configs);
  const robot = useStore((s) => s.project.robot);
  const codegen = useStore((s) => s.project.codegen);
  const [name, setName] = useState('');
  const current: RobotSettings = { robot, codegen };
  const inUse = configs.find((c) => sameSettings(c, current));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = findRobotConfig(trimmed);
    if (existing && !sameSettings(existing, getState().project)) {
      const ok = await confirmAction({
        title: `Replace “${existing.name}”?`,
        message: 'The saved config gets the current robot settings. Its old settings cannot be brought back.',
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    const saved = saveRobotConfig(trimmed, getState().project);
    setName('');
    showToast(`Saved robot config “${saved.name}”.`);
  };

  const load = (config: SavedRobotConfig) => {
    applyRobotSettings(config);
    showToast(`Loaded robot config “${config.name}”. Undo (Ctrl+Z) brings back the previous settings.`);
  };

  const actions = (config: SavedRobotConfig) => [
    {
      label: 'Save current settings here',
      onSelect: async () => {
        const ok = await confirmAction({
          title: `Replace “${config.name}”?`,
          message: 'The saved config gets the current robot settings. Its old settings cannot be brought back.',
          confirmLabel: 'Replace',
        });
        if (!ok) return;
        saveRobotConfig(config.name, getState().project);
        showToast(`Saved robot config “${config.name}”.`);
      },
    },
    { label: 'Download file', onSelect: () => downloadRobotConfig(config.name, config) },
    {
      label: 'Delete…',
      separatorBefore: true,
      danger: true,
      onSelect: async () => {
        const ok = await confirmAction({
          title: `Delete “${config.name}”?`,
          message: 'Only the saved config is deleted. The robot settings in this project stay as they are.',
          confirmLabel: 'Delete config',
          danger: true,
        });
        if (!ok) return;
        deleteRobotConfig(config.id);
        showToast(`Deleted robot config “${config.name}”.`);
      },
    },
  ];

  return (
    <Section title="Saved robot configs">
      <p className="muted small">
        Keep this robot&apos;s settings (drivetrain, IDs, gains, calibration and code options) to reuse in other projects or on another
        laptop. Autos and the field are not included.
      </p>
      {configs.length > 0 ? (
        <ul className="config-list" aria-label="Saved robot configs">
          {configs.map((c) => {
            const active = c.id === inUse?.id;
            return (
              <li key={c.id} className={active ? 'active' : undefined}>
                <div className="config-text">
                  <span className="config-name">{c.name}</span>
                  <span className="config-meta">
                    {active && <strong>In use · </strong>}
                    {describeSettings(c)}
                    {savedDate(c.savedAt) && ` · ${savedDate(c.savedAt)}`}
                  </span>
                </div>
                <button type="button" className="btn small" disabled={active} onClick={() => load(c)} aria-label={`Load ${c.name}`}>
                  Load
                </button>
                <Menu
                  label={`${c.name} actions`}
                  buttonLabel={`More actions for ${c.name}`}
                  buttonClassName="icon-btn"
                  buttonContent={<IconMore />}
                  items={actions(c)}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">No saved configs yet.</p>
      )}
      {!inUse && configs.length > 0 && <p className="muted small">The current settings are not saved as a config.</p>}
      <form className="command-picker" onSubmit={save}>
        <input
          type="text"
          value={name}
          maxLength={60}
          placeholder="Name, e.g. Comp bot"
          aria-label="Robot config name"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn small" disabled={!name.trim()}>
          Save current
        </button>
      </form>
      <div className="button-row">
        <button type="button" className="btn small" onClick={() => downloadRobotConfig(inUse?.name ?? 'Robot', current)}>
          Download file
        </button>
        <button type="button" className="btn small" onClick={() => void importRobotConfigFile()}>
          Load from file…
        </button>
      </div>
    </Section>
  );
}
