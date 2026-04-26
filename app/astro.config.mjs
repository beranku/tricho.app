// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import react from '@astrojs/react';
import AstroPWA from '@vite-pwa/astro';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

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
  site: 'https://tricho.app/app',
  base: '/app/',
  integrations: [
    react(),
    AstroPWA({
      // User-controlled update prompt — `prompt` semantics so the in-app
      // update banner gates SKIP_WAITING. See app-release-versioning spec.
      registerType: 'prompt',
      // Manifest comes from /shared/manifest.webmanifest (single source of
      // truth shared with the marketing site); do not generate one here.
      manifest: false,
      // We register the SW manually with explicit { scope: '/app/' } in
      // src/main.ts so do not let the plugin auto-inject a registration.
      injectRegister: false,
      strategies: 'generateSW',
      filename: 'sw.js',
      scope: '/app/',
      workbox: {
        // Navigation fallback for SPA-style deep links inside /app/.
        navigateFallback: '/app/offline',
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        // User-controlled update — do NOT auto-skip-waiting or claim clients.
        skipWaiting: false,
        clientsClaim: false,
        cleanupOutdatedCaches: true,
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
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) || 'dev'),
    },
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
