import { useEffect, useState } from 'react';

export type AdConsent = 'accepted' | 'declined';
export type AdSlotSize = 'sidebar' | 'leaderboard' | 'mobileBanner';

export const AD_CONSENT_STORAGE_KEY = 'magicbrains_ad_consent_v1';

export const adSizes: Record<AdSlotSize, { width: number; height: number; label: string }> = {
  sidebar: { width: 300, height: 250, label: '300x250' },
  leaderboard: { width: 728, height: 90, label: '728x90' },
  mobileBanner: { width: 320, height: 100, label: '320x100' },
};

export const adsConfig = {
  enabled: import.meta.env.VITE_ENABLE_ADS === 'true',
  requireConsent: import.meta.env.VITE_REQUIRE_AD_CONSENT !== 'false',
  showPlaceholders:
    import.meta.env.VITE_SHOW_AD_PLACEHOLDERS === 'true'
    || (import.meta.env.DEV && import.meta.env.VITE_SHOW_AD_PLACEHOLDERS !== 'false'),
  clientId: import.meta.env.VITE_ADSENSE_CLIENT_ID || '',
  adTest: import.meta.env.VITE_ADSENSE_TEST === 'true',
  slots: {
    leaderboard: import.meta.env.VITE_ADSENSE_SLOT_LEADERBOARD || '',
    mobileBanner: import.meta.env.VITE_ADSENSE_SLOT_MOBILE_BANNER || '',
    sidebar: import.meta.env.VITE_ADSENSE_SLOT_SIDEBAR || '',
  } satisfies Record<AdSlotSize, string>,
};

export function getAdConsent(): AdConsent | null {
  try {
    const value = localStorage.getItem(AD_CONSENT_STORAGE_KEY);
    return value === 'accepted' || value === 'declined' ? value : null;
  } catch {
    return null;
  }
}

export function setAdConsent(value: AdConsent) {
  localStorage.setItem(AD_CONSENT_STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent('magicbrains-ad-consent', { detail: value }));
}

export function useAdConsent() {
  const [consent, setConsent] = useState<AdConsent | null>(() => getAdConsent());

  useEffect(() => {
    const onConsent = () => setConsent(getAdConsent());
    window.addEventListener('storage', onConsent);
    window.addEventListener('magicbrains-ad-consent', onConsent);
    return () => {
      window.removeEventListener('storage', onConsent);
      window.removeEventListener('magicbrains-ad-consent', onConsent);
    };
  }, []);

  return [consent, setAdConsent] as const;
}

export function canRequestAds(consent: AdConsent | null, size: AdSlotSize) {
  if (!adsConfig.enabled || !adsConfig.clientId || !adsConfig.slots[size]) return false;
  return !adsConfig.requireConsent || consent === 'accepted';
}

export function shouldRenderAdSurface() {
  return adsConfig.showPlaceholders
    || Boolean(adsConfig.enabled && adsConfig.clientId && Object.values(adsConfig.slots).some(Boolean));
}

let adsenseScriptPromise: Promise<void> | null = null;

export function loadAdSenseScript(clientId: string) {
  if (adsenseScriptPromise) return adsenseScriptPromise;

  adsenseScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-magicbrains-adsense="true"]');
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.magicbrainsAdsense = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('AdSense script failed to load'));
    document.head.appendChild(script);
  });

  return adsenseScriptPromise;
}
