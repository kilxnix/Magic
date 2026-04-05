import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
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
        name: 'Magic Brains - MTG Commander',
        short_name: 'Magic Brains',
        description: 'MTG Commander deck generator and AI game',
        theme_color: '#292524',
        background_color: '#1c1917',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
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
        rewrite: (path) => path.replace(/^\/shelector-api/, ''),
      }
    }
  }
})
