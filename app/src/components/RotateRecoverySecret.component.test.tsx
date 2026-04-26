import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RotateRecoverySecret } from './RotateRecoverySecret';

const onCommit = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  onCommit.mockReset();
  onClose.mockReset();
});

describe('RotateRecoverySecret — qr substep', () => {
  it('renders QR canvas + fingerprint + download', () => {
    onCommit.mockResolvedValue({ ct: 'x', iv: 'y', version: 1 });
    render(<RotateRecoverySecret onCommit={onCommit} onClose={onClose} />);
    expect(screen.getByTestId('rotate-rs')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-fingerprint')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-download')).toBeInTheDocument();
  });

  it('cancel button on qr substep does NOT commit', async () => {
    const user = userEvent.setup();
    onCommit.mockResolvedValue({ ct: 'x', iv: 'y', version: 1 });
    render(<RotateRecoverySecret onCommit={onCommit} onClose={onClose} />);
    await user.click(screen.getByTestId('rotate-rs-cancel'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('RotateRecoverySecret — verify substep', () => {
  it('mismatched checksum keeps state and does NOT commit', async () => {
    const user = userEvent.setup();
    onCommit.mockResolvedValue({ ct: 'x', iv: 'y', version: 1 });
    render(<RotateRecoverySecret onCommit={onCommit} onClose={onClose} />);
    await user.click(screen.getByTestId('wizard-qr-continue'));
    // Now on verify
    expect(screen.getByTestId('wizard-last4-input')).toBeInTheDocument();
    await user.type(screen.getByTestId('wizard-last4-input'), 'AAAA');
    await user.click(screen.getByTestId('wizard-last4-submit'));
    expect(onCommit).not.toHaveBeenCalled();
    // Warning copy is visible (at least one element contains it).
    expect(
      screen.getAllByText(/přestane fungovat|will stop working/i).length,
    ).toBeGreaterThan(0);
  });

  it('cancel button on verify substep does NOT commit', async () => {
    const user = userEvent.setup();
    onCommit.mockResolvedValue({ ct: 'x', iv: 'y', version: 1 });
    render(<RotateRecoverySecret onCommit={onCommit} onClose={onClose} />);
    await user.click(screen.getByTestId('wizard-qr-continue'));
    await user.click(screen.getByTestId('rotate-rs-cancel'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('RotateRecoverySecret — commit success', () => {
  it('renders success surface after correct checksum + commit succeeds', async () => {
    const user = userEvent.setup();
    onCommit.mockResolvedValue({ ct: 'x', iv: 'y', version: 1 });
    render(<RotateRecoverySecret onCommit={onCommit} onClose={onClose} />);
    // Read the fingerprint last-4 to type on the verify substep
    // Read the fingerprint last-4 BEFORE advancing — it's only on qr substep.
    const fingerprint = screen.getByTestId('wizard-qr-fingerprint');
    const last4 = (fingerprint.querySelector('.qr-fingerprint__last4') as HTMLElement)
      .textContent?.trim();
    await user.click(screen.getByTestId('wizard-qr-continue'));
    expect(last4).toMatch(/^[A-Z2-7]{4}$/);
    await user.type(screen.getByTestId('wizard-last4-input'), last4!);
    await user.click(screen.getByTestId('wizard-last4-submit'));
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledOnce();
      expect(screen.getByTestId('rotate-rs-success')).toBeInTheDocument();
    });
  });

  it('shows error and stays on verify when commit throws', async () => {
    const user = userEvent.setup();
    onCommit.mockRejectedValue(new Error('disk full'));
    render(<RotateRecoverySecret onCommit={onCommit} onClose={onClose} />);
    // Read the fingerprint last-4 BEFORE advancing — it's only on qr substep.
    const fingerprint = screen.getByTestId('wizard-qr-fingerprint');
    const last4 = (fingerprint.querySelector('.qr-fingerprint__last4') as HTMLElement)
      .textContent?.trim();
    await user.click(screen.getByTestId('wizard-qr-continue'));
    await user.type(screen.getByTestId('wizard-last4-input'), last4!);
    await user.click(screen.getByTestId('wizard-last4-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      // Still on verify (success surface not rendered)
      expect(screen.queryByTestId('rotate-rs-success')).not.toBeInTheDocument();
    });
  });
});
