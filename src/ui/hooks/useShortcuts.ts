import { useEffect } from 'react';
import { deleteWaypoint } from '../../model/edit';
import { getState, redo, selectedAuto, setUi, undo, updateAuto } from '../../model/store';

const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);

/** True when keys should go to a text field instead of the app shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && TEXT_INPUTS.has((t as HTMLInputElement).type);
}

/** Global keyboard shortcuts. Disabled while a dialog is open. */
export function useShortcuts(totalTime: number): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const { ui } = getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'y')) {
        if (isTyping(e.target)) return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (isTyping(e.target) || mod || e.altKey) return;
      const auto = selectedAuto();
      const sel = ui.selectedIndex;
      switch (e.key) {
        case ' ':
          // Space on a focused control keeps its own meaning.
          if ((e.target as HTMLElement | null)?.closest?.('button, input, select, a, [role="tab"]')) return;
          e.preventDefault();
          setUi({ playing: !ui.playing, time: !ui.playing && ui.time >= totalTime ? 0 : ui.time });
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
          if (sel === null || !auto?.waypoints[sel]) return;
          if ((e.target as HTMLElement | null)?.closest?.('[role="tablist"], [role="menu"], select')) return;
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
  }, [totalTime]);
}
