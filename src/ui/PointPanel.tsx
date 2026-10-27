import { newId } from '../model/defaults';
import { deleteWaypoint, makeStraight, setStop } from '../model/edit';
import { setUi, updateAuto, updateProject, useStore } from '../model/store';
import type { Action, Auto, Project } from '../model/types';
import { KIND_LABELS, bumperAgainst, bumperDistances, bumperGap, elementLabel, formatDistance } from '../model/field';
import { wrapDeg } from '../planner/geometry';
import type { Plan } from '../planner/trajectory';
import { Checkbox, IconButton, NumberField, Section, Segmented, SelectField } from './controls';
import { IconChevronLeft, IconChevronRight, IconDown, IconTrash, IconUp, IconX } from './icons';

/** True when the robot drives backwards on the segment that ends at waypoint index. */
function arrivesReversed(auto: Auto, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    if (i === 0 || auto.waypoints[i].stop) return auto.waypoints[i].reversed;
  }
  return false;
}

/** Adds a command name to the project's registry if it is new. */
function ensureCommand(p: Project, name: string): void {
  const n = name.trim();
  if (n && !p.commands.some((c) => c.name === n)) p.commands.push({ name: n, duration: 0.5 });
}

function CommandPicker({ onPick, placeholder }: { onPick: (name: string) => void; placeholder: string }) {
  return (
    <form
      className="command-picker"
      onSubmit={(e) => {
        e.preventDefault();
        const input = (e.currentTarget.elements.namedItem('cmd') as HTMLInputElement);
        const name = input.value.trim();
        if (name) {
          onPick(name);
          input.value = '';
        }
      }}
    >
      <input name="cmd" type="text" list="command-names" placeholder={placeholder} aria-label={placeholder} />
      <button type="submit" className="btn small">
        Add
      </button>
    </form>
  );
}

export function PointPanel({ auto, plan }: { auto: Auto; plan: Plan | null }) {
  const index = useStore((s) => s.ui.selectedIndex);
  const robot = useStore((s) => s.project.robot);
  const field = useStore((s) => s.project.field);
  const n = auto.waypoints.length;
  if (index === null || index >= n) {
    return (
      <div className="empty-panel">
        <p>Select a waypoint on the field to edit it.</p>
        <ul className="tips">
          <li>
            Use the <strong>+</strong> tool to add points at the end of the path.
          </li>
          <li>Double-click the path to insert a point.</li>
          <li>Drag the coloured handles to bend the curve.</li>
          <li>
            <strong>Stop points</strong> (squares) can turn in place, run actions and change direction.
          </li>
        </ul>
      </div>
    );
  }
  const w = auto.waypoints[index];
  const aimTargets = field.elementsEnabled ? field.elements.filter((e) => e.kind === 'hub') : [];
  const aimTarget = w.aimAt && field.elementsEnabled ? field.elements.find((e) => e.id === w.aimAt) : undefined;
  const hubGap = aimTarget ? bumperGap(aimTarget, w.x, w.y, robot) : null;
  const placement = index === 0 && plan ? bumperDistances(robot, plan.startPose, field) : null;
  const isFirst = index === 0;
  const isLast = index === n - 1;
  const stop = w.stop || isFirst || isLast;
  const key = (field: string) => `${w.id}:${field}`;
  const edit = (fn: (wp: typeof w, a: Auto, p: Project) => void, field: string) =>
    updateAuto(
      (a, p) => {
        const wp = a.waypoints[index];
        if (wp) fn(wp, a, p);
      },
      { coalesce: key(field) },
    );

  const moveAction = (from: number, to: number) =>
    edit((wp) => {
      const [act] = wp.actions.splice(from, 1);
      wp.actions.splice(to, 0, act);
    }, 'actions');

  return (
    <div className="panel-scroll">
      <div className="point-head">
        <IconButton title="Previous point" disabled={isFirst} onClick={() => setUi({ selectedIndex: index - 1 })}>
          <IconChevronLeft />
        </IconButton>
        <div className="point-title">
          <strong>Point {index + 1}</strong>
          <span className="muted">
            {' '}
            of {n} · {isFirst ? 'start' : isLast ? 'end' : stop ? 'stop' : 'smooth'}
          </span>
        </div>
        <IconButton title="Next point" disabled={isLast} onClick={() => setUi({ selectedIndex: index + 1 })}>
          <IconChevronRight />
        </IconButton>
        <IconButton
          title="Delete point (Del)"
          danger
          disabled={n <= 2}
          onClick={() => {
            updateAuto((a) => deleteWaypoint(a, index));
            setUi({ selectedIndex: Math.min(index, n - 2) });
          }}
        >
          <IconTrash />
        </IconButton>
      </div>

      <Section title="Position">
        <div className="grid-2">
          <NumberField label="X" unit="m" value={w.x} step={0.05} onChange={(v) => edit((wp) => (wp.x = v), 'x')} />
          <NumberField label="Y" unit="m" value={w.y} step={0.05} onChange={(v) => edit((wp) => (wp.y = v), 'y')} />
        </div>
        {!isFirst && !isLast && (
          <div className="field">
            <span className="field-label">Type</span>
            <Segmented
              label="Point type"
              value={stop ? 'stop' : 'smooth'}
              onChange={(v) => edit((wp) => setStop(wp, v === 'stop'), 'stop')}
              options={[
                { value: 'smooth', label: 'Drive through', title: 'Robot keeps moving through this point' },
                { value: 'stop', label: 'Stop here', title: 'Robot stops: can turn in place, run actions, reverse' },
              ]}
            />
          </div>
        )}
      </Section>

      <Section title="Path shape">
        {stop && !isFirst && !isLast ? (
          <div className="grid-2">
            <NumberField label="Arrive direction" unit="°" value={w.angleIn} step={5} decimals={1} onChange={(v) => edit((wp) => (wp.angleIn = v), 'angleIn')} />
            <NumberField label="Leave direction" unit="°" value={w.angleOut} step={5} decimals={1} onChange={(v) => edit((wp) => (wp.angleOut = v), 'angleOut')} />
          </div>
        ) : (
          <NumberField
            label="Path direction"
            unit="°"
            value={isLast ? w.angleIn : w.angleOut}
            step={5}
            decimals={1}
            hint="Direction of travel along the path (0° = towards the red wall)."
            onChange={(v) =>
              edit((wp) => {
                wp.angleIn = v;
                wp.angleOut = v;
              }, 'angle')
            }
          />
        )}
        <div className="grid-2">
          {!isFirst && <NumberField label="Handle in" unit="m" value={w.lenIn} min={0} step={0.1} onChange={(v) => edit((wp) => (wp.lenIn = v), 'lenIn')} />}
          {!isLast && <NumberField label="Handle out" unit="m" value={w.lenOut} min={0} step={0.1} onChange={(v) => edit((wp) => (wp.lenOut = v), 'lenOut')} />}
        </div>
        <button type="button" className="btn small" onClick={() => updateAuto((a) => makeStraight(a, index))}>
          Straight lines to neighbours
        </button>
        {!isLast && (
          <Checkbox
            label="Speed limit on the next segment"
            checked={w.maxVel !== null}
            onChange={(on) => edit((wp) => (wp.maxVel = on ? 1.5 : null), 'maxVel')}
          />
        )}
        {!isLast && w.maxVel !== null && (
          <NumberField label="Max speed" unit="m/s" value={w.maxVel} min={0.1} step={0.1} onChange={(v) => edit((wp) => (wp.maxVel = v), 'maxVelValue')} />
        )}
      </Section>

      {isFirst && placement && (
        <Section title="Bumper position (robot placement)">
          <dl className="stats">
            <div className="wide">
              <dt>Bumper to the {placement.wall.side === 'blue' ? 'blue' : 'red'} alliance wall</dt>
              <dd>{formatDistance(placement.wall.distance)}</dd>
            </div>
            <div className="wide">
              <dt>Bumper to the {placement.rail.side} guardrail</dt>
              <dd>{formatDistance(placement.rail.distance)}</dd>
            </div>
          </dl>
          <p className="muted small">Measured from the closest bumper corner at the starting heading. Place the robot with a tape measure using these.</p>
          <div className="button-row">
            <button
              type="button"
              className="btn small"
              onClick={() => edit((wp) => (wp.x += placement.wall.side === 'blue' ? -placement.wall.distance : placement.wall.distance), 'placeWall')}
            >
              Against the alliance wall
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => edit((wp) => (wp.y += placement.rail.side === 'right' ? -placement.rail.distance : placement.rail.distance), 'placeRail')}
            >
              Against the guardrail
            </button>
          </div>
        </Section>
      )}

      {stop && (
        <Section title={isFirst ? 'At the start' : isLast ? 'At the end' : 'While stopped'}>
          {!isLast && (
            <Checkbox
              label="Drive backwards to the next stop"
              checked={w.reversed}
              onChange={(v) =>
                edit((wp) => {
                  wp.reversed = v;
                }, 'reversed')
              }
              hint="The robot faces the opposite way of travel (no turn needed to back up)."
            />
          )}
          <SelectField<string>
            label={isFirst ? 'Starting heading' : 'Facing while stopped'}
            value={w.aimAt ? `aim:${w.aimAt}` : w.facing !== null ? 'heading' : 'keep'}
            options={[
              { value: 'keep', label: isFirst ? 'Along the path' : 'No turn (keep heading)' },
              { value: 'heading', label: 'Fixed heading' },
              ...aimTargets.map((e) => ({ value: `aim:${e.id}`, label: `Aim at the ${elementLabel(e)}` })),
              ...(w.aimAt && !aimTarget ? [{ value: `aim:${w.aimAt}`, label: 'Aim at (not on this field)' }] : []),
            ]}
            onChange={(v) =>
              edit((wp, a) => {
                if (v === 'keep') {
                  wp.facing = null;
                  wp.aimAt = null;
                } else if (v === 'heading') {
                  wp.aimAt = null;
                  // Default to the way the robot already faces here (path direction, flipped when reversing).
                  const reversed = isFirst ? wp.reversed : arrivesReversed(a, index);
                  const base = isFirst ? wp.angleOut : wp.angleIn;
                  wp.facing = wp.facing ?? Math.round(wrapDeg(base + (reversed ? 180 : 0)));
                } else {
                  wp.aimAt = v.slice(4);
                }
              }, 'facing')
            }
            hint={
              isFirst
                ? 'Aiming at a HUB places the robot pointed at it (e.g. to shoot the preload).'
                : 'Turns in place before the actions below run.'
            }
          />
          {w.facing !== null && !w.aimAt && (
            <NumberField label="Facing" unit="°" value={w.facing} step={5} decimals={1} onChange={(v) => edit((wp) => (wp.facing = v), 'facingValue')} />
          )}
          {aimTarget && (
            <div className="readout">
              <dl className="stats">
                <div>
                  <dt>{KIND_LABELS[aimTarget.kind]} center</dt>
                  <dd>{Math.hypot(aimTarget.x - w.x, aimTarget.y - w.y).toFixed(2)} m</dd>
                </div>
                <div>
                  <dt>Aim heading</dt>
                  <dd>{((Math.atan2(aimTarget.y - w.y, aimTarget.x - w.x) * 180) / Math.PI).toFixed(1)}°</dd>
                </div>
                <div className="wide">
                  <dt>Front bumper to {KIND_LABELS[aimTarget.kind]}</dt>
                  <dd className={hubGap !== null && hubGap < 0 ? 'bad' : undefined}>
                    {hubGap !== null && (hubGap < 0 ? `inside by ${formatDistance(-hubGap)}` : formatDistance(hubGap))}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  edit((wp) => {
                    const p = bumperAgainst(aimTarget, wp, robot, 0.02);
                    wp.x = p.x;
                    wp.y = p.y;
                  }, 'bumperAgainst')
                }
                title="Moves this point along the aim line so the front bumper is 2 cm from the HUB"
              >
                Move: bumper against the {KIND_LABELS[aimTarget.kind]}
              </button>
            </div>
          )}
          <div className="subhead">Actions (run in order, robot stopped)</div>
          {w.actions.length === 0 && <p className="muted small">No actions.</p>}
          <ol className="action-list">
            {w.actions.map((act: Action, i) => (
              <li key={act.id} className="action-row">
                {act.kind === 'command' ? (
                  <input
                    type="text"
                    list="command-names"
                    value={act.name}
                    aria-label="Command name"
                    onChange={(e) =>
                      updateProject(
                        (p) => {
                          const a = p.autos.find((x) => x.id === auto.id)?.waypoints[index]?.actions[i];
                          if (a && a.kind === 'command') a.name = e.target.value;
                        },
                        { coalesce: key(`act${act.id}`) },
                      )
                    }
                    onBlur={() => updateProject((p) => ensureCommand(p, act.name), { history: false })}
                  />
                ) : (
                  <div className="wait-input">
                    <span>Wait</span>
                    <NumberField
                      label=""
                      unit="s"
                      value={act.seconds}
                      min={0}
                      step={0.1}
                      onChange={(v) =>
                        edit((wp) => {
                          const a = wp.actions[i];
                          if (a.kind === 'wait') a.seconds = v;
                        }, `act${act.id}`)
                      }
                    />
                  </div>
                )}
                <div className="row-buttons">
                  <IconButton title="Move up" disabled={i === 0} onClick={() => moveAction(i, i - 1)}>
                    <IconUp />
                  </IconButton>
                  <IconButton title="Move down" disabled={i === w.actions.length - 1} onClick={() => moveAction(i, i + 1)}>
                    <IconDown />
                  </IconButton>
                  <IconButton title="Remove" onClick={() => edit((wp) => wp.actions.splice(i, 1), 'actions')}>
                    <IconX />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
          <CommandPicker
            placeholder="Command name, e.g. Shoot"
            onPick={(name) =>
              updateAuto((a, p) => {
                a.waypoints[index].actions.push({ id: newId('act'), kind: 'command', name });
                ensureCommand(p, name);
              })
            }
          />
          <button
            type="button"
            className="btn small"
            onClick={() => updateAuto((a) => a.waypoints[index].actions.push({ id: newId('act'), kind: 'wait', seconds: 0.5 }))}
          >
            + Wait
          </button>
        </Section>
      )}

      {!isLast && (
        <Section title="Markers (run while driving)">
          <p className="muted small">
            Commands started when the robot {isFirst || stop ? 'leaves' : 'passes'} this point. They run alongside the driving and are
            interrupted at the next stop.
          </p>
          <ul className="chip-list">
            {w.markers.map((m, i) => (
              <li key={`${m}-${i}`} className="chip">
                {m}
                <button type="button" aria-label={`Remove marker ${m}`} onClick={() => edit((wp) => wp.markers.splice(i, 1), 'markers')}>
                  <IconX />
                </button>
              </li>
            ))}
          </ul>
          <CommandPicker
            placeholder="Command, e.g. Intake"
            onPick={(name) =>
              updateAuto((a, p) => {
                a.waypoints[index].markers.push(name);
                ensureCommand(p, name);
              })
            }
          />
        </Section>
      )}
    </div>
  );
}
