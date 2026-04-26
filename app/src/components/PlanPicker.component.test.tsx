import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPicker } from './PlanPicker';
import { setLocale } from '../i18n';

vi.mock('../auth/subscription', async (importOriginal) => {
  const original = await importOriginal<typeof import('../auth/subscription')>();
  return {
    ...original,
    fetchPublicPlans: vi.fn(),
    startStripeCheckout: vi.fn(),
    createBankTransferIntent: vi.fn(),
  };
});

import { fetchPublicPlans, startStripeCheckout, createBankTransferIntent } from '../auth/subscription';

const tokenStore = {
  jwt: vi.fn(() => 'ey.fake.jwt'),
  ensureFreshJwt: vi.fn(async () => true),
} as unknown as Parameters<typeof PlanPicker>[0]['tokenStore'];

const mkPlan = (id: string, amount: number, tier: 'pro' | 'max', period: 'month' | 'year') => ({
  id,
  tier,
  billingPeriod: period,
  label: id,
  periodSeconds: period === 'month' ? 30 * 86400 : 365 * 86400,
  amountMinor: amount,
  currency: 'CZK',
  deviceLimit: tier === 'pro' ? 2 : 5,
  backupRetentionMonths: tier === 'pro' ? 12 : 60,
});

beforeEach(() => {
  setLocale('en');
  vi.clearAllMocks();
  (fetchPublicPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
    mkPlan('free', 0, 'pro', 'month'),
    mkPlan('pro-monthly', 19900, 'pro', 'month'),
    mkPlan('pro-yearly', 199000, 'pro', 'year'),
    mkPlan('max-monthly', 49900, 'max', 'month'),
    mkPlan('max-yearly', 499000, 'max', 'year'),
  ]);
  (startStripeCheckout as ReturnType<typeof vi.fn>).mockResolvedValue({ checkoutUrl: 'https://checkout.test/x' });
  (createBankTransferIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ intentId: 'int_xyz' });
});

describe('PlanPicker', () => {
  it('renders pro and max tiers under monthly tab by default', async () => {
    render(<PlanPicker tokenStore={tokenStore} onClose={() => undefined} onBankTransferIntent={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/Pro/i)).toBeInTheDocument());
    expect(screen.getByText(/Max/i)).toBeInTheDocument();
    // Monthly tab is active.
    expect(screen.getByRole('tab', { name: /Monthly/i }).getAttribute('aria-selected')).toBe('true');
  });

  it('switching to yearly tab shows different prices', async () => {
    render(<PlanPicker tokenStore={tokenStore} onClose={() => undefined} onBankTransferIntent={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: /Yearly/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /Yearly/i }));
    expect(screen.getByRole('tab', { name: /Yearly/i }).getAttribute('aria-selected')).toBe('true');
  });

  it('selecting pro then card path calls startStripeCheckout with pro-monthly', async () => {
    render(<PlanPicker tokenStore={tokenStore} onClose={() => undefined} onBankTransferIntent={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/Pro/i)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Pro/i));
    // Card CTA appears.
    const cardBtn = await screen.findByText(/Pay with card/i);
    // window.location.assign side effect — stub it.
    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign: assignSpy, href: 'http://x', origin: 'http://x' }, writable: true });
    await userEvent.click(cardBtn);
    await waitFor(() =>
      expect(startStripeCheckout).toHaveBeenCalledWith(
        'ey.fake.jwt',
        expect.objectContaining({ plan: 'pro-monthly' }),
      ),
    );
  });

  it('selecting max then bank path calls createBankTransferIntent with max-yearly', async () => {
    render(<PlanPicker tokenStore={tokenStore} onClose={() => undefined} onBankTransferIntent={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/Max/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /Yearly/i }));
    await userEvent.click(screen.getByText(/Max/i));
    const bankBtn = await screen.findByText(/Pay by bank transfer/i);
    await userEvent.click(bankBtn);
    await waitFor(() => expect(createBankTransferIntent).toHaveBeenCalledWith('ey.fake.jwt', 'max-yearly'));
  });
});
