import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step3Encryption } from './Step3Encryption';
import { Step3VerifyInput } from './Step3VerifyInput';
import { FinalCard } from './FinalCard';
import {
  generateRecoverySecret,
  type RecoverySecretResult,
} from '../../auth/recovery';

describe('Step3VerifyInput', () => {
  it('accepts the correct last-4 and calls onConfirmed', async () => {
    const rs = generateRecoverySecret();
    const onConfirmed = vi.fn();
    render(<Step3VerifyInput expectedEncodedRs={rs.encoded} onConfirmed={onConfirmed} />);

    const user = userEvent.setup();
    const input = screen.getByTestId('wizard-last4-input');
    await user.type(input, rs.checksum);
    await user.click(screen.getByTestId('wizard-last4-submit'));
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it('rejects wrong last-4 with aria-invalid + amber border', async () => {
    const rs = generateRecoverySecret();
    const onConfirmed = vi.fn();
    render(<Step3VerifyInput expectedEncodedRs={rs.encoded} onConfirmed={onConfirmed} />);

    const user = userEvent.setup();
    const input = screen.getByTestId('wizard-last4-input');
    // Pick a guaranteed-wrong checksum: replace the first char with 'A'
    // (or 'B' if the original was 'A').
    const wrong =
      rs.checksum[0] === 'A'
        ? 'B' + rs.checksum.slice(1)
        : 'A' + rs.checksum.slice(1);
    await user.type(input, wrong);
    await user.click(screen.getByTestId('wizard-last4-submit'));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('filters non-Base32 characters live', async () => {
    const rs = generateRecoverySecret();
    render(<Step3VerifyInput expectedEncodedRs={rs.encoded} onConfirmed={vi.fn()} />);
    const user = userEvent.setup();
    const input = screen.getByTestId('wizard-last4-input') as HTMLInputElement;
    await user.type(input, '0!@1A2B');
    // 0, 1, !, @ are non-Base32. Allowed chars filtered to "AB" (max 4).
    expect(input.value).toBe('A2B');
  });

  it('caps at 4 characters', async () => {
    const rs = generateRecoverySecret();
    render(<Step3VerifyInput expectedEncodedRs={rs.encoded} onConfirmed={vi.fn()} />);
    const user = userEvent.setup();
    const input = screen.getByTestId('wizard-last4-input') as HTMLInputElement;
    await user.type(input, 'ABCDEFGH');
    expect(input.value).toHaveLength(4);
  });
});

describe('Step3Encryption — new flow', () => {
  let rs: RecoverySecretResult;
  beforeEach(() => {
    rs = generateRecoverySecret();
  });

  function renderNew(substep: 'qr' | 'verify' | 'webauthn', overrides: Partial<Parameters<typeof Step3Encryption>[0]> = {}) {
    const onAdvanceSubstep = vi.fn();
    const onCreateVault = vi.fn().mockResolvedValue({ vaultId: 'vault-x' });
    const onRegisterPasskey = vi.fn().mockResolvedValue({ prfSupported: true });
    const onCompleted = vi.fn();
    const setGeneratedRs = vi.fn();
    const result = render(
      <Step3Encryption
        flow="new"
        substep={substep}
        generatedRs={rs}
        setGeneratedRs={setGeneratedRs}
        onAdvanceSubstep={onAdvanceSubstep}
        onCreateVault={onCreateVault}
        onRegisterPasskey={onRegisterPasskey}
        onSetupPin={vi.fn().mockResolvedValue(undefined)}
        onAdvanceToPinSetup={vi.fn()}
        onJoinWithRs={vi.fn()}
        onCompleted={onCompleted}
        {...overrides}
      />,
    );
    return { ...result, onAdvanceSubstep, onCreateVault, onRegisterPasskey, onCompleted };
  }

  it('qr substep renders the caveat warning, fingerprint, download, and continue', () => {
    renderNew('qr');
    expect(screen.getByTestId('wizard-qr-caveat')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-fingerprint')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-download')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-continue')).toBeInTheDocument();
  });

  it('clicking "Mám uložený klíč" advances to verify substep', async () => {
    const { onAdvanceSubstep } = renderNew('qr');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('wizard-qr-continue'));
    expect(onAdvanceSubstep).toHaveBeenCalledWith('verify');
  });

  it('verify substep advances to webauthn on correct last-4', async () => {
    const { onAdvanceSubstep } = renderNew('verify');
    const user = userEvent.setup();
    await user.type(screen.getByTestId('wizard-last4-input'), rs.checksum);
    await user.click(screen.getByTestId('wizard-last4-submit'));
    expect(onAdvanceSubstep).toHaveBeenCalledWith('webauthn');
  });

  it('webauthn substep wires onCreateVault → onRegisterPasskey → onCompleted', async () => {
    const { onCreateVault, onRegisterPasskey, onCompleted } = renderNew('webauthn');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('wizard-webauthn-activate'));
    await waitFor(() => {
      expect(onCreateVault).toHaveBeenCalledOnce();
      expect(onRegisterPasskey).toHaveBeenCalledWith('vault-x');
      expect(onCompleted).toHaveBeenCalledOnce();
    });
  });

  it('webauthn surfaces an error when the passkey registration fails', async () => {
    const onRegisterPasskey = vi.fn().mockRejectedValue(new Error('webauthn aborted'));
    const onCompleted = vi.fn();
    renderNew('webauthn', { onRegisterPasskey, onCompleted });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('wizard-webauthn-activate'));
    await waitFor(() => {
      expect(onCompleted).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});

describe('Step3Encryption — existing flow', () => {
  function renderExisting(
    substep: 'qr' | 'verify' | 'webauthn',
    overrides: Partial<Parameters<typeof Step3Encryption>[0]> = {},
  ) {
    const onAdvanceSubstep = vi.fn();
    const onJoinWithRs = vi.fn().mockResolvedValue({ ok: true, vaultId: 'vault-y' });
    const onRegisterPasskey = vi.fn().mockResolvedValue({ prfSupported: true });
    const onCompleted = vi.fn();
    const setGeneratedRs = vi.fn();
    const result = render(
      <Step3Encryption
        flow="existing"
        substep={substep}
        generatedRs={null}
        setGeneratedRs={setGeneratedRs}
        onAdvanceSubstep={onAdvanceSubstep}
        onJoinWithRs={onJoinWithRs}
        onCreateVault={vi.fn()}
        onRegisterPasskey={onRegisterPasskey}
        onSetupPin={vi.fn().mockResolvedValue(undefined)}
        onAdvanceToPinSetup={vi.fn()}
        onCompleted={onCompleted}
        {...overrides}
      />,
    );
    return { ...result, onAdvanceSubstep, onJoinWithRs, onRegisterPasskey, onCompleted };
  }

  it('qr substep renders camera + gallery rows and a manual textarea', () => {
    renderExisting('qr');
    expect(screen.getByTestId('wizard-qr-camera-row')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-qr-gallery-row')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-existing-manual-input')).toBeInTheDocument();
  });

  it('manual submit with a valid full RS calls onJoinWithRs and advances to webauthn', async () => {
    const rs = generateRecoverySecret();
    const { onJoinWithRs, onAdvanceSubstep } = renderExisting('qr');
    const user = userEvent.setup();
    const input = screen.getByTestId('wizard-existing-manual-input');
    await user.click(input);
    await user.paste(rs.encoded);
    await user.click(screen.getByTestId('wizard-existing-manual-submit'));
    await waitFor(() => {
      expect(onJoinWithRs).toHaveBeenCalledOnce();
      expect(onAdvanceSubstep).toHaveBeenCalledWith('webauthn');
    });
  });

  it('manual submit with malformed RS shows an error and does NOT call onJoinWithRs', async () => {
    const { onJoinWithRs } = renderExisting('qr');
    const user = userEvent.setup();
    const input = screen.getByTestId('wizard-existing-manual-input');
    await user.click(input);
    await user.paste('NOT-A-VALID-KEY');
    await user.click(screen.getByTestId('wizard-existing-manual-submit'));
    expect(onJoinWithRs).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('manual submit with right format but wrong key shows wrong-key error', async () => {
    const rs = generateRecoverySecret();
    const onJoinWithRs = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'wrong-key' });
    const { onAdvanceSubstep } = renderExisting('qr', { onJoinWithRs });
    const user = userEvent.setup();
    const input = screen.getByTestId('wizard-existing-manual-input');
    await user.click(input);
    await user.paste(rs.encoded);
    await user.click(screen.getByTestId('wizard-existing-manual-submit'));
    await waitFor(() => {
      expect(onAdvanceSubstep).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('webauthn substep renders the success copy and activate CTA', () => {
    renderExisting('webauthn');
    expect(screen.getByText(/Klíč rozpoznán/)).toBeInTheDocument();
    expect(screen.getByTestId('wizard-webauthn-activate')).toBeInTheDocument();
  });
});

describe('Step3Encryption — restore-zip flow', () => {
  function renderRestoreZip(
    substep: 'pick-zip' | 'verify-rs' | 'webauthn',
    overrides: Partial<Parameters<typeof Step3Encryption>[0]> = {},
  ) {
    const onAdvanceSubstep = vi.fn();
    const onRestoreFromZip = vi.fn();
    const onRegisterPasskey = vi.fn().mockResolvedValue({ prfSupported: true });
    const onCompleted = vi.fn();
    const result = render(
      <Step3Encryption
        flow="restore-zip"
        substep={substep}
        generatedRs={null}
        setGeneratedRs={vi.fn()}
        onAdvanceSubstep={onAdvanceSubstep}
        onJoinWithRs={vi.fn()}
        onCreateVault={vi.fn()}
        onRegisterPasskey={onRegisterPasskey}
        onSetupPin={vi.fn().mockResolvedValue(undefined)}
        onAdvanceToPinSetup={vi.fn()}
        onRestoreFromZip={onRestoreFromZip}
        onCompleted={onCompleted}
        {...overrides}
      />,
    );
    return { ...result, onAdvanceSubstep, onRestoreFromZip, onRegisterPasskey, onCompleted };
  }

  it('pick-zip substep renders file input with hint when no files chosen', () => {
    renderRestoreZip('pick-zip');
    expect(screen.getByTestId('wizard-restore-pick-zip')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-restore-pick-input')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-restore-pick-hint')).toBeInTheDocument();
    const continueBtn = screen.getByTestId('wizard-restore-pick-continue') as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);
  });

  it('verify-rs substep renders RS textarea + submit', () => {
    renderRestoreZip('verify-rs');
    expect(screen.getByTestId('wizard-restore-verify-rs')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-restore-verify-input')).toBeInTheDocument();
  });
});

describe('FinalCard', () => {
  it('renders welcome copy + CTA, fires onOpenApp', async () => {
    const onOpenApp = vi.fn();
    render(<FinalCard onOpenApp={onOpenApp} />);
    expect(screen.getByText(/Vítej v zápisníku/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('wizard-final-cta'));
    expect(onOpenApp).toHaveBeenCalledOnce();
  });
});
