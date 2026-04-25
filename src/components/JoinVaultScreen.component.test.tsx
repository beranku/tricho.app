import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinVaultScreen } from './JoinVaultScreen';
import { setLocale } from '../i18n';

// A real, syntactically-valid 32-byte base32 RS would round-trip through
// generateRecoverySecret; we instead exercise parseRsInput's expectation
// (uppercase letters/digits, dashes ignored). 56 chars of A → valid.
const VALID_RS = 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA';

describe('JoinVaultScreen', () => {
  // This screen's assertions check English UI strings — opt the test locale
  // out of the cs default set in src/test/component-setup.ts.
  beforeEach(() => setLocale('en'));

  it('renders RS textarea + sign-out + unlock buttons', () => {
    render(<JoinVaultScreen onJoinVault={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByLabelText(/Recovery Secret/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
  });

  it('Unlock is disabled until the user types something', () => {
    render(<JoinVaultScreen onJoinVault={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByRole('button', { name: /unlock/i })).toBeDisabled();
  });

  it('rejects invalid RS format inline and does not call the handler', async () => {
    const onJoinVault = vi.fn();
    render(<JoinVaultScreen onJoinVault={onJoinVault} onSignOut={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Recovery Secret/i), 'not-an-rs');
    await user.click(screen.getByRole('button', { name: /unlock/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid Recovery Secret format/i);
    expect(onJoinVault).not.toHaveBeenCalled();
  });

  it('passes decoded bytes to onJoinVault on valid RS submit', async () => {
    const onJoinVault = vi.fn().mockResolvedValue(undefined);
    render(<JoinVaultScreen onJoinVault={onJoinVault} onSignOut={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Recovery Secret/i), VALID_RS);
    await user.click(screen.getByRole('button', { name: /unlock/i }));
    expect(onJoinVault).toHaveBeenCalledTimes(1);
    expect(onJoinVault.mock.calls[0]![0]).toBeInstanceOf(Uint8Array);
  });

  it('shows handler error and stays on the join screen', async () => {
    const onJoinVault = vi.fn().mockRejectedValue(new Error('bad RS for this vault'));
    render(<JoinVaultScreen onJoinVault={onJoinVault} onSignOut={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Recovery Secret/i), VALID_RS);
    await user.click(screen.getByRole('button', { name: /unlock/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/bad RS for this vault/);
    expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
  });

  it('clicking Sign out fires the sign-out handler', async () => {
    const onSignOut = vi.fn();
    render(<JoinVaultScreen onJoinVault={vi.fn()} onSignOut={onSignOut} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
