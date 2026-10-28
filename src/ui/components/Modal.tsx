import { type ReactNode, useEffect, useId, useRef } from 'react';
import { IconButton } from './controls';
import { IconX } from './icons';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Extra controls in the header, between the title and the close button. */
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** role="alertdialog" for confirmations. */
  alert?: boolean;
}

/**
 * Accessible dialog: traps Tab focus inside, closes on Escape or a backdrop
 * click, and gives focus back to whatever was focused before it opened.
 */
export function Modal({ title, onClose, children, actions, size = 'md', alert }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const first = dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === firstItem || document.activeElement === dialog)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal modal-${size}`}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {actions}
          <div className="spacer" />
          <IconButton title="Close (Esc)" onClick={onClose}>
            <IconX />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
