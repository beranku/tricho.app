import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { openVaultDb, destroyVaultDb } from '../db/pouch';
import { generateAesGcmKey } from '../crypto/envelope';
import { TokenStore, SERVER_IDENTITY_DOC_ID } from './token-store';
import type { OAuthResult } from './oauth';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'test-vault-tokenstore';

function mockOAuthResult(overrides: Partial<OAuthResult> = {}): OAuthResult {
  return {
    ok: true,
    isNewUser: true,
    deviceApproved: true,
    hasRemoteVault: false,
    couchdbUsername: 'g_abcd1234',
    email: 'test@example.com',
    name: 'Test User',
    picture: null,
    provider: 'google',
    deviceId: 'dev-123',
    devices: [],
    subscription: null,
    tokens: {
      jwt: 'fake.jwt.token',
      jwtExp: Math.floor(Date.now() / 1000) + 3600,
      refreshToken: 'rt-raw-value',
      refreshTokenExp: Date.now() + 86400_000,
    },
    ...overrides,
  };
}

describe('TokenStore', () => {
  let dek: CryptoKey;

  beforeEach(async () => {
    dek = await generateAesGcmKey(false);
  });

  afterEach(async () => {
    await destroyVaultDb().catch(() => void 0);
  });

  it('seeds from OAuth and round-trips through load()', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const store = new TokenStore(db);
    await store.seedFromOAuth(mockOAuthResult());

    // Identity doc should be an encrypted payload — plaintext fields must not appear.
    const raw = await db.pouch.get(SERVER_IDENTITY_DOC_ID);
    expect(JSON.stringify(raw.payload)).not.toContain('rt-raw-value');
    expect(JSON.stringify(raw.payload)).not.toContain('g_abcd1234');

    // A fresh store should decrypt identically.
    const fresh = new TokenStore(db);
    const identity = await fresh.load();
    expect(identity?.refreshToken).toBe('rt-raw-value');
    expect(identity?.couchdbUsername).toBe('g_abcd1234');
    expect(identity?.deviceId).toBe('dev-123');
    expect(identity?.oauthProvider).toBe('google');
  });

  it('decryption fails with a different DEK', async () => {
    let db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    let store = new TokenStore(db);
    await store.seedFromOAuth(mockOAuthResult());
    await destroyVaultDb();

    const wrongDek = await generateAesGcmKey(false);
    db = await openVaultDb(VAULT_ID, wrongDek, { adapter: 'memory' });
    store = new TokenStore(db);
    // load() returns null when decryption fails — never throws to the caller.
    const identity = await store.load();
    expect(identity).toBeNull();
  });

  it('bearerFetch injects Authorization header when JWT is fresh', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const store = new TokenStore(db);
    await store.seedFromOAuth(mockOAuthResult());
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    await store.bearerFetch('https://example.test/userdb-foo/doc');
    const [, init] = spy.mock.calls[0];
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer fake.jwt.token');
    spy.mockRestore();
  });

  it('bearerFetch throws PlanExpiredError on 402', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const store = new TokenStore(db);
    await store.seedFromOAuth(mockOAuthResult());
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'plan_expired',
          reason: 'sync_entitlement_missing',
          paidUntil: 1234,
          gracePeriodEndsAt: 5678,
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      ),
    );
    const { PlanExpiredError } = await import('./subscription');
    await expect(store.bearerFetch('https://example.test/userdb-foo/doc')).rejects.toBeInstanceOf(
      PlanExpiredError,
    );
    spy.mockRestore();
  });

  it('bearerFetch still does the 401-refresh dance independently of 402', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const store = new TokenStore(db);
    await store.seedFromOAuth(mockOAuthResult());
    let calls = 0;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      // First call: 401 to trigger refresh; second call to /auth/refresh
      // returns the new tokens; third call (the retry) returns 200.
      if (calls === 1) return new Response('', { status: 401 });
      if (calls === 2) {
        return new Response(
          JSON.stringify({
            jwt: 'new.jwt.token',
            jwtExp: Math.floor(Date.now() / 1000) + 3600,
            refreshToken: 'new-rt',
            refreshTokenExp: Date.now() + 86400_000,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('ok', { status: 200 });
    });
    const res = await store.bearerFetch('https://example.test/userdb-foo/doc');
    expect(res.status).toBe(200);
    spy.mockRestore();
  });

  it('clear() removes identity doc and resets in-memory state', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const store = new TokenStore(db);
    await store.seedFromOAuth(mockOAuthResult());
    await store.clear();
    expect(store.hasIdentity()).toBe(false);
    const doc = await db.pouch.get(SERVER_IDENTITY_DOC_ID).catch(() => null);
    expect(doc).toBeNull();
  });
});
