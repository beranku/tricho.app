import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PinSetupScreen } from './PinSetupScreen';
import { setLocale } from '../i18n';

describe('PinSetupScreen — setup mode', () => {
  beforeEach(() => setLocale('en'));

  it('rejects submission when PINs do not match', async () => {
    const onSubmit = vi.fn();
    render(<PinSetupScreen mode="setup" onSubmit={onSubmit} />);
    const user = userEvent.setup();

    const inputs = screen.getAllByPlaceholderText(/PIN/i);
    await user.type(inputs[0], '1234');
    await user.type(inputs[1], '4321');
    await user.click(screen.getByRole('button', { name: /save pin/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);
  });

  it('rejects PINs that are too short', async () => {
    const onSubmit = vi.fn();
    render(<PinSetupScreen mode="setup" onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const inputs = screen.getAllByPlaceholderText(/PIN/i);
    await user.type(inputs[0], '1');
    await user.type(inputs[1], '1');
    await user.click(screen.getByRole('button', { name: /save pin/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/must be/i);
  });

  it('calls onSubmit with the PIN on a valid setup', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PinSetupScreen mode="setup" onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const inputs = screen.getAllByPlaceholderText(/PIN/i);
    await user.type(inputs[0], '123456');
    await user.type(inputs[1], '123456');
    await user.click(screen.getByRole('button', { name: /save pin/i }));
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });
});

describe('PinSetupScreen — unlock mode', () => {
  beforeEach(() => setLocale('en'));

  it('has only one PIN input (no confirm)', () => {
    render(<PinSetupScreen mode="unlock" onSubmit={vi.fn()} />);
    expect(screen.getAllByPlaceholderText(/PIN/i)).toHaveLength(1);
  });

  it('surfaces caller-supplied error text', () => {
    render(<PinSetupScreen mode="unlock" onSubmit={vi.fn()} error="Wrong PIN." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong PIN.');
  });

  it('cancel button shows up only when onCancel is passed', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<PinSetupScreen mode="unlock" onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    rerender(<PinSetupScreen mode="unlock" onSubmit={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });
});
