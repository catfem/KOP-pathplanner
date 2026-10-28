import { dismissToast, useStore } from '../../model/store';
import { IconX } from './icons';

export function ToastHost() {
  const toast = useStore((s) => s.toast);
  return (
    <div className="toast-region" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast ${toast.level}`} role={toast.level === 'error' ? 'alert' : 'status'}>
          <span>{toast.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={dismissToast}>
            <IconX />
          </button>
        </div>
      )}
    </div>
  );
}
