import { describe, it, expect } from 'vitest';

// Define-time constants are injected by vite/astro `define`. In tests they
// resolve at module-evaluation time of the SUT, so we cannot trivially
// override them after the SUT is loaded. Instead this test asserts that
// the values exist as strings (which is what the production build
// guarantees) and that the SettingsScreen module imports without error
// when read alongside them.

describe('SettingsScreen — About section', () => {
  it('build constants are defined as strings', () => {
    expect(typeof __APP_VERSION__).toBe('string');
    expect(__APP_VERSION__.length).toBeGreaterThan(0);
    expect(typeof __APP_BUILD_TIME__).toBe('string');
    // Build time should be ISO-8601-parseable.
    expect(Number.isFinite(new Date(__APP_BUILD_TIME__).getTime())).toBe(true);
    expect(typeof __APP_COMMIT__).toBe('string');
  });

  it('SettingsScreen module imports cleanly with the constants in scope', async () => {
    const mod = await import('./SettingsScreen');
    expect(typeof mod.SettingsScreen).toBe('function');
  });
});
