// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

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
  integrations: [react()],
  vite: viteServer ? { server: viteServer } : {},
});
