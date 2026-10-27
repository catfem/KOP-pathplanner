import { useState } from 'react';
import { makeWaypoint, newId } from '../model/defaults';
import { duplicateAuto, uniqueAutoName } from '../model/edit';
import { setUi, updateProject, useStore } from '../model/store';
import { IconButton, NumberField } from './controls';
import { IconDuplicate, IconPlus, IconTrash, IconX } from './icons';

export function Sidebar() {
  const autos = useStore((s) => s.project.autos);
  const commands = useStore((s) => s.project.commands);
  const selectedId = useStore((s) => s.ui.selectedAutoId);
  const fieldWidth = useStore((s) => s.project.field.width);
  const [newCommand, setNewCommand] = useState('');

  const usage = (name: string) =>
    autos.reduce(
      (n, a) =>
        n +
        a.waypoints.reduce(
          (m, w) => m + w.markers.filter((x) => x === name).length + w.actions.filter((x) => x.kind === 'command' && x.name === name).length,
          0,
        ),
      0,
    );

  const addAuto = () => {
    const id = newId('auto');
    updateProject((p) => {
      const y = fieldWidth / 2;
      p.autos.push({
        id,
        name: uniqueAutoName(
          p.autos.map((a) => a.name),
          'New Auto',
        ),
        waypoints: [makeWaypoint(1.5, y, 0, { stop: true, lenOut: 1 }), makeWaypoint(4, y, 0, { stop: true, lenIn: 1 })],
      });
    });
    setUi({ selectedAutoId: id, selectedIndex: null, time: 0, playing: false, tab: 'auto' });
  };

  return (
    <aside className="sidebar" aria-label="Autos and commands">
      <div className="side-section">
        <div className="side-head">
          <h2>Autos</h2>
          <IconButton title="New auto" onClick={addAuto}>
            <IconPlus />
          </IconButton>
        </div>
        <ul className="auto-list">
          {autos.map((a) => (
            <li key={a.id} className={a.id === selectedId ? 'active' : undefined}>
              <button
                type="button"
                className="auto-item"
                aria-current={a.id === selectedId}
                onClick={() => setUi({ selectedAutoId: a.id, selectedIndex: null, time: 0, playing: false })}
                onDoubleClick={() => setUi({ tab: 'auto' })}
              >
                <span className="auto-name">{a.name || 'Untitled'}</span>
                <span className="auto-meta">{a.waypoints.length} pts</span>
              </button>
              <div className="auto-actions">
                <IconButton
                  title="Duplicate"
                  onClick={() => {
                    const copy = duplicateAuto(
                      a,
                      uniqueAutoName(
                        autos.map((x) => x.name),
                        `${a.name} copy`,
                      ),
                    );
                    updateProject((p) => {
                      const i = p.autos.findIndex((x) => x.id === a.id);
                      p.autos.splice(i + 1, 0, copy);
                    });
                    setUi({ selectedAutoId: copy.id, selectedIndex: null });
                  }}
                >
                  <IconDuplicate />
                </IconButton>
                <IconButton
                  title="Delete"
                  danger
                  disabled={autos.length <= 1}
                  onClick={() => {
                    if (!window.confirm(`Delete auto “${a.name}”? (Undo with Ctrl+Z)`)) return;
                    const rest = autos.filter((x) => x.id !== a.id);
                    updateProject((p) => {
                      p.autos = p.autos.filter((x) => x.id !== a.id);
                    });
                    if (a.id === selectedId) setUi({ selectedAutoId: rest[0].id, selectedIndex: null });
                  }}
                >
                  <IconTrash />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="side-section">
        <div className="side-head">
          <h2>Named commands</h2>
        </div>
        <p className="muted small">Mechanism commands used by actions and markers. Register them in your robot code. Duration is only for the preview.</p>
        <ul className="command-list">
          {commands.map((c, i) => (
            <li key={`${c.name}-${i}`}>
              <span className="command-name" title={`Used ${usage(c.name)} time(s)`}>
                {c.name}
                <span className="muted small"> ×{usage(c.name)}</span>
              </span>
              <NumberField
                label={<span className="sr-only">Duration of {c.name}</span>}
                unit="s"
                value={c.duration}
                min={0}
                step={0.1}
                onChange={(v) => updateProject((p) => (p.commands[i].duration = v), { coalesce: `cmd:${c.name}` })}
              />
              <IconButton
                title={usage(c.name) ? 'In use: remove its actions/markers first' : 'Remove'}
                disabled={usage(c.name) > 0}
                onClick={() => updateProject((p) => p.commands.splice(i, 1))}
              >
                <IconX />
              </IconButton>
            </li>
          ))}
        </ul>
        <form
          className="command-picker"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newCommand.trim();
            if (!name || commands.some((c) => c.name === name)) return;
            updateProject((p) => p.commands.push({ name, duration: 0.5 }));
            setNewCommand('');
          }}
        >
          <input type="text" value={newCommand} placeholder="New command name" aria-label="New command name" onChange={(e) => setNewCommand(e.target.value)} />
          <button type="submit" className="btn small">
            Add
          </button>
        </form>
      </div>
    </aside>
  );
}
