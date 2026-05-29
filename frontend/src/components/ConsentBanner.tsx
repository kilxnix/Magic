import { adsConfig, setAdConsent, useAdConsent } from '../lib/ads';
import { isInteractiveGamePath, useCurrentPathname } from '../lib/pageSurfaces';

export function ConsentBanner() {
  const pathname = useCurrentPathname();
  const [consent] = useAdConsent();

  if (isInteractiveGamePath(pathname)) return null;
  if (!adsConfig.enabled || !adsConfig.requireConsent || consent) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 rounded-xl border border-stone-300 bg-white px-3 py-3 shadow-2xl shadow-black/20 sm:inset-x-4 sm:px-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-3xl text-xs leading-5 text-stone-700 sm:text-sm sm:leading-6">
          <span className="font-black text-stone-950">Ads keep Magic Brains free.</span>{' '}
          We use ad storage only after consent.
          <span className="hidden sm:inline"> Ads are kept away from the live play area, card clicks, and game controls.</span>{' '}
          See the <a href="/privacy" className="font-bold text-red-700 hover:text-red-900">Privacy Policy</a>.
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:shrink-0">
          <button
            type="button"
            onClick={() => setAdConsent('declined')}
            className="min-h-[40px] rounded-lg border border-stone-300 px-3 text-sm font-bold text-stone-700 transition hover:bg-stone-100 sm:px-5"
          >
            Decline Ads
          </button>
          <button
            type="button"
            onClick={() => setAdConsent('accepted')}
            className="min-h-[40px] rounded-lg bg-stone-950 px-3 text-sm font-black text-white transition hover:bg-stone-800 sm:px-5"
          >
            Allow Ads
          </button>
        </div>
      </div>
    </div>
  );
}
