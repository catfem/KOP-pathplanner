// In-app confirmation dialog (instead of the blocking window.confirm).

import { useSyncExternalStore } from 'react';
import { Modal } from './Modal';

interface Request {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let current: Request | null = null;
const listeners = new Set<() => void>();

function set(next: Request | null) {
  current = next;
  listeners.forEach((l) => l());
}

/** Asks the user to confirm; resolves true when they do. */
export function confirmAction(options: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    set({
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'OK',
      danger: options.danger ?? false,
      resolve,
    });
  });
}

export function ConfirmHost() {
  const request = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!request) return null;
  const finish = (ok: boolean) => {
    request.resolve(ok);
    set(null);
  };
  return (
    <Modal title={request.title} onClose={() => finish(false)} size="sm" alert>
      <div className="confirm-body">
        <p>{request.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={() => finish(false)}>
            Cancel
          </button>
          <button type="button" className={`btn ${request.danger ? 'danger' : 'primary'}`} onClick={() => finish(true)} data-autofocus>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
