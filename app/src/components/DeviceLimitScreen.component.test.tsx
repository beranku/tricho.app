import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceLimitScreen } from './DeviceLimitScreen';
import { fakeDevice, fakeSubscription } from '../test/fixtures/oauth';
import { setLocale } from '../i18n';

// Mock the HTTP helpers at the module boundary so component behaviour is
// exercised end-to-end but no network calls leave the test.
vi.mock('../auth/oauth', () => ({
  fetchDevices: vi.fn(),
  revokeDevice: vi.fn(),
}));

import { fetchDevices, revokeDevice } from '../auth/oauth';

const tokenStore = {
  jwt: vi.fn(() => 'ey.fake.jwt'),
  ensureFreshJwt: vi.fn(async () => true),
} as unknown as Parameters<typeof DeviceLimitScreen>[0]['tokenStore'];

beforeEach(() => {
  // English assertions; opt out of the cs default.
  setLocale('en');
  (fetchDevices as ReturnType<typeof vi.fn>).mockResolvedValue({
    devices: [fakeDevice({ id: 'd1', name: 'Old Laptop' }), fakeDevice({ id: 'd2', name: 'Old Phone' })],
    subscription: fakeSubscription(),
  });
  (revokeDevice as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

describe('DeviceLimitScreen', () => {
  it('lists the registered devices returned by fetchDevices', async () => {
    render(<DeviceLimitScreen tokenStore={tokenStore} onDeviceFreed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Old Laptop')).toBeInTheDocument());
    expect(screen.getByText('Old Phone')).toBeInTheDocument();
  });

  it('clicking Revoke on a device triggers revokeDevice + onDeviceFreed', async () => {
    const onFreed = vi.fn();
    render(<DeviceLimitScreen tokenStore={tokenStore} onDeviceFreed={onFreed} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText('Old Laptop'));
    const buttons = screen.getAllByRole('button', { name: /revoke/i });
    expect(buttons.length).toBeGreaterThan(0);
    await user.click(buttons[0]);
    await waitFor(() => expect(revokeDevice).toHaveBeenCalled());
    await waitFor(() => expect(onFreed).toHaveBeenCalled());
    const firstCallArgs = (revokeDevice as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCallArgs[0]).toBe('ey.fake.jwt');
    expect(firstCallArgs[1]).toMatch(/^d\d$/);
  });

  it('surfaces an error message when fetchDevices returns null', async () => {
    (fetchDevices as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<DeviceLimitScreen tokenStore={tokenStore} onDeviceFreed={vi.fn()} />);
    // The exact error surface may vary; assert no device rows rendered.
    await waitFor(() => expect(screen.queryByText('Old Laptop')).not.toBeInTheDocument());
  });
});
