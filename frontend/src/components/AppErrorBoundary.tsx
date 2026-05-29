import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { reportClientEvent } from '../lib/diagnostics';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  incidentId: string;
}

function makeIncidentId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    incidentId: '',
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      incidentId: makeIncidentId(),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientEvent({
      kind: 'frontend_error',
      severity: 'error',
      message: error.message || 'React render failure',
      component_stack: info.componentStack || undefined,
      details: {
        incident_id: this.state.incidentId,
        error_name: error.name,
      },
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-[#17120f] px-4 py-10 text-stone-50">
        <div className="mx-auto flex min-h-[80svh] max-w-2xl flex-col items-center justify-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-lg border border-amber-300/40 bg-amber-300/10">
            <AlertTriangle className="h-7 w-7 text-amber-200" />
          </div>
          <h1 className="mt-6 font-serif text-4xl font-bold">Something slipped.</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-stone-300">
            The page hit a recoverable app error. The incident was logged without decklists, passwords, or player tokens so it can be diagnosed.
          </p>
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-bold text-stone-200">
            Incident {this.state.incidentId}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-amber-300 px-5 text-sm font-black text-stone-950"
            >
              <RefreshCw className="h-4 w-4" />
              Reload
            </button>
            <a
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/20 px-5 text-sm font-black text-stone-50"
            >
              <Home className="h-4 w-4" />
              Home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
