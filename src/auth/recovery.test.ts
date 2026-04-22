/**
 * Tests for Recovery Secret module - checksum confirmation flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateRecoverySecret,
  encodeBase32,
  decodeBase32,
  generateRSChecksum,
  validateRSChecksum,
  createRecoveryExportSession,
  getRecoveryExportSession,
  getRecoveryExportSessionByVaultId,
  confirmRecoveryExportSession,
  confirmRecoveryExportSessionForVault,
  isRecoverySessionConfirmed,
  isRecoveryConfirmedForVault,
  clearRecoveryExportSession,
  getEncodedRsFromSession,
  requireConfirmedRecoverySession,
  formatRsForDisplay,
  parseRsInput,
  isValidRsFormat,
  decodeRsFromInput,
  RS_LENGTH_BYTES,
  CHECKSUM_LENGTH,
  // RS Rotation exports
  rotateRecoverySecret,
  getRotationSession,
  getRotationSessionByVaultId,
  confirmRotationSession,
  confirmRotationSessionForVault,
  isRotationSessionConfirmed,
  isRotationConfirmedForVault,
  clearRotationSession,
  getRotationNewVersion,
  requireConfirmedRotationSession,
  type WrapDekWithRsHandler,
} from './recovery';
import {
  deleteKeyStoreDb,
  closeKeyStoreDb,
  createVaultState,
  getVaultState,
  createDefaultMetadata,
  generateVaultId,
  createWrappedKeyData,
  type VaultState,
  type WrappedKeyData,
} from '../db/keystore';

/**
 * Creates a mock VaultState for testing
 */
function createMockVaultState(overrides?: Partial<VaultState>): VaultState {
  const vaultId = generateVaultId();
  return {
    vaultId,
    deviceSalt: 'mock-device-salt-base64url',
    wrappedDekPrf: null,
    wrappedDekRs: null,
    credentialId: null,
    userId: 'test-user-123',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rsConfirmed: false,
    metadata: createDefaultMetadata(),
    ...overrides,
  };
}

describe('Recovery Secret - Checksum Flow', () => {
  beforeEach(async () => {
    // Clean up before each test
    await deleteKeyStoreDb();
    clearRecoveryExportSession();
  });

  afterEach(async () => {
    // Clean up after each test
    await closeKeyStoreDb();
    clearRecoveryExportSession();
  });

  describe('Base32 Encoding/Decoding', () => {
    it('should encode empty array', () => {
      const result = encodeBase32(new Uint8Array(0));
      expect(result).toBe('');
    });

    it('should encode single byte correctly', () => {
      // 0xFF = 11111111 -> first 5 bits = 11111 = 31 = '7', next 3 bits padded = 11100 = 28 = '4'
      const result = encodeBase32(new Uint8Array([0xFF]));
      expect(result).toBe('74');
    });

    it('should encode known test vector', () => {
      // RFC 4648 test vector: "foobar" = MZXW6YTBOI======
      const input = new TextEncoder().encode('foobar');
      const result = encodeBase32(input);
      expect(result).toBe('MZXW6YTBOI');
    });

    it('should decode empty string', () => {
      const result = decodeBase32('');
      expect(result).toEqual(new Uint8Array(0));
    });

    it('should decode known test vector', () => {
      const result = decodeBase32('MZXW6YTBOI');
      const expected = new TextEncoder().encode('foobar');
      expect(Array.from(result)).toEqual(Array.from(expected));
    });

    it('should handle case-insensitive decoding', () => {
      const upper = decodeBase32('MZXW6YTBOI');
      const lower = decodeBase32('mzxw6ytboi');
      expect(upper).toEqual(lower);
    });

    it('should ignore whitespace and dashes in decoding', () => {
      const clean = decodeBase32('MZXW6YTBOI');
      const withDashes = decodeBase32('MZXW-6YTB-OI');
      const withSpaces = decodeBase32('MZXW 6YTB OI');
      expect(withDashes).toEqual(clean);
      expect(withSpaces).toEqual(clean);
    });

    it('should throw on invalid characters', () => {
      expect(() => decodeBase32('MZXW!YTBOI')).toThrow('Invalid Base32 character');
    });

    it('should roundtrip encode/decode', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const encoded = encodeBase32(original);
      const decoded = decodeBase32(encoded);
      expect(decoded).toEqual(original);
    });

    it('should roundtrip RS-length data', () => {
      const original = new Uint8Array(RS_LENGTH_BYTES);
      crypto.getRandomValues(original);
      const encoded = encodeBase32(original);
      const decoded = decodeBase32(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('Recovery Secret Generation', () => {
    it('should generate RS with correct length', () => {
      const rs = generateRecoverySecret();
      expect(rs.raw.length).toBe(RS_LENGTH_BYTES);
    });

    it('should generate valid Base32 encoding', () => {
      const rs = generateRecoverySecret();
      // 32 bytes = 256 bits = 52 Base32 characters (256/5 = 51.2, rounded up)
      expect(rs.encoded.length).toBe(52);
      expect(isValidRsFormat(rs.encoded)).toBe(true);
    });

    it('should generate checksum from encoded RS', () => {
      const rs = generateRecoverySecret();
      expect(rs.checksum.length).toBe(CHECKSUM_LENGTH);
      expect(rs.checksum).toBe(rs.encoded.slice(-CHECKSUM_LENGTH));
    });

    it('should generate unique RS each time', () => {
      const rs1 = generateRecoverySecret();
      const rs2 = generateRecoverySecret();
      expect(rs1.encoded).not.toBe(rs2.encoded);
      expect(rs1.checksum).not.toBe(rs2.checksum);
    });

    it('should roundtrip generated RS', () => {
      const rs = generateRecoverySecret();
      const decoded = decodeBase32(rs.encoded);
      expect(decoded).toEqual(rs.raw);
    });
  });

  describe('Checksum Generation', () => {
    it('should generate checksum of correct length', () => {
      const checksum = generateRSChecksum('ABCDEFGHIJKLMNOP');
      expect(checksum.length).toBe(CHECKSUM_LENGTH);
    });

    it('should return last 4 characters', () => {
      const checksum = generateRSChecksum('ABCDEFGHIJKLMNOP');
      expect(checksum).toBe('MNOP');
    });

    it('should uppercase the checksum', () => {
      const checksum = generateRSChecksum('abcdefghijklmnop');
      expect(checksum).toBe('MNOP');
    });

    it('should throw if RS too short', () => {
      expect(() => generateRSChecksum('ABC')).toThrow('RS too short');
    });

    it('should handle exact minimum length', () => {
      const checksum = generateRSChecksum('ABCD');
      expect(checksum).toBe('ABCD');
    });
  });

  describe('Checksum Validation', () => {
    it('should validate matching checksum', () => {
      const rs = generateRecoverySecret();
      expect(validateRSChecksum(rs.encoded, rs.checksum)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const rs = generateRecoverySecret();
      expect(validateRSChecksum(rs.encoded, rs.checksum.toLowerCase())).toBe(true);
    });

    it('should ignore whitespace in checksum input', () => {
      const checksum = generateRSChecksum('ABCDEFGHIJKLMNOP');
      expect(validateRSChecksum('ABCDEFGHIJKLMNOP', 'MN OP')).toBe(true);
      expect(validateRSChecksum('ABCDEFGHIJKLMNOP', 'M-N-O-P')).toBe(true);
    });

    it('should reject wrong checksum', () => {
      const rs = generateRecoverySecret();
      expect(validateRSChecksum(rs.encoded, 'XXXX')).toBe(false);
    });

    it('should reject empty RS', () => {
      expect(validateRSChecksum('', 'ABCD')).toBe(false);
    });

    it('should reject empty checksum', () => {
      expect(validateRSChecksum('ABCDEFGHIJKLMNOP', '')).toBe(false);
    });

    it('should reject null/undefined inputs', () => {
      expect(validateRSChecksum(null as unknown as string, 'ABCD')).toBe(false);
      expect(validateRSChecksum('ABCD', null as unknown as string)).toBe(false);
    });
  });

  describe('Recovery Export Session', () => {
    it('should create new session', () => {
      const rs = generateRecoverySecret();
      const session = createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      expect(session.sessionId).toBeTruthy();
      expect(session.vaultId).toBe('vault-123');
      expect(session.userId).toBe('user-456');
      expect(session.confirmed).toBe(false);
      expect(session.expectedChecksum).toBe(rs.checksum);
      expect(session.encodedRs).toBe(rs.encoded);
    });

    it('should retrieve stored session', () => {
      const rs = generateRecoverySecret();
      const created = createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      const retrieved = getRecoveryExportSession();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });

    it('should retrieve session by vault ID', () => {
      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      const retrieved = getRecoveryExportSessionByVaultId('vault-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.vaultId).toBe('vault-123');
    });

    it('should return null for wrong vault ID', () => {
      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      const retrieved = getRecoveryExportSessionByVaultId('vault-999');
      expect(retrieved).toBeNull();
    });

    it('should clear session', () => {
      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      clearRecoveryExportSession();

      expect(getRecoveryExportSession()).toBeNull();
    });

    it('should get encoded RS from session', () => {
      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      expect(getEncodedRsFromSession()).toBe(rs.encoded);
    });

    it('should return null when no session', () => {
      expect(getEncodedRsFromSession()).toBeNull();
    });
  });

  describe('Session Confirmation Flow', () => {
    it('should confirm session with correct checksum', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      const result = await confirmRecoveryExportSession(rs.checksum);
      expect(result).toBe(true);

      const session = getRecoveryExportSession();
      expect(session?.confirmed).toBe(true);
      expect(session?.confirmedAt).toBeDefined();
    });

    it('should reject session with wrong checksum', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      const result = await confirmRecoveryExportSession('XXXX');
      expect(result).toBe(false);

      const session = getRecoveryExportSession();
      expect(session?.confirmed).toBe(false);
    });

    it('should update KeyStore rsConfirmed on confirmation', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123', rsConfirmed: false });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      await confirmRecoveryExportSession(rs.checksum);

      const updatedVault = await getVaultState('vault-123');
      expect(updatedVault?.rsConfirmed).toBe(true);
    });

    it('should throw when no active session', async () => {
      await expect(confirmRecoveryExportSession('ABCD')).rejects.toThrow('No active recovery export session');
    });

    it('should return true if already confirmed', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      // First confirmation
      await confirmRecoveryExportSession(rs.checksum);

      // Second confirmation (even with wrong checksum) should return true
      const result = await confirmRecoveryExportSession('XXXX');
      expect(result).toBe(true);
    });

    it('should confirm session for specific vault', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      const result = await confirmRecoveryExportSessionForVault('vault-123', rs.checksum);
      expect(result).toBe(true);
    });

    it('should return false for wrong vault ID', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      const result = await confirmRecoveryExportSessionForVault('vault-999', rs.checksum);
      expect(result).toBe(false);
    });
  });

  describe('Confirmation Status Checks', () => {
    it('should check if session is confirmed', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      expect(isRecoverySessionConfirmed()).toBe(false);

      await confirmRecoveryExportSession(rs.checksum);

      expect(isRecoverySessionConfirmed()).toBe(true);
    });

    it('should return false when no session', () => {
      expect(isRecoverySessionConfirmed()).toBe(false);
    });

    it('should check confirmation for specific vault', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      expect(isRecoveryConfirmedForVault('vault-123')).toBe(false);

      await confirmRecoveryExportSession(rs.checksum);

      expect(isRecoveryConfirmedForVault('vault-123')).toBe(true);
      expect(isRecoveryConfirmedForVault('vault-999')).toBe(false);
    });
  });

  describe('Require Confirmed Session', () => {
    it('should throw when no session', () => {
      expect(() => requireConfirmedRecoverySession()).toThrow('no active session');
    });

    it('should throw when session not confirmed', () => {
      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);

      expect(() => requireConfirmedRecoverySession()).toThrow('checksum not verified');
    });

    it('should throw when vault ID does not match', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);
      await confirmRecoveryExportSession(rs.checksum);

      expect(() => requireConfirmedRecoverySession('vault-999')).toThrow('session does not match vault');
    });

    it('should pass when session is confirmed', async () => {
      const vault = createMockVaultState({ vaultId: 'vault-123' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('vault-123', 'user-456', rs.encoded);
      await confirmRecoveryExportSession(rs.checksum);

      expect(() => requireConfirmedRecoverySession()).not.toThrow();
      expect(() => requireConfirmedRecoverySession('vault-123')).not.toThrow();
    });
  });

  describe('RS Display Formatting', () => {
    it('should format RS with default grouping', () => {
      const result = formatRsForDisplay('ABCDEFGHIJKLMNOP');
      expect(result).toBe('ABCD-EFGH-IJKL-MNOP');
    });

    it('should format RS with custom group size', () => {
      const result = formatRsForDisplay('ABCDEFGHIJKLMNOP', 8);
      expect(result).toBe('ABCDEFGH-IJKLMNOP');
    });

    it('should format RS with custom separator', () => {
      const result = formatRsForDisplay('ABCDEFGHIJKLMNOP', 4, ' ');
      expect(result).toBe('ABCD EFGH IJKL MNOP');
    });

    it('should handle odd-length RS', () => {
      const result = formatRsForDisplay('ABCDEFGHIJ');
      expect(result).toBe('ABCD-EFGH-IJ');
    });
  });

  describe('RS Input Parsing', () => {
    it('should normalize to uppercase', () => {
      const result = parseRsInput('abcdefgh');
      expect(result).toBe('ABCDEFGH');
    });

    it('should remove dashes', () => {
      const result = parseRsInput('ABCD-EFGH-IJKL');
      expect(result).toBe('ABCDEFGHIJKL');
    });

    it('should remove spaces', () => {
      const result = parseRsInput('ABCD EFGH IJKL');
      expect(result).toBe('ABCDEFGHIJKL');
    });

    it('should handle mixed formatting', () => {
      const result = parseRsInput('abcd-efgh ijkl');
      expect(result).toBe('ABCDEFGHIJKL');
    });
  });

  describe('RS Format Validation', () => {
    it('should validate correct RS format', () => {
      const rs = generateRecoverySecret();
      expect(isValidRsFormat(rs.encoded)).toBe(true);
    });

    it('should accept formatted RS', () => {
      const rs = generateRecoverySecret();
      const formatted = formatRsForDisplay(rs.encoded);
      expect(isValidRsFormat(formatted)).toBe(true);
    });

    it('should reject wrong length', () => {
      expect(isValidRsFormat('ABCD')).toBe(false);
      expect(isValidRsFormat('A'.repeat(53))).toBe(false);
    });

    it('should reject invalid characters', () => {
      expect(isValidRsFormat('A'.repeat(51) + '!')).toBe(false);
    });
  });

  describe('RS Input Decoding', () => {
    it('should decode valid RS input', () => {
      const rs = generateRecoverySecret();
      const decoded = decodeRsFromInput(rs.encoded);
      expect(decoded).toEqual(rs.raw);
    });

    it('should decode formatted RS input', () => {
      const rs = generateRecoverySecret();
      const formatted = formatRsForDisplay(rs.encoded);
      const decoded = decodeRsFromInput(formatted);
      expect(decoded).toEqual(rs.raw);
    });

    it('should throw on invalid RS input', () => {
      expect(() => decodeRsFromInput('ABCD')).toThrow('Invalid Recovery Secret format');
    });
  });

  describe('RS Confirmation Workflow - End-to-End', () => {
    it('should complete full confirmation workflow', async () => {
      // Step 1: Create vault
      const vault = createMockVaultState({ vaultId: 'workflow-vault' });
      await createVaultState(vault);

      // Step 2: Generate RS
      const rs = generateRecoverySecret();

      // Step 3: Create recovery export session
      const session = createRecoveryExportSession('workflow-vault', 'user-123', rs.encoded);
      expect(session.confirmed).toBe(false);

      // Step 4: Verify not confirmed yet
      expect(isRecoverySessionConfirmed()).toBe(false);
      expect(() => requireConfirmedRecoverySession()).toThrow('checksum not verified');

      // Step 5: Confirm with correct checksum
      const confirmed = await confirmRecoveryExportSession(rs.checksum);
      expect(confirmed).toBe(true);

      // Step 6: Verify confirmation persisted
      expect(isRecoverySessionConfirmed()).toBe(true);
      expect(() => requireConfirmedRecoverySession()).not.toThrow();

      // Step 7: Verify KeyStore updated
      const updatedVault = await getVaultState('workflow-vault');
      expect(updatedVault?.rsConfirmed).toBe(true);
    });

    it('should handle multiple incorrect checksum attempts followed by correct one', async () => {
      const vault = createMockVaultState({ vaultId: 'retry-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('retry-vault', 'user-123', rs.encoded);

      // Multiple incorrect attempts
      const attempt1 = await confirmRecoveryExportSession('AAAA');
      expect(attempt1).toBe(false);

      const attempt2 = await confirmRecoveryExportSession('BBBB');
      expect(attempt2).toBe(false);

      const attempt3 = await confirmRecoveryExportSession('CCCC');
      expect(attempt3).toBe(false);

      // Session should still be active and not confirmed
      const session = getRecoveryExportSession();
      expect(session).not.toBeNull();
      expect(session?.confirmed).toBe(false);

      // Finally enter correct checksum
      const correctAttempt = await confirmRecoveryExportSession(rs.checksum);
      expect(correctAttempt).toBe(true);
      expect(isRecoverySessionConfirmed()).toBe(true);
    });

    it('should accept checksum with various input formats', async () => {
      const vault = createMockVaultState({ vaultId: 'format-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      const checksum = rs.checksum;

      // Test with lowercase
      createRecoveryExportSession('format-vault', 'user-123', rs.encoded);
      expect(await confirmRecoveryExportSession(checksum.toLowerCase())).toBe(true);
      clearRecoveryExportSession();

      // Reset for next test
      await createVaultState(createMockVaultState({ vaultId: 'format-vault-2' }));
      createRecoveryExportSession('format-vault-2', 'user-123', rs.encoded);

      // Test with spaces
      const withSpaces = checksum.split('').join(' ');
      expect(await confirmRecoveryExportSession(withSpaces)).toBe(true);
      clearRecoveryExportSession();

      // Reset for next test
      await createVaultState(createMockVaultState({ vaultId: 'format-vault-3' }));
      createRecoveryExportSession('format-vault-3', 'user-123', rs.encoded);

      // Test with dashes
      const withDashes = checksum.slice(0, 2) + '-' + checksum.slice(2);
      expect(await confirmRecoveryExportSession(withDashes)).toBe(true);
    });

    it('should maintain session data throughout confirmation flow', async () => {
      const vault = createMockVaultState({ vaultId: 'data-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      const createdSession = createRecoveryExportSession('data-vault', 'user-456', rs.encoded);

      // Verify session data before confirmation
      let session = getRecoveryExportSession();
      expect(session?.sessionId).toBe(createdSession.sessionId);
      expect(session?.vaultId).toBe('data-vault');
      expect(session?.userId).toBe('user-456');
      expect(session?.encodedRs).toBe(rs.encoded);
      expect(session?.expectedChecksum).toBe(rs.checksum);

      // Confirm
      await confirmRecoveryExportSession(rs.checksum);

      // Verify session data preserved after confirmation
      session = getRecoveryExportSession();
      expect(session?.sessionId).toBe(createdSession.sessionId);
      expect(session?.vaultId).toBe('data-vault');
      expect(session?.userId).toBe('user-456');
      expect(session?.confirmedAt).toBeDefined();
      expect(session?.confirmedAt).toBeGreaterThanOrEqual(session!.createdAt);
    });

    it('should handle session replacement when creating new session', async () => {
      const vault1 = createMockVaultState({ vaultId: 'vault-1' });
      const vault2 = createMockVaultState({ vaultId: 'vault-2' });
      await createVaultState(vault1);
      await createVaultState(vault2);

      const rs1 = generateRecoverySecret();
      const rs2 = generateRecoverySecret();

      // Create first session
      createRecoveryExportSession('vault-1', 'user-1', rs1.encoded);
      expect(getRecoveryExportSessionByVaultId('vault-1')).not.toBeNull();

      // Create second session (should replace first)
      createRecoveryExportSession('vault-2', 'user-2', rs2.encoded);

      // First session should no longer be retrievable
      expect(getRecoveryExportSessionByVaultId('vault-1')).toBeNull();

      // Second session should be active
      expect(getRecoveryExportSessionByVaultId('vault-2')).not.toBeNull();
      expect(getRecoveryExportSession()?.vaultId).toBe('vault-2');
    });

    it('should clear session after vault creation flow', async () => {
      const vault = createMockVaultState({ vaultId: 'clear-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('clear-vault', 'user-123', rs.encoded);

      // Confirm RS
      await confirmRecoveryExportSession(rs.checksum);
      expect(isRecoverySessionConfirmed()).toBe(true);

      // Clear session (simulating end of vault creation)
      clearRecoveryExportSession();

      // Verify session is cleared
      expect(getRecoveryExportSession()).toBeNull();
      expect(isRecoverySessionConfirmed()).toBe(false);
      expect(getEncodedRsFromSession()).toBeNull();

      // KeyStore rsConfirmed should still be true
      const updatedVault = await getVaultState('clear-vault');
      expect(updatedVault?.rsConfirmed).toBe(true);
    });
  });

  describe('RS Confirmation Edge Cases', () => {
    it('should reject empty checksum input', async () => {
      const vault = createMockVaultState({ vaultId: 'empty-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('empty-vault', 'user-123', rs.encoded);

      // Empty string should fail validation (not throw)
      const result = await confirmRecoveryExportSession('');
      expect(result).toBe(false);
    });

    it('should reject whitespace-only checksum input', async () => {
      const vault = createMockVaultState({ vaultId: 'whitespace-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('whitespace-vault', 'user-123', rs.encoded);

      // Whitespace only should fail (becomes empty after normalization)
      const result = await confirmRecoveryExportSession('   ');
      expect(result).toBe(false);
    });

    it('should reject checksum with invalid characters', async () => {
      const vault = createMockVaultState({ vaultId: 'invalid-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('invalid-vault', 'user-123', rs.encoded);

      // Checksum with invalid characters
      const result = await confirmRecoveryExportSession('AB!@');
      expect(result).toBe(false);
    });

    it('should reject checksum that is too short', async () => {
      const vault = createMockVaultState({ vaultId: 'short-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('short-vault', 'user-123', rs.encoded);

      // Only 2 characters (too short)
      const result = await confirmRecoveryExportSession('AB');
      expect(result).toBe(false);
    });

    it('should reject checksum that is too long', async () => {
      const vault = createMockVaultState({ vaultId: 'long-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('long-vault', 'user-123', rs.encoded);

      // 6 characters (too long)
      const result = await confirmRecoveryExportSession('ABCDEF');
      expect(result).toBe(false);
    });

    it('should handle confirmation for vault that does not exist in KeyStore', async () => {
      // Create session for non-existent vault
      const rs = generateRecoverySecret();
      createRecoveryExportSession('non-existent-vault', 'user-123', rs.encoded);

      // This should throw because confirmRecoverySecret will fail
      await expect(confirmRecoveryExportSession(rs.checksum)).rejects.toThrow();
    });

    it('should preserve encoded RS in session until cleared', () => {
      const rs = generateRecoverySecret();
      createRecoveryExportSession('test-vault', 'user-123', rs.encoded);

      // RS should be accessible
      expect(getEncodedRsFromSession()).toBe(rs.encoded);

      // Clear session
      clearRecoveryExportSession();

      // RS should no longer be accessible
      expect(getEncodedRsFromSession()).toBeNull();
    });

    it('should track timestamps correctly', async () => {
      const vault = createMockVaultState({ vaultId: 'timestamp-vault' });
      await createVaultState(vault);

      const beforeCreate = Date.now();
      const rs = generateRecoverySecret();
      createRecoveryExportSession('timestamp-vault', 'user-123', rs.encoded);
      const afterCreate = Date.now();

      let session = getRecoveryExportSession();
      expect(session?.createdAt).toBeGreaterThanOrEqual(beforeCreate);
      expect(session?.createdAt).toBeLessThanOrEqual(afterCreate);
      expect(session?.confirmedAt).toBeUndefined();

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const beforeConfirm = Date.now();
      await confirmRecoveryExportSession(rs.checksum);
      const afterConfirm = Date.now();

      session = getRecoveryExportSession();
      expect(session?.confirmedAt).toBeGreaterThanOrEqual(beforeConfirm);
      expect(session?.confirmedAt).toBeLessThanOrEqual(afterConfirm);
      expect(session?.confirmedAt).toBeGreaterThanOrEqual(session!.createdAt);
    });
  });

  describe('RS Confirmation Guard Functions', () => {
    it('should block operations when session not confirmed', () => {
      const rs = generateRecoverySecret();
      createRecoveryExportSession('guard-vault', 'user-123', rs.encoded);

      // requireConfirmedRecoverySession should throw
      expect(() => requireConfirmedRecoverySession()).toThrow('checksum not verified');

      // isRecoverySessionConfirmed should return false
      expect(isRecoverySessionConfirmed()).toBe(false);

      // isRecoveryConfirmedForVault should return false
      expect(isRecoveryConfirmedForVault('guard-vault')).toBe(false);
    });

    it('should allow operations after confirmation', async () => {
      const vault = createMockVaultState({ vaultId: 'allowed-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('allowed-vault', 'user-123', rs.encoded);

      await confirmRecoveryExportSession(rs.checksum);

      // All guards should pass
      expect(() => requireConfirmedRecoverySession()).not.toThrow();
      expect(() => requireConfirmedRecoverySession('allowed-vault')).not.toThrow();
      expect(isRecoverySessionConfirmed()).toBe(true);
      expect(isRecoveryConfirmedForVault('allowed-vault')).toBe(true);
    });

    it('should correctly distinguish between vault IDs', async () => {
      const vault = createMockVaultState({ vaultId: 'correct-vault' });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('correct-vault', 'user-123', rs.encoded);
      await confirmRecoveryExportSession(rs.checksum);

      // Correct vault should pass
      expect(isRecoveryConfirmedForVault('correct-vault')).toBe(true);
      expect(() => requireConfirmedRecoverySession('correct-vault')).not.toThrow();

      // Wrong vault should fail
      expect(isRecoveryConfirmedForVault('wrong-vault')).toBe(false);
      expect(() => requireConfirmedRecoverySession('wrong-vault')).toThrow('does not match vault');
    });
  });

  describe('RS Confirmation and KeyStore Integration', () => {
    it('should set rsConfirmed to true on successful confirmation', async () => {
      const vault = createMockVaultState({ vaultId: 'keystore-vault', rsConfirmed: false });
      await createVaultState(vault);

      // Verify initial state
      let vaultState = await getVaultState('keystore-vault');
      expect(vaultState?.rsConfirmed).toBe(false);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('keystore-vault', 'user-123', rs.encoded);

      await confirmRecoveryExportSession(rs.checksum);

      // Verify rsConfirmed is now true
      vaultState = await getVaultState('keystore-vault');
      expect(vaultState?.rsConfirmed).toBe(true);
    });

    it('should not modify rsConfirmed on failed confirmation', async () => {
      const vault = createMockVaultState({ vaultId: 'fail-keystore-vault', rsConfirmed: false });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('fail-keystore-vault', 'user-123', rs.encoded);

      // Attempt with wrong checksum
      await confirmRecoveryExportSession('XXXX');

      // rsConfirmed should still be false
      const vaultState = await getVaultState('fail-keystore-vault');
      expect(vaultState?.rsConfirmed).toBe(false);
    });

    it('should handle idempotent confirmation (already confirmed vault)', async () => {
      const vault = createMockVaultState({ vaultId: 'idempotent-vault', rsConfirmed: true });
      await createVaultState(vault);

      const rs = generateRecoverySecret();
      createRecoveryExportSession('idempotent-vault', 'user-123', rs.encoded);

      // First confirmation
      await confirmRecoveryExportSession(rs.checksum);
      expect(isRecoverySessionConfirmed()).toBe(true);

      // Second confirmation attempt (should still succeed)
      const result = await confirmRecoveryExportSession(rs.checksum);
      expect(result).toBe(true);

      const vaultState = await getVaultState('idempotent-vault');
      expect(vaultState?.rsConfirmed).toBe(true);
    });
  });
});

describe('Recovery Secret - Rotation', () => {
  beforeEach(async () => {
    // Clean up before each test
    await deleteKeyStoreDb();
    clearRecoveryExportSession();
    clearRotationSession();
  });

  afterEach(async () => {
    // Clean up after each test
    await closeKeyStoreDb();
    clearRecoveryExportSession();
    clearRotationSession();
  });

  /**
   * Creates a mock VaultState with RS wrap for rotation testing
   */
  function createVaultWithRs(overrides?: Partial<VaultState>): VaultState {
    const vaultId = generateVaultId();
    return {
      vaultId,
      deviceSalt: 'mock-device-salt-base64url',
      wrappedDekPrf: createWrappedKeyData('mock-prf-ct', 'mock-prf-iv', 1),
      wrappedDekRs: createWrappedKeyData('mock-rs-ct', 'mock-rs-iv', 1),
      credentialId: 'mock-credential-id',
      userId: 'test-user-123',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rsConfirmed: true,
      metadata: createDefaultMetadata(),
      ...overrides,
    };
  }

  /**
   * Creates a mock wrap handler that returns a predictable WrappedKeyData
   */
  function createMockWrapHandler(): WrapDekWithRsHandler {
    return async (_rs: Uint8Array, _deviceSalt: string): Promise<WrappedKeyData> => {
      return createWrappedKeyData('new-wrapped-ct', 'new-wrapped-iv', 1);
    };
  }

  describe('rotateRecoverySecret', () => {
    it('should rotate RS successfully', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      expect(result.success).toBe(true);
      expect(result.newRs).toBeDefined();
      expect(result.newRs?.raw.length).toBe(RS_LENGTH_BYTES);
      expect(result.newRs?.encoded.length).toBe(52);
      expect(result.newRs?.checksum.length).toBe(CHECKSUM_LENGTH);
    });

    it('should update KeyStore with new wrapped DEK', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const updatedVault = await getVaultState(vault.vaultId);
      expect(updatedVault?.wrappedDekRs?.ct).toBe('new-wrapped-ct');
      expect(updatedVault?.wrappedDekRs?.iv).toBe('new-wrapped-iv');
    });

    it('should increment version number', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const updatedVault = await getVaultState(vault.vaultId);
      expect(updatedVault?.wrappedDekRs?.version).toBe(2);
    });

    it('should create rotation session', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const session = getRotationSession();
      expect(session).not.toBeNull();
      expect(session?.vaultId).toBe(vault.vaultId);
      expect(session?.confirmed).toBe(false);
      expect(session?.expectedChecksum).toBe(result.newRs?.checksum);
      expect(session?.previousVersion).toBe(1);
      expect(session?.newVersion).toBe(2);
    });

    it('should fail if vault does not exist', async () => {
      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret('non-existent-vault', mockWrapHandler);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail if vault has no existing RS wrap', async () => {
      const vault = createVaultWithRs({ wrappedDekRs: null });
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not have an existing RS wrap');
    });

    it('should fail if RS was not confirmed', async () => {
      const vault = createVaultWithRs({ rsConfirmed: false });
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      expect(result.success).toBe(false);
      expect(result.error).toContain('current RS has not been confirmed');
    });

    it('should handle wrap handler errors', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const errorWrapHandler: WrapDekWithRsHandler = async () => {
        throw new Error('Wrap operation failed');
      };

      const result = await rotateRecoverySecret(vault.vaultId, errorWrapHandler);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Wrap operation failed');
    });

    it('should pass RS and deviceSalt to wrap handler', async () => {
      const vault = createVaultWithRs({ deviceSalt: 'test-device-salt-123' });
      await createVaultState(vault);

      let receivedRs: Uint8Array | null = null;
      let receivedSalt: string | null = null;

      const captureWrapHandler: WrapDekWithRsHandler = async (rs, deviceSalt) => {
        receivedRs = rs as Uint8Array;
        receivedSalt = deviceSalt;
        return createWrappedKeyData('ct', 'iv', 1);
      };

      const result = await rotateRecoverySecret(vault.vaultId, captureWrapHandler);

      expect(receivedRs).not.toBeNull();
      expect((receivedRs as Uint8Array | null)?.length).toBe(RS_LENGTH_BYTES);
      expect(receivedRs).toEqual(result.newRs?.raw);
      expect(receivedSalt).toBe('test-device-salt-123');
    });
  });

  describe('Rotation Session Management', () => {
    it('should retrieve rotation session', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const session = getRotationSession();
      expect(session).not.toBeNull();
      expect(session?.vaultId).toBe(vault.vaultId);
    });

    it('should retrieve rotation session by vault ID', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const session = getRotationSessionByVaultId(vault.vaultId);
      expect(session).not.toBeNull();
      expect(session?.vaultId).toBe(vault.vaultId);
    });

    it('should return null for wrong vault ID', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const session = getRotationSessionByVaultId('wrong-vault-id');
      expect(session).toBeNull();
    });

    it('should clear rotation session', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      clearRotationSession();

      expect(getRotationSession()).toBeNull();
    });

    it('should get new version from rotation session', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      expect(getRotationNewVersion()).toBe(2);
    });

    it('should return null for new version when no session', () => {
      expect(getRotationNewVersion()).toBeNull();
    });
  });

  describe('Rotation Session Confirmation', () => {
    it('should confirm rotation with correct checksum', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const confirmed = confirmRotationSession(result.newRs!.checksum);
      expect(confirmed).toBe(true);

      const session = getRotationSession();
      expect(session?.confirmed).toBe(true);
      expect(session?.confirmedAt).toBeDefined();
    });

    it('should reject rotation with wrong checksum', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const confirmed = confirmRotationSession('XXXX');
      expect(confirmed).toBe(false);

      const session = getRotationSession();
      expect(session?.confirmed).toBe(false);
    });

    it('should be case-insensitive', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const confirmed = confirmRotationSession(result.newRs!.checksum.toLowerCase());
      expect(confirmed).toBe(true);
    });

    it('should ignore whitespace and dashes', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      // Format checksum with spaces
      const checksum = result.newRs!.checksum;
      const formattedChecksum = checksum.split('').join(' ');

      const confirmed = confirmRotationSession(formattedChecksum);
      expect(confirmed).toBe(true);
    });

    it('should throw when no rotation session exists', () => {
      expect(() => confirmRotationSession('ABCD')).toThrow('No active RS rotation session');
    });

    it('should return true if already confirmed', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      // First confirmation
      confirmRotationSession(result.newRs!.checksum);

      // Second confirmation (even with wrong checksum) should return true
      const secondConfirm = confirmRotationSession('XXXX');
      expect(secondConfirm).toBe(true);
    });

    it('should confirm rotation for specific vault', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const confirmed = confirmRotationSessionForVault(vault.vaultId, result.newRs!.checksum);
      expect(confirmed).toBe(true);
    });

    it('should return false for wrong vault ID', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const confirmed = confirmRotationSessionForVault('wrong-vault', result.newRs!.checksum);
      expect(confirmed).toBe(false);
    });
  });

  describe('Rotation Confirmation Status', () => {
    it('should check if rotation session is confirmed', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      expect(isRotationSessionConfirmed()).toBe(false);

      confirmRotationSession(result.newRs!.checksum);

      expect(isRotationSessionConfirmed()).toBe(true);
    });

    it('should return false when no session', () => {
      expect(isRotationSessionConfirmed()).toBe(false);
    });

    it('should check confirmation for specific vault', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      expect(isRotationConfirmedForVault(vault.vaultId)).toBe(false);

      confirmRotationSession(result.newRs!.checksum);

      expect(isRotationConfirmedForVault(vault.vaultId)).toBe(true);
      expect(isRotationConfirmedForVault('wrong-vault')).toBe(false);
    });
  });

  describe('Require Confirmed Rotation Session', () => {
    it('should throw when no session', () => {
      expect(() => requireConfirmedRotationSession()).toThrow('no active rotation session');
    });

    it('should throw when session not confirmed', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      expect(() => requireConfirmedRotationSession()).toThrow('new RS checksum not verified');
    });

    it('should throw when vault ID does not match', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);
      confirmRotationSession(result.newRs!.checksum);

      expect(() => requireConfirmedRotationSession('wrong-vault')).toThrow('session does not match vault');
    });

    it('should pass when session is confirmed', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();
      const result = await rotateRecoverySecret(vault.vaultId, mockWrapHandler);
      confirmRotationSession(result.newRs!.checksum);

      expect(() => requireConfirmedRotationSession()).not.toThrow();
      expect(() => requireConfirmedRotationSession(vault.vaultId)).not.toThrow();
    });
  });

  describe('Old RS Invalidation', () => {
    it('should invalidate old RS (new wrap replaces old)', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      // Store original RS wrap info
      const originalWrap = vault.wrappedDekRs;

      const mockWrapHandler = createMockWrapHandler();
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);

      const updatedVault = await getVaultState(vault.vaultId);

      // Old RS wrap should be completely replaced
      expect(updatedVault?.wrappedDekRs?.ct).not.toBe(originalWrap?.ct);
      expect(updatedVault?.wrappedDekRs?.iv).not.toBe(originalWrap?.iv);
      expect(updatedVault?.wrappedDekRs?.version).toBeGreaterThan(originalWrap?.version ?? 0);
    });

    it('should track version history across multiple rotations', async () => {
      const vault = createVaultWithRs();
      await createVaultState(vault);

      const mockWrapHandler = createMockWrapHandler();

      // First rotation
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);
      let updatedVault = await getVaultState(vault.vaultId);
      expect(updatedVault?.wrappedDekRs?.version).toBe(2);

      // Second rotation
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);
      updatedVault = await getVaultState(vault.vaultId);
      expect(updatedVault?.wrappedDekRs?.version).toBe(3);

      // Third rotation
      await rotateRecoverySecret(vault.vaultId, mockWrapHandler);
      updatedVault = await getVaultState(vault.vaultId);
      expect(updatedVault?.wrappedDekRs?.version).toBe(4);
    });
  });
});
