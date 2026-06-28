import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render/runtime errors from the WebGL 3D battlefield — e.g. a lost or
 * unobtainable GL context, an out-of-memory texture upload, or a Three.js throw —
 * and renders a fallback instead of taking down the whole play page. The
 * supportsWebGL() probe only checks that a throwaway context can be created; the
 * live <Canvas> can still fail later, and <Suspense> catches thrown promises, not
 * render-time errors. PlayExperience passes the 2D shell as the fallback so a 3D
 * failure degrades to the working 2D board rather than a blank/crashed screen.
 */
export class CanvasErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; onError?: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for diagnosis; the fallback keeps the game playable.
    console.error('3D battlefield failed; falling back to the 2D board.', error, info);
    this.props.onError?.(error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default CanvasErrorBoundary;
