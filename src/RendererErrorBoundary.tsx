import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportRendererIssue } from "./rendererDiagnostics";

interface RendererErrorBoundaryProps {
  children: ReactNode;
}

interface RendererErrorBoundaryState {
  error: Error | null;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererIssue("renderer-react-error", error, {
      componentStack: info.componentStack,
      source: "react-error-boundary",
    });
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="renderer-error-shell" role="alert">
        <section className="renderer-error-panel">
          <h1>LatexDo hit a renderer error</h1>
          <p>
            The editor stopped rendering. A diagnostic entry was recorded; reload the
            window to recover.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Editor
          </button>
        </section>
      </main>
    );
  }
}
