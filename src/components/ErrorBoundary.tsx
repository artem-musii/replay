import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { BrandMark } from "./BrandMark";

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostics useful without printing a user-authored error message,
    // case payload, or evidence metadata into a persistent browser console.
    console.error("REPLAY recovered from an interface error", {
      errorName: error.name,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="fatal-state" id="main-content" tabIndex={-1}>
        <BrandMark />
        <p className="section-kicker">Recoverable workspace error</p>
        <h1>REPLAY could not render this view.</h1>
        <p>
          Reload to try to recover the last successfully saved local case, or return to the landing
          page. Unsaved changes may not be recoverable. No raw error details have been copied or
          uploaded.
        </p>
        <div className="fatal-state__actions">
          <button className="button button--primary" onClick={() => window.location.reload()}>
            Reload REPLAY
          </button>
          <button
            className="button button--secondary"
            onClick={() => {
              window.location.assign(new URL(import.meta.env.BASE_URL, window.location.origin));
            }}
          >
            Return home
          </button>
        </div>
      </main>
    );
  }
}
