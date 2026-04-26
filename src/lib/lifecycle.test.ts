import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../sync/couch', () => ({
  stopSync: vi.fn(),
}));

vi.mock('../db/pouch', () => ({
  closeVaultDb: vi.fn(async () => undefined),
}));

vi.mock('../auth/oauth', () => ({
  clearAuthCompleteHash: vi.fn(),
}));

import { wipeSession } from './lifecycle';
import { stopSync } from '../sync/couch';
import { closeVaultDb } from '../db/pouch';
import { clearAuthCompleteHash } from '../auth/oauth';

describe('wipeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('stops sync, closes db, and clears sessionStorage even with null tokenStore', async () => {
    sessionStorage.setItem('tricho-pending-oauth', '{"any":"thing"}');
    await wipeSession({ tokenStore: null });
    expect(stopSync).toHaveBeenCalledTimes(1);
    expect(closeVaultDb).toHaveBeenCalledTimes(1);
    expect(clearAuthCompleteHash).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('tricho-pending-oauth')).toBeNull();
  });

  it('clears and disposes a non-null tokenStore', async () => {
    const clear = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const tokenStore = { clear, dispose } as never;
    await wipeSession({ tokenStore });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('is idempotent across repeated calls', async () => {
    await wipeSession({ tokenStore: null });
    await wipeSession({ tokenStore: null });
    await wipeSession({ tokenStore: null });
    expect(stopSync).toHaveBeenCalledTimes(3);
    expect(closeVaultDb).toHaveBeenCalledTimes(3);
  });

  it('proceeds when tokenStore.clear throws', async () => {
    const clear = vi.fn(async () => {
      throw new Error('db already closed');
    });
    const dispose = vi.fn();
    const tokenStore = { clear, dispose } as never;
    await wipeSession({ tokenStore });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(closeVaultDb).toHaveBeenCalledTimes(1);
  });

  it('proceeds when closeVaultDb throws', async () => {
    (closeVaultDb as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    await expect(wipeSession({ tokenStore: null })).resolves.toBeUndefined();
  });
});
