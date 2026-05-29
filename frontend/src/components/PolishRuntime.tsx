import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { installGlobalDiagnostics, reportClientEvent, reportRouteView } from '../lib/diagnostics';
import { isInteractiveGamePath, useCurrentPathname } from '../lib/pageSurfaces';

type ConnectionState = 'online' | 'offline' | 'restored';

export function PolishRuntime() {
  const pathname = useCurrentPathname();
  const interactive = isInteractiveGamePath(pathname);
  const [connection, setConnection] = useState<ConnectionState>(() => (
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'
  ));

  useEffect(() => {
    installGlobalDiagnostics();
  }, []);

  useEffect(() => {
    reportRouteView(pathname);
    const main = document.querySelector('main');
    if (main && !main.id) {
      main.id = 'deckreps-main';
    }
  }, [pathname]);

  useEffect(() => {
    function onOffline() {
      setConnection('offline');
      reportClientEvent({
        kind: 'network',
        severity: 'warning',
        message: 'Browser went offline',
      });
    }

    function onOnline() {
      setConnection('restored');
      reportClientEvent({
        kind: 'recovery',
        severity: 'info',
        message: 'Browser connection restored',
      });
      window.setTimeout(() => setConnection('online'), 4500);
    }

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return (
    <>
      <a
        href="#deckreps-main"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-stone-950 shadow-lg transition focus:translate-y-0"
      >
        Skip to main content
      </a>
      <div aria-live="polite" className="sr-only">
        {connection === 'offline' ? 'Connection lost.' : connection === 'restored' ? 'Connection restored.' : ''}
      </div>
      {connection !== 'online' && (
        <div
          className={`fixed left-3 z-[75] max-w-[calc(100vw-1.5rem)] rounded-lg border px-3 py-2 text-sm font-black shadow-2xl sm:left-5 ${
            interactive ? 'top-[calc(env(safe-area-inset-top)+4.5rem)]' : 'top-20'
          } ${
            connection === 'offline'
              ? 'border-red-200 bg-red-950 text-red-50 shadow-red-950/20'
              : 'border-emerald-200 bg-emerald-950 text-emerald-50 shadow-emerald-950/20'
          }`}
        >
          <div className="flex items-center gap-2">
            {connection === 'offline' ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
            {connection === 'offline'
              ? 'Offline. Actions will retry after the connection returns.'
              : 'Connection restored.'}
          </div>
        </div>
      )}
    </>
  );
}
