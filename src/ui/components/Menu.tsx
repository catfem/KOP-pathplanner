import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void | Promise<void>;
  separatorBefore?: boolean;
  danger?: boolean;
}

/**
 * Button with a dropdown menu. Opens on click, focuses the first item, moves
 * with the arrow keys and closes on Escape, Tab or a click outside.
 */
export function Menu({
  label,
  items,
  buttonContent,
  buttonLabel,
  buttonClassName = 'btn ghost',
}: {
  label: string;
  items: MenuItem[];
  buttonContent: ReactNode;
  /** Accessible name (and tooltip) for a button that shows only an icon. */
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const move = (from: number, delta: number) => {
    const n = items.length;
    itemRefs.current[(from + delta + n) % n]?.focus();
  };

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={buttonLabel}
        title={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {buttonContent}
      </button>
      {open && (
        <div className="menu-pop" role="menu" aria-label={label}>
          {items.map((item, i) => (
            <div key={item.label} role="none">
              {item.separatorBefore && <hr />}
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : undefined}
                onClick={() => {
                  close(false);
                  void item.onSelect();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') move(i, 1);
                  else if (e.key === 'ArrowUp') move(i, -1);
                  else if (e.key === 'Escape') close(true);
                  else if (e.key === 'Tab') close(false);
                  else return;
                  if (e.key !== 'Tab') e.preventDefault();
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
