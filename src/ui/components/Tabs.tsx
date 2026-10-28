import { type ReactNode, useRef } from 'react';

interface TabsProps<T extends string> {
  tabs: { id: T; label: ReactNode; badge?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Prefix for tab / panel ids (aria-controls). */
  idPrefix: string;
}

/** Tab list with roving focus: arrow keys, Home and End move between tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusTab = (i: number) => {
    const n = tabs.length;
    const index = ((i % n) + n) % n;
    onChange(tabs[index].id);
    refs.current[index]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'active' : undefined}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') focusTab(i + 1);
              else if (e.key === 'ArrowLeft') focusTab(i - 1);
              else if (e.key === 'Home') focusTab(0);
              else if (e.key === 'End') focusTab(tabs.length - 1);
              else return;
              e.preventDefault();
            }}
          >
            {t.label}
            {t.badge && <span className="tab-badge" aria-label="needs attention" />}
          </button>
        );
      })}
    </div>
  );
}
