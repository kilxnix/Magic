/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_ADS?: string;
  readonly VITE_REQUIRE_AD_CONSENT?: string;
  readonly VITE_SHOW_AD_PLACEHOLDERS?: string;
  readonly VITE_ADSENSE_CLIENT_ID?: string;
  readonly VITE_ADSENSE_SLOT_LEADERBOARD?: string;
  readonly VITE_ADSENSE_SLOT_MOBILE_BANNER?: string;
  readonly VITE_ADSENSE_SLOT_SIDEBAR?: string;
  readonly VITE_ADSENSE_TEST?: string;
  readonly VITE_SHELECTOR_API_BASE?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_DONATION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
