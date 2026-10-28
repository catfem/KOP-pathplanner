import { useEffect } from 'react';
import { getState, setUi } from '../../model/store';

/** Advances the timeline while playing; stops at the end of the auto. */
export function usePlayback(playing: boolean, totalTime: number): void {
  useEffect(() => {
    if (!playing) return;
    if (!(totalTime > 0)) {
      setUi({ playing: false });
      return;
    }
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // Clamp the step so a backgrounded tab does not jump to the end.
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const { ui } = getState();
      const t = Math.min(totalTime, ui.time + dt * ui.speed);
      if (t >= totalTime) {
        setUi({ time: totalTime, playing: false });
        return;
      }
      setUi({ time: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, totalTime]);
}
