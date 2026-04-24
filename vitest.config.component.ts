import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.base';

// React component tier. jsdom + RTL + userEvent + @testing-library/jest-dom.
// Median runtime: < 50 ms per test.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts', './src/test/component-setup.ts'],
      include: ['src/components/**/*.component.test.tsx'],
      passWithNoTests: true,
      coverage: {
        include: ['src/components/**/*.tsx'],
        exclude: ['src/components/**/*.component.test.tsx'],
        reportsDirectory: 'coverage/component',
      },
    },
  }),
);
