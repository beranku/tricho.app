import { describe, it, expect } from 'vitest';
import { detectPlatform, getPrfCapabilities } from './prf';

describe('Platform Detection', () => {
  it('returns a valid platform type', () => {
    const platform = detectPlatform();
    expect([
      'safari-ios',
      'safari-macos',
      'chrome-android',
      'chrome-desktop',
      'edge-desktop',
      'firefox',
      'unknown',
    ]).toContain(platform);
  });
});

describe('PRF Capabilities', () => {
  it('returns expected capability structure', async () => {
    const caps = await getPrfCapabilities();

    expect(caps).toHaveProperty('webAuthnSupported');
    expect(caps).toHaveProperty('prfApiAvailable');
    expect(caps).toHaveProperty('prfLikelyAvailable');
    expect(caps).toHaveProperty('platform');
    expect(caps).toHaveProperty('warnings');
    expect(caps).toHaveProperty('recommendedMethod');
    expect(Array.isArray(caps.warnings)).toBe(true);
    expect(['prf', 'rs']).toContain(caps.recommendedMethod);
  });
});
