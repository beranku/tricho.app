// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// Marketing site is fully static; SEO and crawler ingestion are first-class
// concerns. The PWA shell at /app/ has its own (separate) build under app/
// and is composed into the final dist/ by scripts/merge-dist.mjs.
//
// The sitemap excludes /app/* — the PWA shell is an empty SPA loader, not
// crawler-targeted content. /robots.txt (public/) makes the same exclusion
// explicit at the user-agent level.

export default defineConfig({
  site: 'https://tricho.app',
  output: 'static',
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.startsWith('https://tricho.app/app'),
    }),
  ],
  build: {
    // Inline small assets to keep the marketing landing's request count low.
    inlineStylesheets: 'auto',
  },
  vite: {
    // No HMR-server config: the marketing site only runs locally for editing
    // and the production build is fully static.
  },
});
