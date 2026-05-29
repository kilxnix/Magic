export type ClientEventKind =
  | 'frontend_error'
  | 'unhandled_rejection'
  | 'route_view'
  | 'api_error'
  | 'network'
  | 'recovery'
  | 'performance';

export type ClientEventSeverity = 'debug' | 'info' | 'warning' | 'error';

interface ClientEventInput {
  kind: ClientEventKind;
  severity?: ClientEventSeverity;
  message: string;
  page?: string;
  request_id?: string;
  component_stack?: string;
  details?: Record<string, string | number | boolean | null | undefined>;
}

const MAX_MESSAGE_LENGTH = 800;
const SENSITIVE_KEY_RE = /token|password|secret|player[_-]?id|key/i;
let installed = false;
let routeEventTimer: number | undefined;

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function currentPage() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

function cleanDetails(details: ClientEventInput['details'] = {}) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details).slice(0, 20)) {
    const cleanKey = cleanText(key, 60);
    if (!cleanKey) continue;
    if (SENSITIVE_KEY_RE.test(cleanKey)) {
      safe[cleanKey] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') safe[cleanKey] = cleanText(value, 240);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) safe[cleanKey] = value;
  }
  return safe;
}

export function reportClientEvent(input: ClientEventInput) {
  if (typeof window === 'undefined') return;
  const payload = {
    kind: input.kind,
    severity: input.severity || 'info',
    message: cleanText(input.message, MAX_MESSAGE_LENGTH) || 'Client event',
    page: input.page || currentPage(),
    request_id: input.request_id,
    component_stack: input.component_stack ? cleanText(input.component_stack, 1600) : undefined,
    details: cleanDetails(input.details),
  };
  const body = JSON.stringify(payload);

  try {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon('/api/ops/client-events', new Blob([body], { type: 'application/json' }));
      if (sent) return;
    }
  } catch {
    // Fall through to fetch.
  }

  fetch('/api/ops/client-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Diagnostics must never make the product feel worse.
  });
}

export function installGlobalDiagnostics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    reportClientEvent({
      kind: 'frontend_error',
      severity: 'error',
      message: event.message || 'Unhandled frontend error',
      details: {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error_name: event.error?.name,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'Unhandled promise rejection');
    reportClientEvent({
      kind: 'unhandled_rejection',
      severity: 'error',
      message: reason,
    });
  });
}

export function reportRouteView(pathname: string) {
  if (typeof window === 'undefined') return;
  window.clearTimeout(routeEventTimer);
  routeEventTimer = window.setTimeout(() => {
    reportClientEvent({
      kind: 'route_view',
      severity: 'debug',
      message: 'Route viewed',
      page: pathname,
      details: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });
  }, 700);
}
