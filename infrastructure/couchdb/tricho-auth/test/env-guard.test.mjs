import { describe, it, expect } from 'vitest';
import { assertProdIntegrationsAreReal } from '../env-guard.mjs';

describe('assertProdIntegrationsAreReal', () => {
  it('is a no-op when NODE_ENV is unset', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        APPLE_OIDC_ISSUER: 'http://mock-oidc:8080/apple',
      }),
    ).not.toThrow();
  });

  it('is a no-op in development with mock-pointing values', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'development',
        GOOGLE_ISSUER_URL: 'http://mock-oidc:8080/google',
        APPLE_OIDC_ISSUER: 'http://mock-oidc:8080/apple',
        STRIPE_API_BASE: 'http://stripe-mock:12111',
      }),
    ).not.toThrow();
  });

  it('rejects mock APPLE_OIDC_ISSUER in production', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'production',
        APPLE_OIDC_ISSUER: 'http://mock-oidc:8080/apple',
      }),
    ).toThrow(/APPLE_OIDC_ISSUER points at a mock host/);
  });

  it('rejects mock GOOGLE_ISSUER_URL in production', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'production',
        GOOGLE_ISSUER_URL: 'https://tricho.test/mock-oidc',
      }),
    ).toThrow(/GOOGLE_ISSUER_URL points at a mock host/);
  });

  it('rejects mock STRIPE_API_BASE in production', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'production',
        STRIPE_API_BASE: 'http://localhost:12111',
      }),
    ).toThrow(/STRIPE_API_BASE points at a mock host/);
  });

  it('accepts real production values', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'production',
        GOOGLE_ISSUER_URL: 'https://accounts.google.com',
        APPLE_OIDC_ISSUER: 'https://appleid.apple.com',
        STRIPE_API_BASE: 'https://api.stripe.com',
      }),
    ).not.toThrow();
  });

  it('accepts production with no integration env vars set', () => {
    expect(() => assertProdIntegrationsAreReal({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('does not mistake `tricho.app` for the mock `tricho.test`', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'production',
        APPLE_OIDC_ISSUER: 'https://auth.tricho.app',
      }),
    ).not.toThrow();
  });

  it('matches the mock host as a word, not a substring', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'production',
        STRIPE_API_BASE: 'https://api.stripe-mock-prod.example.com',
      }),
    ).toThrow(/STRIPE_API_BASE points at a mock host/);
  });

  it('flags 127.0.0.1 as a mock host', () => {
    expect(() =>
      assertProdIntegrationsAreReal({
        NODE_ENV: 'production',
        APPLE_OIDC_ISSUER: 'http://127.0.0.1:8080/apple',
      }),
    ).toThrow(/APPLE_OIDC_ISSUER points at a mock host/);
  });
});
