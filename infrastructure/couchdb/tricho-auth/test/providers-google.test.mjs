import { describe, it, expect } from 'vitest';
import { googleConfig } from '../providers/google.mjs';

describe('googleConfig', () => {
  it('returns null when any required env var is missing', () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'x' })).toBeNull();
    expect(
      googleConfig({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }),
    ).toBeNull();
  });

  it('returns a config object with sane defaults when all envs are set', () => {
    const cfg = googleConfig({
      GOOGLE_CLIENT_ID: 'id-x',
      GOOGLE_CLIENT_SECRET: 'secret-x',
      GOOGLE_REDIRECT_URI: 'https://host/cb',
    });
    expect(cfg).toEqual({
      clientId: 'id-x',
      clientSecret: 'secret-x',
      redirectUri: 'https://host/cb',
      issuerUrl: 'https://accounts.google.com',
    });
  });

  it('honours GOOGLE_ISSUER_URL override (CI / mock-oidc)', () => {
    const cfg = googleConfig({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'sec',
      GOOGLE_REDIRECT_URI: 'uri',
      GOOGLE_ISSUER_URL: 'http://mock-oidc:8080',
    });
    expect(cfg.issuerUrl).toBe('http://mock-oidc:8080');
  });
});
