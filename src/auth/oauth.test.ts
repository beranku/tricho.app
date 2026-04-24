import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_COMPLETE_HASH,
  clearAuthCompleteHash,
  consumePendingOAuthResult,
  fetchDevices,
  getAuthOrigin,
  logout,
  refreshTokens,
  revokeDevice,
  startProviderLogin,
} from './oauth';
import { fakeOAuthResult } from '../test/fixtures/oauth';

const SESSION_KEY = 'tricho-oauth-result';

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAuthOrigin', () => {
  it('returns the configured proxy URL', () => {
    expect(getAuthOrigin()).toMatch(/^https?:\/\/|^\//);
  });
});

describe('startProviderLogin', () => {
  // jsdom marks window.location.assign as non-configurable, so swap the
  // whole location object via Object.defineProperty for the duration of
  // the test.
  function withStubbedLocation<T>(fn: (spy: ReturnType<typeof vi.fn>) => T): T {
    const spy = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign: spy, replace: spy, href: original.href },
    });
    try {
      return fn(spy);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      });
    }
  }

  it('navigates to /auth/<provider>/start', () => {
    withStubbedLocation((spy) => {
      startProviderLogin('google');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('/auth/google/start');
    });
  });

  it('supports apple provider too', () => {
    withStubbedLocation((spy) => {
      startProviderLogin('apple');
      expect(spy.mock.calls[0][0]).toContain('/auth/apple/start');
    });
  });
});

describe('consumePendingOAuthResult', () => {
  it('returns null when no result is pending', () => {
    expect(consumePendingOAuthResult()).toBeNull();
  });

  it('returns the stashed result and removes it on consume', () => {
    const payload = fakeOAuthResult({ email: 'consume@tricho.test' });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));

    const result = consumePendingOAuthResult();
    expect(result?.email).toBe('consume@tricho.test');
    // Idempotent: second call returns null.
    expect(consumePendingOAuthResult()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('returns null on malformed JSON without throwing', () => {
    sessionStorage.setItem(SESSION_KEY, '}{not-json');
    expect(() => consumePendingOAuthResult()).not.toThrow();
    expect(consumePendingOAuthResult()).toBeNull();
  });
});

describe('clearAuthCompleteHash', () => {
  it('removes the hash when it matches', () => {
    window.history.replaceState(null, '', `/${AUTH_COMPLETE_HASH}`);
    expect(window.location.hash).toBe(AUTH_COMPLETE_HASH);
    clearAuthCompleteHash();
    expect(window.location.hash).toBe('');
  });

  it('leaves unrelated hashes alone', () => {
    window.history.replaceState(null, '', '/#somewhere-else');
    clearAuthCompleteHash();
    expect(window.location.hash).toBe('#somewhere-else');
  });
});

describe('HTTP helpers (logout, refreshTokens, fetchDevices, revokeDevice)', () => {
  function stubFetch(response: Partial<Response> & { ok: boolean; json?: () => Promise<unknown> }): ReturnType<typeof vi.fn> {
    const spy = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.ok ? 200 : 401,
      json: response.json ?? (() => Promise.resolve({})),
    });
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('logout POSTs /auth/logout with refreshToken; errors are swallowed', async () => {
    const spy = stubFetch({ ok: true });
    await logout('ref-xyz');
    const [, init] = spy.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body).refreshToken).toBe('ref-xyz');
  });

  it('logout swallows network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(logout('ref-xyz')).resolves.toBeUndefined();
  });

  it('refreshTokens returns the JSON body on 200', async () => {
    const body = { jwt: 'ey.new.jwt', jwtExp: 42, refreshToken: 'ref-2', refreshTokenExp: 99 };
    stubFetch({ ok: true, json: async () => body });
    await expect(refreshTokens('ref-1', 'dev-a')).resolves.toEqual(body);
  });

  it('refreshTokens returns null on non-OK response', async () => {
    stubFetch({ ok: false });
    await expect(refreshTokens('ref-1', 'dev-a')).resolves.toBeNull();
  });

  it('refreshTokens returns null on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(refreshTokens('ref-1', 'dev-a')).resolves.toBeNull();
  });

  it('fetchDevices sends Authorization Bearer and returns JSON', async () => {
    const body = { devices: [], subscription: null };
    const spy = stubFetch({ ok: true, json: async () => body });
    await expect(fetchDevices('ey.jwt')).resolves.toEqual(body);
    expect(spy.mock.calls[0][1].headers.authorization).toBe('Bearer ey.jwt');
  });

  it('revokeDevice encodes the deviceId in the path and reports boolean', async () => {
    const spy = stubFetch({ ok: true });
    await expect(revokeDevice('ey.jwt', 'dev space/slash')).resolves.toBe(true);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('/auth/devices/dev%20space%2Fslash');
    expect(spy.mock.calls[0][1].method).toBe('DELETE');
  });

  it('revokeDevice returns false on failure', async () => {
    stubFetch({ ok: false });
    await expect(revokeDevice('ey.jwt', 'dev-1')).resolves.toBe(false);
  });
});
