import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../auth/oauth', async (orig) => {
  const actual = await orig<typeof import('../auth/oauth')>();
  return {
    ...actual,
    deleteAccount: vi.fn(),
  };
});

import { DeleteAccountModal } from './DeleteAccountModal';
import { deleteAccount } from '../auth/oauth';

function makeTokenStore(overrides: Partial<{ ensureFreshJwt: () => Promise<boolean>; jwt: () => string | null }> = {}) {
  return {
    ensureFreshJwt: overrides.ensureFreshJwt ?? vi.fn().mockResolvedValue(true),
    jwt: overrides.jwt ?? vi.fn().mockReturnValue('jwt-x'),
  } as never;
}

beforeEach(() => {
  (deleteAccount as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('DeleteAccountModal — typed gate', () => {
  it('confirm button is disabled until SMAZAT is typed exactly', async () => {
    const user = userEvent.setup();
    const tokenStore = makeTokenStore();
    render(
      <DeleteAccountModal
        tokenStore={tokenStore}
        onCanceled={vi.fn()}
        onDeleted={vi.fn().mockResolvedValue(undefined)}
        onNeedsReauth={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId('delete-account-confirm') as HTMLButtonElement;
    const input = screen.getByTestId('delete-account-typed-input') as HTMLInputElement;
    expect(confirm.disabled).toBe(true);

    // Lowercase doesn't match
    await user.type(input, 'smazat');
    expect(confirm.disabled).toBe(true);

    // Wrong case doesn't match
    await user.clear(input);
    await user.type(input, 'Smazat');
    expect(confirm.disabled).toBe(true);

    // Exact match enables it
    await user.clear(input);
    await user.type(input, 'SMAZAT');
    expect(confirm.disabled).toBe(false);
  });

  it('typed lowercase does NOT trigger deleteAccount', async () => {
    const user = userEvent.setup();
    const tokenStore = makeTokenStore();
    const onDeleted = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteAccountModal
        tokenStore={tokenStore}
        onCanceled={vi.fn()}
        onDeleted={onDeleted}
        onNeedsReauth={vi.fn()}
      />,
    );
    const input = screen.getByTestId('delete-account-typed-input') as HTMLInputElement;
    await user.type(input, 'smazat');
    await user.click(screen.getByTestId('delete-account-confirm'));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('DeleteAccountModal — happy path', () => {
  it('typed SMAZAT + server ok calls onDeleted', async () => {
    const user = userEvent.setup();
    const tokenStore = makeTokenStore();
    const onDeleted = vi.fn().mockResolvedValue(undefined);
    (deleteAccount as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    render(
      <DeleteAccountModal
        tokenStore={tokenStore}
        onCanceled={vi.fn()}
        onDeleted={onDeleted}
        onNeedsReauth={vi.fn()}
      />,
    );
    const input = screen.getByTestId('delete-account-typed-input') as HTMLInputElement;
    await user.type(input, 'SMAZAT');
    await user.click(screen.getByTestId('delete-account-confirm'));
    await waitFor(() => {
      expect(deleteAccount).toHaveBeenCalledWith('jwt-x');
      expect(onDeleted).toHaveBeenCalledOnce();
    });
  });
});

describe('DeleteAccountModal — server failure preserves local state', () => {
  it('server_error keeps modal open with alert; onDeleted is NOT called', async () => {
    const user = userEvent.setup();
    const tokenStore = makeTokenStore();
    const onDeleted = vi.fn();
    (deleteAccount as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'server_error',
    });
    render(
      <DeleteAccountModal
        tokenStore={tokenStore}
        onCanceled={vi.fn()}
        onDeleted={onDeleted}
        onNeedsReauth={vi.fn()}
      />,
    );
    const input = screen.getByTestId('delete-account-typed-input') as HTMLInputElement;
    await user.type(input, 'SMAZAT');
    await user.click(screen.getByTestId('delete-account-confirm'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(onDeleted).not.toHaveBeenCalled();
    });
    // Modal still open
    expect(screen.getByTestId('delete-account-modal')).toBeInTheDocument();
  });
});

describe('DeleteAccountModal — stale JWT triggers re-auth', () => {
  it('ensureFreshJwt false → onNeedsReauth, no deleteAccount call', async () => {
    const user = userEvent.setup();
    const tokenStore = makeTokenStore({
      ensureFreshJwt: vi.fn().mockResolvedValue(false),
    });
    const onDeleted = vi.fn();
    const onNeedsReauth = vi.fn();
    render(
      <DeleteAccountModal
        tokenStore={tokenStore}
        onCanceled={vi.fn()}
        onDeleted={onDeleted}
        onNeedsReauth={onNeedsReauth}
      />,
    );
    const input = screen.getByTestId('delete-account-typed-input') as HTMLInputElement;
    await user.type(input, 'SMAZAT');
    await user.click(screen.getByTestId('delete-account-confirm'));
    await waitFor(() => {
      expect(onNeedsReauth).toHaveBeenCalledOnce();
      expect(deleteAccount).not.toHaveBeenCalled();
      expect(onDeleted).not.toHaveBeenCalled();
    });
  });

  it('server returns stale_jwt → onNeedsReauth', async () => {
    const user = userEvent.setup();
    const tokenStore = makeTokenStore();
    const onDeleted = vi.fn();
    const onNeedsReauth = vi.fn();
    (deleteAccount as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'stale_jwt',
    });
    render(
      <DeleteAccountModal
        tokenStore={tokenStore}
        onCanceled={vi.fn()}
        onDeleted={onDeleted}
        onNeedsReauth={onNeedsReauth}
      />,
    );
    const input = screen.getByTestId('delete-account-typed-input') as HTMLInputElement;
    await user.type(input, 'SMAZAT');
    await user.click(screen.getByTestId('delete-account-confirm'));
    await waitFor(() => {
      expect(onNeedsReauth).toHaveBeenCalledOnce();
      expect(onDeleted).not.toHaveBeenCalled();
    });
  });
});

describe('DeleteAccountModal — cancel', () => {
  it('cancel button calls onCanceled', async () => {
    const user = userEvent.setup();
    const tokenStore = makeTokenStore();
    const onCanceled = vi.fn();
    render(
      <DeleteAccountModal
        tokenStore={tokenStore}
        onCanceled={onCanceled}
        onDeleted={vi.fn().mockResolvedValue(undefined)}
        onNeedsReauth={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('delete-account-cancel'));
    expect(onCanceled).toHaveBeenCalledOnce();
  });
});
