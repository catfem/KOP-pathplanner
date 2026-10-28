import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getState } from '../../model/store';
import { downloadBlob } from '../lib/files';

interface Props {
  /** Shown in the fallback, e.g. "the field view". */
  area: string;
  children: ReactNode;
  /** Remount the children when this changes (e.g. the selected auto). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one broken area from blanking the whole app. The fallback offers a
 * retry and a download of the current project so no work is lost.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`KOP Path Planner: error in ${this.props.area}`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-fallback" role="alert">
        <strong>Something went wrong in {this.props.area}.</strong>
        <p className="muted small">{error.message || String(error)}</p>
        <div className="button-row">
          <button type="button" className="btn small" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => downloadBlob('kop-autos-backup.kop.json', JSON.stringify(getState().project, null, 2), 'application/json')}
          >
            Download project backup
          </button>
        </div>
      </div>
    );
  }
}
