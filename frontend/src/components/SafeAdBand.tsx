import { AdSlot } from './AdSlot';
import { adsConfig, canRequestAds, shouldRenderAdSurface, useAdConsent } from '../lib/ads';

interface SafeAdBandProps {
  className?: string;
}

export function SafeAdBand({ className = '' }: SafeAdBandProps) {
  const [consent] = useAdConsent();
  const hasRequestableAd = canRequestAds(consent, 'leaderboard') || canRequestAds(consent, 'mobileBanner');

  if (!shouldRenderAdSurface()) return null;
  if (!adsConfig.showPlaceholders && !hasRequestableAd) return null;

  return (
    <section className={`border-y border-stone-200 bg-stone-100 px-4 py-8 sm:px-6 ${className}`}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">
          Advertisement
        </div>
        <AdSlot size="leaderboard" className="hidden md:flex" />
        <AdSlot size="mobileBanner" className="md:hidden" />
      </div>
    </section>
  );
}
