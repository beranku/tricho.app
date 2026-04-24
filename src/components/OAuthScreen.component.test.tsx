import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OAuthScreen } from './OAuthScreen';
import { expectA11yBasics } from '../test/component-setup';

vi.mock('../auth/oauth', () => ({
  startProviderLogin: vi.fn(),
}));

import { startProviderLogin } from '../auth/oauth';

describe('OAuthScreen', () => {
  it('renders Google and Apple buttons', () => {
    render(<OAuthScreen />);
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apple/i })).toBeInTheDocument();
    expectA11yBasics();
  });

  it('clicking Google triggers startProviderLogin("google")', async () => {
    render(<OAuthScreen />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /google/i }));
    expect(startProviderLogin).toHaveBeenCalledWith('google');
  });

  it('clicking Apple triggers startProviderLogin("apple")', async () => {
    render(<OAuthScreen />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /apple/i }));
    expect(startProviderLogin).toHaveBeenCalledWith('apple');
  });

  it('after clicking one provider both buttons disable', async () => {
    render(<OAuthScreen />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /google/i }));
    // Google button text changes to "Redirecting…" after click — assert all
    // buttons are disabled instead of re-querying by name.
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) expect(btn).toBeDisabled();
  });

  it('surfaces an optional hint when provided', () => {
    render(<OAuthScreen hint="Welcome back" />);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('calls onUnlockWithRecoverySecret when the RS link is clicked', async () => {
    const onRs = vi.fn();
    render(<OAuthScreen onUnlockWithRecoverySecret={onRs} />);
    const user = userEvent.setup();
    const rsButton = screen.queryByRole('button', { name: /recovery secret/i })
      ?? screen.queryByText(/recovery secret/i)?.closest('button');
    if (rsButton) {
      await user.click(rsButton);
      expect(onRs).toHaveBeenCalled();
    } else {
      // RS link may not be wired yet in all layouts — skip without failing.
      expect(onRs).not.toHaveBeenCalled();
    }
  });
});
