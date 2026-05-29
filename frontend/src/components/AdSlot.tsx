import { useEffect, useRef, useState } from 'react';
import { AdPlaceholder } from './AdPlaceholder';
import {
  AdSlotSize,
  adSizes,
  adsConfig,
  canRequestAds,
  loadAdSenseScript,
  useAdConsent,
} from '../lib/ads';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

interface AdSlotProps {
  size: AdSlotSize;
  className?: string;
}

function adSlotMatchesViewport(size: AdSlotSize) {
  if (typeof window === 'undefined') return false;
  if (size === 'mobileBanner') return window.matchMedia('(max-width: 767px)').matches;
  if (size === 'sidebar') return window.matchMedia('(min-width: 1024px)').matches;
  return window.matchMedia('(min-width: 768px)').matches;
}

function useAdSlotVisibility(size: AdSlotSize) {
  const [isVisible, setIsVisible] = useState(() => adSlotMatchesViewport(size));

  useEffect(() => {
    const queries = {
      leaderboard: '(min-width: 768px)',
      mobileBanner: '(max-width: 767px)',
      sidebar: '(min-width: 1024px)',
    } satisfies Record<AdSlotSize, string>;
    const media = window.matchMedia(queries[size]);
    const update = () => setIsVisible(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [size]);

  return isVisible;
}

export function AdSlot({ size, className = '' }: AdSlotProps) {
  const pushedRef = useRef(false);
  const [consent] = useAdConsent();
  const isVisible = useAdSlotVisibility(size);
  const canRequest = isVisible && canRequestAds(consent, size);
  const dimensions = adSizes[size];
  const slotId = adsConfig.slots[size];
  const adFormat = size === 'sidebar' ? 'autorelaxed' : 'auto';
  const fullWidthResponsive = size === 'sidebar' ? undefined : 'true';

  useEffect(() => {
    if (!canRequest || pushedRef.current) return;

    pushedRef.current = true;
    loadAdSenseScript(adsConfig.clientId)
      .then(() => {
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
      })
      .catch(() => {
        pushedRef.current = false;
      });
  }, [canRequest]);

  if (!isVisible) return null;

  if (!canRequest) {
    if (!adsConfig.showPlaceholders || consent === 'declined') return null;
    return <AdPlaceholder size={size} className={className} />;
  }

  return (
    <div
      aria-label="Advertisement"
      role="complementary"
      className={`mx-auto max-w-full ${className}`}
      style={{ width: '100%', maxWidth: dimensions.width, minHeight: dimensions.height }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', minHeight: dimensions.height }}
        data-ad-client={adsConfig.clientId}
        data-ad-slot={slotId}
        data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive}
        data-adtest={adsConfig.adTest ? 'on' : undefined}
      />
    </div>
  );
}
