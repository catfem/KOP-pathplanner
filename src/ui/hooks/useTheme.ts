import { useEffect, useState } from 'react';
import type { ThemeChoice } from '../../model/store';

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

/** Applies the theme choice to <html> and reports the theme actually shown. */
export function useTheme(choice: ThemeChoice): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? true);
  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (choice === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
  }, [choice]);
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
}
