/**
 * Client-side helpers for the OAuth identity flow.
 *
 * The OAuth dance is server-driven: the PWA redirects to /auth/<provider>/start,
 * the provider redirects back to /auth/<provider>/callback, and the server's
 * callback renders HTML that stores the result in sessionStorage + redirects
 * back to the PWA with a hash marker. This module exposes small helpers for
 * kicking off the redirects and reading the result on re-entry.
 */

const AUTH_ORIGIN = (import.meta.env?.VITE_AUTH_PROXY_URL as string | undefined) ?? 'http://localhost:4545';
const SESSION_STORAGE_KEY = 'tricho-oauth-result';
export const AUTH_COMPLETE_HASH = '#tricho-auth-complete';

export type OAuthProvider = 'google' | 'apple';

export interface OAuthDevice {
  id: string;
  name: string;
  addedAt: number;
  lastSeenAt: number;
}

export interface OAuthSubscription {
  tier: 'free' | 'paid';
  deviceLimit: number;
  storageLimitMB: number;
  paidUntil: number | null;
}

export interface OAuthResult {
  ok: boolean;
  isNewUser: boolean;
  deviceApproved: boolean;
  hasRemoteVault: boolean;
  couchdbUsername: string;
  email: string;
  name: string | null;
  picture: string | null;
  provider: OAuthProvider;
  deviceId: string;
  devices: OAuthDevice[];
  subscription: OAuthSubscription | null;
  tokens: {
    jwt: string;
    jwtExp: number;
    refreshToken: string;
    refreshTokenExp: number;
  } | null;
}

export function getAuthOrigin(): string {
  return AUTH_ORIGIN;
}

export function startProviderLogin(provider: OAuthProvider): void {
  window.location.assign(`${AUTH_ORIGIN}/auth/${provider}/start`);
}

/**
 * Reads the result the callback HTML stashed in sessionStorage. Returns null
 * if no pending OAuth completion is present. Idempotent: calling it twice
 * gives null on the second call.
 */
export function consumePendingOAuthResult(): OAuthResult | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return JSON.parse(raw) as OAuthResult;
  } catch {
    return null;
  }
}

/**
 * If the current URL carries the auth-complete hash, remove it — call this
 * right after reading the pending result so the hash doesn't linger in
 * browser history.
 */
export function clearAuthCompleteHash(): void {
  if (window.location.hash === AUTH_COMPLETE_HASH) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export async function logout(refreshToken?: string): Promise<void> {
  await fetch(`${AUTH_ORIGIN}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshToken ?? null }),
  }).catch(() => void 0);
}

export async function refreshTokens(refreshToken: string, deviceId: string): Promise<{
  jwt: string;
  jwtExp: number;
  refreshToken: string;
  refreshTokenExp: number;
} | null> {
  const res = await fetch(`${AUTH_ORIGIN}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken, deviceId }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json();
}

export interface DeviceListEntry {
  id: string;
  name: string;
  addedAt: number;
  lastSeenAt: number;
}

export interface DeviceListResponse {
  devices: DeviceListEntry[];
  subscription: OAuthSubscription | null;
}

export async function fetchDevices(jwt: string): Promise<DeviceListResponse | null> {
  const res = await fetch(`${AUTH_ORIGIN}/auth/devices`, {
    headers: { authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json();
}

export async function revokeDevice(jwt: string, deviceId: string): Promise<boolean> {
  const res = await fetch(`${AUTH_ORIGIN}/auth/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  return Boolean(res && res.ok);
}
