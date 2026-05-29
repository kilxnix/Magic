import { useState } from 'react';
import { X } from 'lucide-react';
import { isInteractiveGamePath, useCurrentPathname } from '../lib/pageSurfaces';

const ALPHA_BANNER_DISMISSED_KEY = 'deckreps_alpha_banner_dismissed';

export function AlphaBanner() {
  const pathname = useCurrentPathname();
  const [dismissed, setDismissed] = useState(() => (
    typeof window !== 'undefined' && window.localStorage.getItem(ALPHA_BANNER_DISMISSED_KEY) === '1'
  ));

  if (isInteractiveGamePath(pathname)) return null;
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    window.localStorage.setItem(ALPHA_BANNER_DISMISSED_KEY, '1');
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 sm:left-auto sm:max-w-lg">
      <div className="flex items-start gap-3 rounded-lg border border-amber-300/40 bg-stone-950/90 px-4 py-2 text-xs font-bold leading-5 text-amber-50 shadow-2xl shadow-black/30 backdrop-blur">
        <span className="min-w-0 flex-1 text-center">
          Alpha version: DeckReps is being actively developed. Features and game review may change.
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="-mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-amber-200/20 bg-stone-900/80 text-amber-100 transition-colors hover:bg-stone-800 hover:text-white"
          title="Dismiss alpha notice"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
