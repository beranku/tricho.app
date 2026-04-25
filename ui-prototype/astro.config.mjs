import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import AstroPWA from '@vite-pwa/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://tricho.app',
  output: 'static',
  integrations: [
    react(),
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Tricho',
        short_name: 'Tricho',
        description: 'Trichologický deník a CRM',
        theme_color: '#FDFAF3',
        background_color: '#FDFAF3',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'cs',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/offline',
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        runtimeCaching: [
          {
            // Fonty jsou self-hosted v /public/fonts/, tady jen safety net
            urlPattern: /\.(?:woff2?|ttf|otf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 rok
              }
            }
          },
          {
            // SVG ikony a obrázky
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: false, // PWA mode vypnutý v dev, zapneme až pro preview
        type: 'module'
      }
    })
  ],
  vite: {
    build: {
      target: 'es2022'
    }
  }
});
