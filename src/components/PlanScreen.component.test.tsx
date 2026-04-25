import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanScreen } from './PlanScreen';
import { setLocale } from '../i18n';
import { setSubscriptionForTests } from '../lib/store/subscription';
import { fakeSubscription } from '../test/fixtures/oauth';

const tokenStore = {
  jwt: vi.fn(() => 'ey.fake.jwt'),
  ensureFreshJwt: vi.fn(async () => true),
} as unknown as Parameters<typeof PlanScreen>[0]['tokenStore'];

beforeEach(() => {
  setLocale('en');
  setSubscriptionForTests(null);
});

describe('PlanScreen', () => {
  it('free user shows Free tier and Upgrade CTA', () => {
    setSubscriptionForTests(fakeSubscription({ tier: 'free', tierKey: 'free' }));
    render(<PlanScreen tokenStore={tokenStore} onBack={() => undefined} />);
    expect(screen.getByText(/Tricho — Local/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upgrade to Sync/i })).toBeInTheDocument();
  });

  it('pro-monthly active shows tier label, retention, days remaining', () => {
    const now = Date.now();
    setSubscriptionForTests(
      fakeSubscription({
        tier: 'paid',
        plan: 'pro-monthly',
        tierKey: 'pro',
        billingPeriod: 'month',
        provider: 'stripe',
        entitlements: ['sync', 'backup'],
        deviceLimit: 2,
        backupRetentionMonths: 12,
        paidUntil: now + 12 * 86400 * 1000,
        gracePeriodEndsAt: now + 19 * 86400 * 1000,
      }),
    );
    render(<PlanScreen tokenStore={tokenStore} onBack={() => undefined} />);
    expect(screen.getByText(/Pro · Monthly/i)).toBeInTheDocument();
    expect(screen.getByText(/12 days remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/Backup history: 12/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage subscription/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel plan/i })).toBeInTheDocument();
  });

  it('max-yearly canceled state shows reactivate-friendly state', () => {
    const now = Date.now();
    setSubscriptionForTests(
      fakeSubscription({
        tier: 'paid',
        plan: 'max-yearly',
        tierKey: 'max',
        billingPeriod: 'year',
        provider: 'stripe',
        status: 'canceled',
        entitlements: ['sync', 'backup'],
        deviceLimit: 5,
        backupRetentionMonths: 60,
        paidUntil: now + 30 * 86400 * 1000,
      }),
    );
    render(<PlanScreen tokenStore={tokenStore} onBack={() => undefined} />);
    expect(screen.getByText(/Canceled/i)).toBeInTheDocument();
  });

  it('bank-transfer paid user shows Pay-for-next-period instead of Manage subscription', () => {
    const now = Date.now();
    setSubscriptionForTests(
      fakeSubscription({
        tier: 'paid',
        plan: 'pro-yearly',
        tierKey: 'pro',
        billingPeriod: 'year',
        provider: 'bank-transfer',
        entitlements: ['sync', 'backup'],
        deviceLimit: 2,
        backupRetentionMonths: 12,
        paidUntil: now + 60 * 86400 * 1000,
      }),
    );
    render(<PlanScreen tokenStore={tokenStore} onBack={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Manage subscription/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Pay for next period/i })).toBeInTheDocument();
  });

  it('exposes the local-backup CTA when onOpenBackupExport is provided', () => {
    setSubscriptionForTests(fakeSubscription({ tier: 'free', tierKey: 'free' }));
    const onOpen = vi.fn();
    render(<PlanScreen tokenStore={tokenStore} onBack={() => undefined} onOpenBackupExport={onOpen} />);
    expect(screen.getByRole('button', { name: /Download local backup/i })).toBeInTheDocument();
  });
});
