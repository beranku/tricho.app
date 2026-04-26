import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../auth/webauthn', () => ({
  isWebAuthnAvailable: () => true,
}));

import { LockedScreen, type LockedScreenProps } from './LockedScreen';

function renderLocked(overrides: Partial<LockedScreenProps> = {}) {
  const props: LockedScreenProps = {
    hasPasskey: true,
    hasPin: false,
    onUnlockWithPasskey: vi.fn().mockResolvedValue(undefined),
    onUnlockWithPin: vi.fn().mockResolvedValue(undefined),
    onUnlockWithRs: vi.fn().mockResolvedValue(undefined),
    onUnlocked: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<LockedScreen {...props} />) };
}

describe('LockedScreen — primary path selection', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders passkey CTA when hasPasskey=true', () => {
    renderLocked({ hasPasskey: true, hasPin: false });
    expect(screen.getByTestId('locked-passkey-cta')).toBeInTheDocument();
    expect(screen.queryByTestId('locked-pin-input')).not.toBeInTheDocument();
  });

  it('renders PIN input when hasPasskey=false but hasPin=true', () => {
    renderLocked({ hasPasskey: false, hasPin: true });
    expect(screen.queryByTestId('locked-passkey-cta')).not.toBeInTheDocument();
    expect(screen.getByTestId('locked-pin-input')).toBeInTheDocument();
  });

  it('renders RS as the only path when neither passkey nor PIN is available', () => {
    renderLocked({ hasPasskey: false, hasPin: false });
    expect(screen.queryByTestId('locked-passkey-cta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('locked-pin-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('locked-rs-input')).toBeInTheDocument();
  });

  it('always shows the RS fallback link from passkey path', () => {
    renderLocked({ hasPasskey: true, hasPin: false });
    expect(screen.getByTestId('locked-show-rs')).toBeInTheDocument();
  });
});

describe('LockedScreen — passkey unlock', () => {
  beforeEach(() => sessionStorage.clear());

  it('triggers onUnlockWithPasskey then onUnlocked on success', async () => {
    const user = userEvent.setup();
    const onUnlockWithPasskey = vi.fn().mockResolvedValue(undefined);
    const onUnlocked = vi.fn();
    renderLocked({ onUnlockWithPasskey, onUnlocked });
    await user.click(screen.getByTestId('locked-passkey-cta'));
    expect(onUnlockWithPasskey).toHaveBeenCalledTimes(1);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('shows humanised error on passkey failure and does not call onUnlocked', async () => {
    const user = userEvent.setup();
    const onUnlockWithPasskey = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const onUnlocked = vi.fn();
    renderLocked({ onUnlockWithPasskey, onUnlocked });
    await user.click(screen.getByTestId('locked-passkey-cta'));
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('LockedScreen — PIN unlock and lockout', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('preserves input on wrong PIN', async () => {
    const user = userEvent.setup();
    const onUnlockWithPin = vi.fn().mockRejectedValue(new Error('wrong'));
    renderLocked({ hasPasskey: false, hasPin: true, onUnlockWithPin });
    const input = screen.getByTestId('locked-pin-input') as HTMLInputElement;
    await user.type(input, '123456');
    await user.click(screen.getByTestId('locked-pin-submit'));
    expect(input.value).toBe('123456');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('locks input after 5 wrong PINs in the same window', async () => {
    const user = userEvent.setup();
    const onUnlockWithPin = vi.fn().mockRejectedValue(new Error('wrong'));
    renderLocked({ hasPasskey: false, hasPin: true, onUnlockWithPin });
    const submit = screen.getByTestId('locked-pin-submit');
    const input = screen.getByTestId('locked-pin-input') as HTMLInputElement;

    for (let i = 0; i < 5; i++) {
      await user.clear(input);
      await user.type(input, '111111');
      await user.click(submit);
    }
    expect(screen.getByTestId('locked-pin-lockout')).toBeInTheDocument();
    // Input becomes disabled
    expect((screen.getByTestId('locked-pin-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('lockout state persists across remount', async () => {
    const user = userEvent.setup();
    const onUnlockWithPin = vi.fn().mockRejectedValue(new Error('wrong'));
    const { unmount } = renderLocked({ hasPasskey: false, hasPin: true, onUnlockWithPin });
    const input = screen.getByTestId('locked-pin-input') as HTMLInputElement;
    const submit = screen.getByTestId('locked-pin-submit');

    for (let i = 0; i < 5; i++) {
      await user.clear(input);
      await user.type(input, '111111');
      await user.click(submit);
    }
    unmount();
    renderLocked({ hasPasskey: false, hasPin: true, onUnlockWithPin });
    expect(screen.getByTestId('locked-pin-lockout')).toBeInTheDocument();
  });

  it('still allows RS unlock during PIN lockout', async () => {
    const user = userEvent.setup();
    const onUnlockWithPin = vi.fn().mockRejectedValue(new Error('wrong'));
    renderLocked({ hasPasskey: false, hasPin: true, onUnlockWithPin });
    const input = screen.getByTestId('locked-pin-input') as HTMLInputElement;
    const submit = screen.getByTestId('locked-pin-submit');
    for (let i = 0; i < 5; i++) {
      await user.clear(input);
      await user.type(input, '111111');
      await user.click(submit);
    }
    // RS link is still active
    const rsLink = screen.getByTestId('locked-show-rs-from-pin');
    await user.click(rsLink);
    expect(screen.getByTestId('locked-rs-input')).toBeInTheDocument();
  });
});

describe('LockedScreen — switching paths', () => {
  beforeEach(() => sessionStorage.clear());

  it('switches from passkey to RS via fallback link', async () => {
    const user = userEvent.setup();
    renderLocked({ hasPasskey: true, hasPin: false });
    await user.click(screen.getByTestId('locked-show-rs'));
    expect(screen.getByTestId('locked-rs-input')).toBeInTheDocument();
  });

  it('switches from PIN to RS via fallback link', async () => {
    const user = userEvent.setup();
    renderLocked({ hasPasskey: false, hasPin: true });
    await user.click(screen.getByTestId('locked-show-rs-from-pin'));
    expect(screen.getByTestId('locked-rs-input')).toBeInTheDocument();
  });
});
