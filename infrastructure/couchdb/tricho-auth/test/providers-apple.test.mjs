import { describe, it, expect } from 'vitest';
import { appleConfig } from '../providers/apple.mjs';

const FAKE_P8 = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;

describe('appleConfig', () => {
  it('null when any env var is missing', () => {
    expect(appleConfig({})).toBeNull();
    expect(appleConfig({ APPLE_CLIENT_ID: 'x' })).toBeNull();
    expect(appleConfig({
      APPLE_CLIENT_ID: 'x',
      APPLE_TEAM_ID: 'y',
      APPLE_KEY_ID: 'z',
      APPLE_REDIRECT_URI: 'https://host/cb',
      // no APPLE_PRIVATE_KEY{,PATH} — config must be null
    })).toBeNull();
  });

  it('returns full config when APPLE_PRIVATE_KEY is inlined', () => {
    const cfg = appleConfig({
      APPLE_CLIENT_ID: 'com.tricho.app',
      APPLE_TEAM_ID: 'TEAM1234',
      APPLE_KEY_ID: 'KEY5678',
      APPLE_REDIRECT_URI: 'https://host/auth/apple/callback',
      APPLE_PRIVATE_KEY: FAKE_P8,
    });
    expect(cfg).toMatchObject({
      clientId: 'com.tricho.app',
      teamId: 'TEAM1234',
      keyId: 'KEY5678',
      redirectUri: 'https://host/auth/apple/callback',
    });
    expect(cfg.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });
});
