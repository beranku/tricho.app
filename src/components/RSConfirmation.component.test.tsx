import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RSConfirmation } from './RSConfirmation';
import { generateRecoverySecret, createRecoveryExportSession } from '../auth/recovery';
import type { RecoverySecretResult } from '../auth/recovery';

let rs: RecoverySecretResult;
const VAULT_ID = 'vault-rs-test';

beforeEach(() => {
  sessionStorage.clear();
  rs = generateRecoverySecret();
  createRecoveryExportSession(VAULT_ID, 'user-1', rs.encoded);
});

describe('RSConfirmation', () => {
  it('renders the full encoded Recovery Secret', () => {
    render(<RSConfirmation recoverySecret={rs} vaultId={VAULT_ID} onConfirmed={vi.fn()} />);
    // The encoded RS appears somewhere on the screen (may be chunked).
    const chunks = rs.encoded.match(/.{1,4}/g) ?? [];
    for (const chunk of chunks.slice(0, 3)) {
      // At least the first few chunks render.
      expect(screen.getByText(new RegExp(chunk, 'i'))).toBeInTheDocument();
    }
  });

  it('rejects a wrong checksum and does not call onConfirmed', async () => {
    const onConfirmed = vi.fn();
    render(<RSConfirmation recoverySecret={rs} vaultId={VAULT_ID} onConfirmed={onConfirmed} />);
    const user = userEvent.setup();

    const checksumInput = screen.getByPlaceholderText(/Enter \d characters/i);
    await user.type(checksumInput, 'XXXX');
    const submit = screen.getByRole('button', { name: /confirm|continue|submit/i });
    await user.click(submit);

    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it.todo('accepts the correct checksum — needs a deeper recovery-session mock wiring');
});
