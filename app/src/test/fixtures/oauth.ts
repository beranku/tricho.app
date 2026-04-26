/**
 * OAuthResult + subscription stubs for component tests.
 */

import type {
  OAuthResult,
  OAuthSubscription,
  OAuthDevice,
} from '../../auth/oauth';

export function fakeSubscription(
  overrides: Partial<OAuthSubscription> = {},
): OAuthSubscription {
  return {
    tier: 'free',
    plan: 'free',
    tierKey: 'free',
    billingPeriod: null,
    provider: null,
    status: 'active',
    entitlements: [],
    deviceLimit: 1,
    backupRetentionMonths: 0,
    gracePeriodSeconds: 7 * 86400,
    gracePeriodEndsAt: null,
    freeDeviceGrandfathered: false,
    storageLimitMB: 500,
    paidUntil: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

export function fakeDevice(overrides: Partial<OAuthDevice> = {}): OAuthDevice {
  return {
    id: 'device-fixture-1',
    name: 'Test Device',
    addedAt: Date.now() - 60_000,
    lastSeenAt: Date.now(),
    ...overrides,
  };
}

export function fakeOAuthResult(
  overrides: Partial<OAuthResult> = {},
): OAuthResult {
  return {
    ok: true,
    isNewUser: false,
    deviceApproved: true,
    hasRemoteVault: false,
    couchdbUsername: 'g_abcdef1234567890',
    email: 'fixture@tricho.test',
    name: 'Fixture User',
    picture: null,
    provider: 'google',
    deviceId: 'device-fixture-1',
    devices: [fakeDevice()],
    subscription: fakeSubscription(),
    tokens: {
      jwt: 'ey.fake.jwt',
      jwtExp: Date.now() / 1000 + 3600,
      refreshToken: 'ref-fixture',
      refreshTokenExp: Date.now() + 90 * 24 * 3600 * 1000,
    },
    ...overrides,
  };
}
