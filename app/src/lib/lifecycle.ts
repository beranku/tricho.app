import { stopSync } from '../sync/couch';
import { closeVaultDb } from '../db/pouch';
import type { TokenStore } from '../auth/token-store';
import { clearAuthCompleteHash } from '../auth/oauth';

const PENDING_OAUTH_KEY = 'tricho-pending-oauth';

export interface WipeSessionInput {
  tokenStore: TokenStore | null;
}

/**
 * Single-source clean shutdown of an unlocked session. Called from logout,
 * idle lock, and the local half of account deletion. Does NOT delete the
 * keystore row — that is `deleteAccount`'s job. Safe to call from any view.
 */
export async function wipeSession({ tokenStore }: WipeSessionInput): Promise<void> {
  stopSync();
  if (tokenStore) {
    try {
      await tokenStore.clear();
    } catch {
      // best-effort — proceed even if clear failed (db may already be closed)
    }
    try {
      tokenStore.dispose();
    } catch {
      // dispose is safe to call repeatedly; swallow
    }
  }
  try {
    await closeVaultDb();
  } catch {
    // already closed
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(PENDING_OAUTH_KEY);
    } catch {
      // sandboxed iframe / disabled storage
    }
  }
  if (typeof window !== 'undefined') {
    try {
      clearAuthCompleteHash();
    } catch {
      // hash mutation may fail in non-browser test env
    }
  }
}
