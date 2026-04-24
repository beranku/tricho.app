/**
 * Shared fixture for tests that need an initialised vault.
 *
 * Use `makeVaultFixture()` to get a deterministic vault id + freshly
 * generated DEK + optionally-seeded keystore. Eliminates the ~20 lines
 * of boilerplate every keystore/recovery test used to repeat.
 */

import { generateAesGcmKey } from '../../crypto/envelope';
import { createDefaultMetadata, generateVaultId } from '../../db/keystore';
import type { VaultMetadata } from '../../db/keystore';

export interface VaultFixture {
  vaultId: string;
  userId: string;
  dek: CryptoKey;
  /** Default vault metadata (creation timestamps, empty unlock counters). */
  metadata: VaultMetadata;
}

export async function makeVaultFixture(
  overrides: Partial<{
    vaultId: string;
    userId: string;
    extractable: boolean;
  }> = {},
): Promise<VaultFixture> {
  const vaultId = overrides.vaultId ?? generateVaultId();
  const userId = overrides.userId ?? `user-${vaultId.slice(0, 8)}`;
  const dek = await generateAesGcmKey(overrides.extractable ?? false);
  const metadata = createDefaultMetadata(vaultId, userId);
  return { vaultId, userId, dek, metadata };
}
