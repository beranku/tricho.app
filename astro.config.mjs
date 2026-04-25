// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import AstroPWA from '@vite-pwa/astro';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

// When running Astro's dev server inside a container behind Traefik, the
// browser connects to a public hostname that the container itself can't see.
// Vite's HMR websocket defaults to location.host/port on the client, which
// works out of the box — but only because we explicitly pass the public
// host + port here so Vite doesn't guess based on internal Docker DNS.
//
// On a plain `npm run dev` (no container, no Traefik), these env vars are
// unset and Vite falls back to its defaults (localhost:4321). Don't set them
// in that case.
const pwaHost = process.env.PUBLIC_PWA_HOST;
const pwaPort = process.env.PUBLIC_PWA_PORT;
const pwaProtocol = process.env.PUBLIC_PWA_PROTOCOL ?? 'https';

const viteServer =
  pwaHost && pwaPort
    ? {
        allowedHosts: [pwaHost],
        hmr: {
          host: pwaHost,
          clientPort: Number(pwaPort),
          protocol: pwaProtocol === 'https' ? 'wss' : 'ws',
        },
      }
    : undefined;

// https://astro.build/config
export default defineConfig({
  site: 'https://tricho.app',
  integrations: [
    react(),
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Tricho',
        short_name: 'Tricho',
        // Manifest description is install-prompt metadata, not user-facing
        // app copy; localizing it requires per-locale manifests, deferred.
        description: 'Trichology diary and CRM (offline-first PWA)',
        theme_color: '#FDFAF3',
        background_color: '#FDFAF3',
        display: 'standalone',
        orientation: 'portrait',
        // Default-locale-only manifest. The runtime swaps `<html lang>`
        // per the user's `_local/locale` choice; the manifest is not
        // localized in this iteration (see proposal non-goals).
        lang: 'en',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        navigateFallback: '/offline',
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /\.(?:woff2?|ttf|otf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  vite: {
    ...(viteServer ? { server: viteServer } : {}),
    plugins: [
      // Paraglide JS 2.0 — compiles `src/i18n/messages/*.json` into the
      // tree-shakable runtime under `src/paraglide/`. Strategy is
      // `globalVariable` (set by `src/i18n/runtime.ts` after reading
      // `_local/locale`) with `baseLocale` (English) as last-resort fallback.
      // No URL/cookie strategy: this PWA has no SEO-indexable surface.
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        strategy: ['globalVariable', 'baseLocale'],
      }),
    ],
  },
});
