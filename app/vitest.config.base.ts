import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// Build-time define constants are injected by Astro's Vite config in
// production. Vitest evaluates source files outside Astro's pipeline so we
// must shim them here, otherwise any code that reads `__APP_VERSION__`
// (e.g. the SettingsScreen About section) sees `undefined` in tests.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Shared Vitest configuration that every tier composes via `mergeConfig`.
// Per-tier configs add their own `include`, `environment`, `setupFiles`,
// and `testTimeout`.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_COMMIT__: JSON.stringify('test'),
  },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      // `include` is intentionally empty at the base level because
      // mergeConfig concatenates arrays — any base include would leak
      // into every tier's scope. Each tier declares its own include.
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.component.test.tsx',
        'src/test/**/*',
        'src/db/types.ts',
        'src/**/*.d.ts',
        'dist/**',
        '.astro/**',
      ],
    },
  },
});
