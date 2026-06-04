import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// https://vitejs.dev/config/
export default defineConfig(function (_a) {
    var _b;
    var mode = _a.mode;
    var env = loadEnv(mode, '.', '');
    var adsenseClientId = (_b = env.VITE_ADSENSE_CLIENT_ID) === null || _b === void 0 ? void 0 : _b.trim();
    var adsEnabled = env.VITE_ENABLE_ADS === 'true' && Boolean(adsenseClientId);
    var plugins = [react()];
    if (adsEnabled) {
        plugins.push({
            name: 'magicbrains-adsense-loader',
            transformIndexHtml: function () {
                return [
                    {
                        tag: 'script',
                        attrs: {
                            async: true,
                            src: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=".concat(adsenseClientId),
                            crossorigin: 'anonymous',
                            'data-magicbrains-adsense': 'true',
                        },
                        injectTo: 'head',
                    },
                ];
            },
        });
    }
    plugins.push(VitePWA({
        registerType: 'autoUpdate',
        selfDestroying: true,
        workbox: {
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: true,
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            runtimeCaching: [
                {
                    urlPattern: /^https:\/\/cards\.scryfall\.io\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                        cacheName: 'scryfall-images',
                        expiration: { maxEntries: 5000, maxAgeSeconds: 60 * 60 * 24 * 30 },
                        cacheableResponse: { statuses: [0, 200] },
                    },
                },
                {
                    urlPattern: /\/api\/.*/i,
                    handler: 'NetworkFirst',
                    options: {
                        cacheName: 'api-cache',
                        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
                        cacheableResponse: { statuses: [0, 200] },
                    },
                },
                {
                    urlPattern: /\/shelector-api\/.*/i,
                    handler: 'NetworkFirst',
                    options: {
                        cacheName: 'shelector-api-cache',
                        expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
                        cacheableResponse: { statuses: [0, 200] },
                    },
                },
            ],
        },
        manifest: {
            name: 'Magic Brains - MTG Commander Practice',
            short_name: 'Magic Brains',
            description: 'MTG Commander practice with early browser reps and post-game play-by-play review',
            theme_color: '#17120f',
            background_color: '#17120f',
            display: 'standalone',
            icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            ],
        },
    }));
    return {
        plugins: plugins,
        test: {
            exclude: [
                'node_modules/**',
                'dist/**',
                'e2e/**',
                'test-results/**',
                'playwright-report/**',
            ],
        },
        server: {
            host: "0.0.0.0",
            allowedHosts: true,
            proxy: {
                '/api': {
                    target: 'http://localhost:8000',
                    changeOrigin: true,
                },
                '/shelector-api': {
                    target: 'http://localhost:8100',
                    changeOrigin: true,
                    rewrite: function (path) { return path.replace(/^\/shelector-api/, ''); },
                }
            }
        }
    };
});
