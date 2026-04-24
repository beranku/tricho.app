import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.base';

// Pure-logic tier. No browser APIs beyond what jsdom + fake-indexeddb give
// us; no network; no containers. Median runtime: < 10 ms per test.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.component.test.tsx'],
      coverage: {
        reportsDirectory: 'coverage/unit',
      },
    },
  }),
);
