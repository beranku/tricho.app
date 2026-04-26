import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WelcomeScreen } from './welcome/WelcomeScreen';
import { LockedScreen } from './LockedScreen';
import { RenewBanner } from './RenewBanner';
import { UpdateBanner } from './UpdateBanner';
import { GatedSheet } from './GatedSheet';
import type { RecoverySecretResult } from '../auth/recovery';
import { SettingsScreen } from './SettingsScreen';
import { DeviceLimitScreen } from './DeviceLimitScreen';
import { PlanScreen } from './PlanScreen';
import { BankTransferInstructions } from './BankTransferInstructions';
import { BackupExportScreen } from './BackupExportScreen';
import { RestoreFromZipScreen } from './RestoreFromZipScreen';
import { loadSubscription } from '../lib/store/subscription';

// Vite exposes env vars prefixed with VITE_; we treat the literal "true" as
// the only truthy value so the default-empty-string falls back to disabled.
const BILLING_UI_ENABLED = (import.meta.env?.VITE_BILLING_ENABLED as string | undefined) === 'true';
import { ChromeButtons } from './islands/ChromeButtons';
import { BottomSheet } from './islands/BottomSheet';
import { MenuSheet, FabAddSheet } from './islands/MenuSheet';
import { DailySchedule } from './islands/DailySchedule';
import { ClientDetail } from './islands/ClientDetail';
import { openSheet, closeSheet } from '../lib/store/sheet';
import { bootstrapTheme } from '../lib/store/theme';
import { bootstrapLocale, m } from '../i18n';
import {
  createVaultState,
  generateVaultId,
  createDefaultMetadata,
  createWrappedKeyData,
  updateWrappedDekRs,
  updateWrappedDekPrf,
  updateWrappedDekPin,
  updateCredentialId,
  listVaultStates,
  getVaultState,
  type VaultState,
  type WrappedKeyData,
} from '../db/keystore';
import {
  encodeBase64url,
  decodeBase64url,
  envelopeEncrypt,
  envelopeDecrypt,
  encodeUtf8,
  importAesGcmKey,
} from '../crypto/envelope';
import { registerPasskey, getPrfOutput, isWebAuthnAvailable } from '../auth/webauthn';
import { deriveKekFromPin, generatePinSalt } from '../auth/local-pin';
import { openVaultDb, closeVaultDb, putEncrypted, getDecrypted, queryDecrypted, getVaultDb, type VaultDb } from '../db/pouch';
import { DOC_TYPES, type CustomerData } from '../db/types';
import { userDbUrlFor } from '../sync/couch-auth';
import { startSync, stopSync, getSyncState, subscribeSyncEvents, type SyncState } from '../sync/couch';
import {
  uploadVaultState,
  downloadVaultState,
  fetchVaultStateOverHttp,
  type VaultStateDoc,
} from '../sync/couch-vault-state';
import {
  consumePendingOAuthResult,
  clearAuthCompleteHash,
  type OAuthResult,
} from '../auth/oauth';
import { TokenStore } from '../auth/token-store';
import { IdleLock } from '../sync/idle-lock';
import { wipeSession } from '../lib/lifecycle';
import { unpackBackupZip } from '../backup/zip-pack';
import { restoreFromZipBytes } from '../backup/local-zip-restore';

type View =
  | 'loading'
  | 'welcome'
  | 'locked'
  | 'unlocked'
  | 'settings'
  | 'device-limit'
  | 'plan'
  | 'bank-transfer'
  | 'backup-export'
  | 'restore-zip';

const VAULT_STATE_PROBE_TIMEOUT_MS = 5_000;

async function fetchVaultStateWithTimeout(
  username: string,
  jwt: string,
  timeoutMs = VAULT_STATE_PROBE_TIMEOUT_MS,
): Promise<VaultStateDoc | null> {
  return Promise.race<VaultStateDoc | null>([
    fetchVaultStateOverHttp(username, jwt),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('vault-state probe timed out')), timeoutMs),
    ),
  ]);
}

async function deriveKekFromSecret(
  secret: Uint8Array,
  deviceSalt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: deviceSalt as BufferSource,
      info: encodeUtf8(info) as BufferSource,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const deriveKekFromRs = (rs: Uint8Array, salt: Uint8Array) =>
  deriveKekFromSecret(rs, salt, 'tricho-kek-v1');

const deriveKekFromPrf = (prf: Uint8Array, salt: Uint8Array) =>
  deriveKekFromSecret(prf, salt, 'tricho-kek-prf-v1');

function generateDeviceSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

function generateDek(): Uint8Array {
  const dek = new Uint8Array(32);
  crypto.getRandomValues(dek);
  return dek;
}

async function wrapDekWithKek(dek: Uint8Array, kek: CryptoKey): Promise<WrappedKeyData> {
  const { ct, iv } = await envelopeEncrypt(kek, dek);
  return createWrappedKeyData(ct, iv, 1);
}

async function unwrapDekWithKek(wrapped: WrappedKeyData, kek: CryptoKey): Promise<Uint8Array> {
  return envelopeDecrypt(kek, wrapped.ct, wrapped.iv);
}

/**
 * Brief, session-only stash for an OAuth result while the user completes vault
 * creation or restoration. sessionStorage is OK here because the content lives
 * for seconds, never encrypts anything, and is never sent to the server.
 */
const PENDING_OAUTH_KEY = 'tricho-pending-oauth';
function stashPendingOAuth(result: OAuthResult | null): void {
  if (!result) sessionStorage.removeItem(PENDING_OAUTH_KEY);
  else sessionStorage.setItem(PENDING_OAUTH_KEY, JSON.stringify(result));
}
function readPendingOAuth(): OAuthResult | null {
  try {
    const raw = sessionStorage.getItem(PENDING_OAUTH_KEY);
    return raw ? (JSON.parse(raw) as OAuthResult) : null;
  } catch {
    return null;
  }
}

export function AppShell(): JSX.Element {
  const [view, setView] = useState<View>('loading');
  const [bankIntentId, setBankIntentId] = useState<string | null>(null);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [hasExistingVault, setHasExistingVault] = useState(false);
  const [lockedScreenHasPasskey, setLockedScreenHasPasskey] = useState(false);
  const [lockedScreenHasPin, setLockedScreenHasPin] = useState(false);
  const [dek, setDek] = useState<Uint8Array | null>(null);
  const [db, setDb] = useState<VaultDb | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [tokenStore, setTokenStore] = useState<TokenStore | null>(null);
  const [pendingOAuth, setPendingOAuth] = useState<OAuthResult | null>(() => readPendingOAuth());
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [serverVaultState, setServerVaultState] = useState<VaultStateDoc | null>(null);
  const [syncGateState, setSyncGateState] = useState<{ gated: boolean }>({ gated: false });
  const routedOnceRef = useRef(false);

  // On mount: probe local state, pick up any OAuth callback result, route.
  useEffect(() => {
    (async () => {
      // Pick up the server's OAuth handoff first if present.
      const fresh = consumePendingOAuthResult();
      if (fresh) {
        clearAuthCompleteHash();
        stashPendingOAuth(fresh);
        setPendingOAuth(fresh);
      }

      let vaults: VaultState[] = [];
      try {
        vaults = await listVaultStates();
      } catch (err) {
        console.error('[AppShell] listVaultStates failed', err);
      }
      const hasVault = vaults.length > 0;
      if (hasVault) {
        setHasExistingVault(true);
        setVaultId(vaults[0].vaultId);
        setLockedScreenHasPasskey(
          Boolean(vaults[0].wrappedDekPrf && vaults[0].credentialId),
        );
        setLockedScreenHasPin(Boolean(vaults[0].wrappedDekPin && vaults[0].pinSalt));
      }

      const incoming = fresh ?? pendingOAuth;

      // Device-limit gate: server refused to approve this device for the user.
      if (incoming && !incoming.deviceApproved) {
        setAuthHint(m.appShell_deviceLimitHint({ limit: incoming.subscription?.deviceLimit ?? 2 }));
        setView('device-limit');
        routedOnceRef.current = true;
        return;
      }

      // If we have an OAuth session but no local vault, probe the server
      // so Step 3 of the welcome wizard auto-selects the existing flow.
      if (!hasVault && incoming?.tokens?.jwt && incoming.couchdbUsername) {
        try {
          const probed = await fetchVaultStateWithTimeout(
            incoming.couchdbUsername,
            incoming.tokens.jwt,
          );
          if (probed) setServerVaultState(probed);
        } catch (err) {
          console.warn('[AppShell] vault-state probe failed', err);
        }
      }

      setView('welcome');
      routedOnceRef.current = true;
    })();
  }, []);

  /**
   * Brand-new vault: generate RS-wrapped DEK, create KeyStore record, keep the
   * OAuth result handy so sync can start after the passkey is registered.
   */
  const onCreateVault = useCallback(async (rs: Uint8Array): Promise<{ vaultId: string }> => {
    const newVaultId = generateVaultId();
    const deviceSalt = generateDeviceSalt();
    const newDek = generateDek();

    const kek = await deriveKekFromRs(rs, deviceSalt);
    const wrappedDekRs = await wrapDekWithKek(newDek, kek);

    const oauth = pendingOAuth ?? readPendingOAuth();
    const userId = oauth?.couchdbUsername ?? `local-${newVaultId}`;

    const state: VaultState = {
      vaultId: newVaultId,
      deviceSalt: encodeBase64url(deviceSalt),
      wrappedDekPrf: null,
      wrappedDekRs,
      credentialId: null,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rsConfirmed: false,
      metadata: createDefaultMetadata(),
    };
    await createVaultState(state);

    setVaultId(newVaultId);
    setDek(newDek);
    setHasExistingVault(true);
    return { vaultId: newVaultId };
  }, [pendingOAuth]);

  const onRegisterPasskey = useCallback(async (vId: string): Promise<{ prfSupported: boolean }> => {
    if (!isWebAuthnAvailable()) return { prfSupported: false };
    if (!dek) return { prfSupported: false };
    const vault = await getVaultState(vId);
    if (!vault) throw new Error(`Vault ${vId} not found in keystore.`);

    const deviceSalt = decodeBase64url(vault.deviceSalt);
    const reg = await registerPasskey(vId, vault.userId);
    await updateCredentialId(vId, reg.credentialId);

    if (reg.prfSupported && reg.prfOutput) {
      const prfKek = await deriveKekFromPrf(reg.prfOutput, deviceSalt);
      const wrapped = await wrapDekWithKek(dek, prfKek);
      await updateWrappedDekPrf(vId, wrapped);
    }
    return { prfSupported: reg.prfSupported };
  }, [dek]);

  const onSetupPin = useCallback(async (vId: string, pin: string): Promise<void> => {
    if (!dek) throw new Error('Vault not unlocked.');
    const pinSalt = generatePinSalt();
    const kek = await deriveKekFromPin(pin, pinSalt);
    const wrapped = await wrapDekWithKek(dek, kek);
    await updateWrappedDekPin(vId, wrapped, encodeBase64url(pinSalt));
  }, [dek]);

  const onUnlockWithPasskey = useCallback(async (): Promise<void> => {
    if (!isWebAuthnAvailable()) throw new Error('WebAuthn is not available in this browser.');
    const vaults = await listVaultStates();
    const vault = vaults[0];
    if (!vault) throw new Error('No vault found on this device.');
    if (!vault.credentialId) {
      throw new Error('This vault has no registered passkey. Unlock with Recovery Secret.');
    }
    if (!vault.wrappedDekPrf) {
      throw new Error('No PRF-wrapped DEK stored. Unlock with Recovery Secret first.');
    }

    const deviceSalt = decodeBase64url(vault.deviceSalt);
    const prfOutput = await getPrfOutput(vault.credentialId, vault.vaultId);
    const prfKek = await deriveKekFromPrf(prfOutput, deviceSalt);
    const unwrapped = await unwrapDekWithKek(vault.wrappedDekPrf, prfKek);
    setDek(unwrapped);
    setVaultId(vault.vaultId);
  }, []);

  const onUnlockWithRS = useCallback(async (rs: Uint8Array): Promise<void> => {
    const vaults = await listVaultStates();
    const vault = vaults[0];
    if (!vault) throw new Error('No vault found on this device.');
    if (!vault.wrappedDekRs) throw new Error('Vault has no RS-wrapped DEK.');

    const deviceSalt = decodeBase64url(vault.deviceSalt);
    const kek = await deriveKekFromRs(rs, deviceSalt);
    const unwrapped = await unwrapDekWithKek(vault.wrappedDekRs, kek);
    setDek(unwrapped);
    setVaultId(vault.vaultId);
  }, []);

  const onUnlockWithPin = useCallback(async (pin: string): Promise<void> => {
    const vaults = await listVaultStates();
    const vault = vaults[0];
    if (!vault) throw new Error('No vault found on this device.');
    if (!vault.wrappedDekPin || !vault.pinSalt) {
      throw new Error('Vault has no PIN wrap.');
    }
    const pinSalt = decodeBase64url(vault.pinSalt);
    const kek = await deriveKekFromPin(pin, pinSalt);
    const unwrapped = await unwrapDekWithKek(vault.wrappedDekPin, kek);
    setDek(unwrapped);
    setVaultId(vault.vaultId);
  }, []);

  /**
   * Second-device join: server already has a `vault-state` doc; the user
   * provides the same Recovery Secret used at vault creation. We unwrap
   * the shared DEK locally, then materialise a local vault record that
   * mirrors the server's `vaultId` + `deviceSalt` so payload `kid` and
   * KEK derivation match across devices.
   */
  const onJoinVault = useCallback(async (rs: Uint8Array): Promise<void> => {
    if (!serverVaultState) throw new Error('No server-side vault-state to join.');
    const deviceSalt = decodeBase64url(serverVaultState.deviceSalt);
    const kek = await deriveKekFromRs(rs, deviceSalt);
    const unwrapped = await unwrapDekWithKek(serverVaultState.wrappedDekRs, kek);

    const oauth = pendingOAuth ?? readPendingOAuth();
    const userId = oauth?.couchdbUsername ?? `local-${serverVaultState.vaultId}`;

    const local: VaultState = {
      vaultId: serverVaultState.vaultId,
      deviceSalt: serverVaultState.deviceSalt,
      wrappedDekPrf: null,
      wrappedDekRs: serverVaultState.wrappedDekRs,
      credentialId: null,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rsConfirmed: true,
      metadata: createDefaultMetadata(),
    };
    await createVaultState(local);

    setVaultId(serverVaultState.vaultId);
    setDek(unwrapped);
    setHasExistingVault(true);
  }, [serverVaultState, pendingOAuth]);

  const onJoinWithRs = useCallback(
    async (rs: RecoverySecretResult): Promise<{ ok: true; vaultId: string } | { ok: false; reason: 'wrong-key' | 'invalid' }> => {
      try {
        if (hasExistingVault) {
          await onUnlockWithRS(rs.raw);
          const vaults = await listVaultStates();
          const v = vaults[0];
          if (!v) return { ok: false, reason: 'invalid' };
          return { ok: true, vaultId: v.vaultId };
        }
        if (!serverVaultState) return { ok: false, reason: 'invalid' };
        await onJoinVault(rs.raw);
        return { ok: true, vaultId: serverVaultState.vaultId };
      } catch (err) {
        console.warn('[AppShell] onJoinWithRs failed', err);
        return { ok: false, reason: 'wrong-key' };
      }
    },
    [hasExistingVault, serverVaultState, onUnlockWithRS, onJoinVault],
  );

  /**
   * Restore from one or more `.tricho-backup.zip` files. Reads the manifest +
   * vault-state from the first file, verifies the user's RS unwraps the
   * `wrappedDekRs` it carries, materialises a local vault-state record at the
   * same `vaultId`, opens PouchDB at that id, and applies all picked ZIPs in
   * filename order. Returns the new vaultId on success.
   */
  const onRestoreFromZip = useCallback(
    async (
      files: File[],
      rs: Uint8Array,
    ): Promise<{ ok: true; vaultId: string } | { ok: false; reason: string }> => {
      if (files.length === 0) {
        return { ok: false, reason: 'no-files' };
      }
      try {
        const firstBytes = new Uint8Array(await files[0]!.arrayBuffer());
        const unpacked = await unpackBackupZip(firstBytes);
        if (!unpacked.vaultState) {
          return { ok: false, reason: 'missing-vault-state' };
        }
        const zipVaultId = unpacked.vaultState.vaultId;
        const zipDeviceSalt = String(unpacked.vaultState.deviceSalt);
        const zipWrappedDekRsRaw = unpacked.vaultState.wrappedDekRs as
          | { ct: string; iv: string; version?: number }
          | undefined;
        if (!zipWrappedDekRsRaw || !zipWrappedDekRsRaw.ct || !zipWrappedDekRsRaw.iv) {
          return { ok: false, reason: 'missing-wrapped-dek' };
        }
        const zipWrappedDekRs: WrappedKeyData = createWrappedKeyData(
          zipWrappedDekRsRaw.ct,
          zipWrappedDekRsRaw.iv,
          zipWrappedDekRsRaw.version ?? 1,
        );
        const deviceSalt = decodeBase64url(zipDeviceSalt);
        const kek = await deriveKekFromRs(rs, deviceSalt);
        let unwrapped: Uint8Array;
        try {
          unwrapped = await unwrapDekWithKek(zipWrappedDekRs, kek);
        } catch {
          return { ok: false, reason: 'wrong-key' };
        }

        const oauth = pendingOAuth ?? readPendingOAuth();
        const userId = oauth?.couchdbUsername ?? `local-${zipVaultId}`;
        const local: VaultState = {
          vaultId: zipVaultId,
          deviceSalt: zipDeviceSalt,
          wrappedDekPrf: null,
          wrappedDekRs: zipWrappedDekRs,
          credentialId: null,
          userId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          rsConfirmed: true,
          metadata: createDefaultMetadata(),
        };
        await createVaultState(local);

        const dekKey = await importAesGcmKey(unwrapped, false, ['encrypt', 'decrypt']);
        const opened = await openVaultDb(zipVaultId, dekKey);

        // Apply all picked files in filename order.
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await restoreFromZipBytes({ db: opened, bytes, expectedVaultId: zipVaultId });
        }

        setVaultId(zipVaultId);
        setDek(unwrapped);
        setDb(opened);
        setHasExistingVault(true);
        return { ok: true, vaultId: zipVaultId };
      } catch (err) {
        console.error('[AppShell] onRestoreFromZip failed', err);
        return { ok: false, reason: (err as Error).message ?? 'unknown' };
      }
    },
    [pendingOAuth],
  );

  /**
   * After unlock: open PouchDB, materialise the TokenStore from the encrypted
   * identity doc (if any), otherwise seed it from a pending OAuth result, and
   * start sync.
   */
  const onUnlocked = useCallback(async () => {
    if (!dek || !vaultId) {
      setView('unlocked');
      return;
    }
    try {
      const dekKey = await importAesGcmKey(dek, false, ['encrypt', 'decrypt']);
      const opened = await openVaultDb(vaultId, dekKey);
      setDb(opened);

      const store = new TokenStore(opened);
      setTokenStore(store);

      // Prefer an already-persisted identity; fall back to an in-flight OAuth
      // result from this session.
      const existing = await store.load().catch(() => null);
      let identity = existing;
      if (!existing) {
        const oauth = pendingOAuth ?? readPendingOAuth();
        if (oauth?.deviceApproved && oauth.tokens) {
          await store.seedFromOAuth(oauth);
          identity = await store.load();
          stashPendingOAuth(null);
          setPendingOAuth(null);
        }
      }

      const resolvedUsername = store.couchdbUsername();
      setUsername(resolvedUsername);

      if (identity && store.couchdbUsername()) {
        // Upload vault-state for multi-device recovery.
        try {
          const vault = await getVaultState(vaultId);
          if (vault?.wrappedDekRs) {
            await uploadVaultState(opened, {
              vaultId,
              deviceSalt: vault.deviceSalt,
              wrappedDekRs: vault.wrappedDekRs,
              version: vault.wrappedDekRs.version,
            });
          }
        } catch (err) {
          console.warn('[AppShell] uploadVaultState failed', err);
        }

        void startSync(opened, {
          username: store.couchdbUsername()!,
          remoteUrl: userDbUrlFor(store.couchdbUsername()!),
          fetch: store.bearerFetch,
        });

        // Load subscription so the Plan/Settings screens have current data.
        void loadSubscription(store.jwt());
      }
    } catch (err) {
      console.error('[AppShell] onUnlocked failed', err);
    } finally {
      setView('unlocked');
    }
  }, [dek, vaultId, pendingOAuth]);

  useEffect(() => {
    return () => {
      stopSync();
      tokenStore?.dispose();
      void closeVaultDb();
    };
  }, [tokenStore]);

  // Watch sync state — when a 402 has gated us, raise a non-blocking flag
  // for the unlocked shell to render a `GatedSheet`. The user can keep
  // working offline; the sheet auto-reopens on the next launch if the gate
  // is still active. We DO NOT switch view to `plan` automatically anymore.
  useEffect(() => {
    return subscribeSyncEvents((s) => {
      if (s.status === 'gated') {
        if (tokenStore) void loadSubscription(tokenStore.jwt());
        setSyncGateState({ gated: true });
      } else {
        setSyncGateState({ gated: false });
      }
    });
  }, [tokenStore]);

  // E2E test bridge — gated on a localStorage sentinel so production users
  // never see it. Tests opt in by setting `tricho-e2e-bridge` to "1" before
  // navigation; the bridge exposes the same primitives the production UI
  // uses (no test-only behavior, just a stable handle by name).
  useEffect(() => {
    if (view !== 'unlocked') return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('tricho-e2e-bridge') !== '1') return;
    if (!db || !vaultId) return;
    const bridge = {
      vaultId,
      username,
      getSyncState,
      subscribeSyncEvents: (cb: (s: SyncState) => void) => subscribeSyncEvents(cb),
      putCustomer: async (data: Partial<CustomerData>): Promise<{ id: string; rev: string }> => {
        const dbRef = getVaultDb();
        if (!dbRef) throw new Error('vault db not open');
        const id = `customer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const full: CustomerData = {
          firstName: data.firstName ?? '',
          lastName: data.lastName ?? '',
          phone: data.phone,
          email: data.email,
          notes: data.notes,
          createdAt: data.createdAt ?? Date.now(),
          tags: data.tags,
          allergenIds: data.allergenIds,
        };
        return putEncrypted<CustomerData>(dbRef, {
          _id: id,
          type: DOC_TYPES.CUSTOMER,
          updatedAt: Date.now(),
          deleted: false,
          data: full,
        });
      },
      updateCustomer: async (id: string, patch: Partial<CustomerData>): Promise<{ id: string; rev: string }> => {
        const dbRef = getVaultDb();
        if (!dbRef) throw new Error('vault db not open');
        const existing = await getDecrypted<CustomerData>(dbRef, id);
        if (!existing) throw new Error(`customer ${id} not found`);
        return putEncrypted<CustomerData>(dbRef, {
          _id: id,
          _rev: existing._rev,
          type: DOC_TYPES.CUSTOMER,
          updatedAt: Date.now(),
          deleted: false,
          data: { ...existing.data, ...patch },
        });
      },
      getCustomer: async (id: string): Promise<CustomerData | null> => {
        const dbRef = getVaultDb();
        if (!dbRef) throw new Error('vault db not open');
        const got = await getDecrypted<CustomerData>(dbRef, id);
        return got?.data ?? null;
      },
      listCustomers: async (): Promise<Array<{ id: string; data: CustomerData }>> => {
        const dbRef = getVaultDb();
        if (!dbRef) throw new Error('vault db not open');
        const rows = await queryDecrypted<CustomerData>(dbRef, DOC_TYPES.CUSTOMER);
        return rows.map((r) => ({ id: r._id, data: r.data }));
      },
    };
    (window as unknown as { __trichoE2E?: typeof bridge }).__trichoE2E = bridge;
    return () => {
      delete (window as unknown as { __trichoE2E?: typeof bridge }).__trichoE2E;
    };
  }, [view, db, vaultId, username]);

  // Idle lock: clear in-memory secrets after inactivity; persistent identity
  // doc stays encrypted at rest so reopening is one biometric tap.
  useEffect(() => {
    if (view !== 'unlocked') return;
    const lock = new IdleLock({
      onLock: () => {
        void wipeSession({ tokenStore }).finally(() => {
          setDek(null);
          setDb(null);
          setTokenStore(null);
          setView('locked');
        });
      },
    });
    lock.start();
    return () => lock.stop();
  }, [view, tokenStore]);

  // Proactive token refresh on tab focus / coming back online so the user
  // never notices a mid-sync 401.
  useEffect(() => {
    if (!tokenStore) return;
    const onFocus = () => { void tokenStore.ensureFreshJwt(); };
    const onOnline = () => { void tokenStore.ensureFreshJwt(); };
    window.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [tokenStore]);

  const onVerifyRs = useCallback(async (rs: Uint8Array): Promise<boolean> => {
    if (!vaultId) return false;
    const vault = await getVaultState(vaultId);
    if (!vault?.wrappedDekRs) return false;
    try {
      const deviceSalt = decodeBase64url(vault.deviceSalt);
      const kek = await deriveKekFromRs(rs, deviceSalt);
      await unwrapDekWithKek(vault.wrappedDekRs, kek);
      return true;
    } catch {
      return false;
    }
  }, [vaultId]);

  const onWrapDekWithRs = useCallback(async (newRs: Uint8Array): Promise<WrappedKeyData> => {
    if (!dek || !vaultId) throw new Error('Vault not unlocked.');
    const vault = await getVaultState(vaultId);
    if (!vault) throw new Error('Vault not found.');
    const deviceSalt = decodeBase64url(vault.deviceSalt);
    const kek = await deriveKekFromRs(newRs, deviceSalt);
    const wrapped = await wrapDekWithKek(dek, kek);
    await updateWrappedDekRs(vaultId, wrapped);
    if (db) {
      try {
        await uploadVaultState(db, {
          vaultId,
          deviceSalt: vault.deviceSalt,
          wrappedDekRs: wrapped,
          version: wrapped.version,
        });
      } catch (err) {
        console.warn('[AppShell] uploadVaultState after rotation failed:', err);
      }
    }
    return wrapped;
  }, [dek, vaultId, db]);

  // ── Rendering ─────────────────────────────────────────────────────────
  if (view === 'loading') {
    return <div style={{ padding: 32 }}>Loading keystore…</div>;
  }

  if (view === 'locked' || (view === 'welcome' && hasExistingVault && dek === null)) {
    return (
      <LockedScreen
        hasPasskey={Boolean(vaultId) && lockedScreenHasPasskey}
        hasPin={lockedScreenHasPin}
        onUnlockWithPasskey={onUnlockWithPasskey}
        onUnlockWithPin={onUnlockWithPin}
        onUnlockWithRs={onUnlockWithRS}
        onUnlocked={onUnlocked}
      />
    );
  }

  if (view === 'welcome') {
    const oauth = pendingOAuth ?? readPendingOAuth();
    return (
      <WelcomeScreen
        authenticated={Boolean(oauth?.deviceApproved && oauth.tokens)}
        hasServerVaultState={serverVaultState !== null}
        onCreateVault={onCreateVault}
        onJoinWithRs={onJoinWithRs}
        onRegisterPasskey={onRegisterPasskey}
        onSetupPin={onSetupPin}
        onRestoreFromZip={onRestoreFromZip}
        oauthError={oauth?.error ?? null}
        onUnlocked={onUnlocked}
      />
    );
  }

  if (view === 'device-limit') {
    // The full DeviceLimitScreen — pre-unlock variant uses the OAuth-bound
    // JWT directly; the user can revoke another device or upgrade their
    // plan, then sign in again.
    const oauth = pendingOAuth ?? readPendingOAuth();
    const oauthJwt = oauth?.tokens?.jwt;
    return (
      <DeviceLimitScreen
        oauthJwt={oauthJwt}
        localDeviceId={oauth?.deviceId ?? null}
        onDeviceFreed={() => {
          stashPendingOAuth(null);
          setPendingOAuth(null);
          setAuthHint(null);
          setView('welcome');
        }}
        onCancel={() => {
          stashPendingOAuth(null);
          setPendingOAuth(null);
          setAuthHint(null);
          setView('welcome');
        }}
        onUpgrade={BILLING_UI_ENABLED ? () => setView('plan') : undefined}
      />
    );
  }

  if (view === 'settings' && db && username && vaultId && tokenStore) {
    return (
      <SettingsScreen
        vaultId={vaultId}
        db={db}
        username={username}
        tokenStore={tokenStore}
        onWrapDekWithRs={onWrapDekWithRs}
        onSetupPin={onSetupPin}
        onVerifyRs={onVerifyRs}
        onOpenRestoreZip={() => setView('restore-zip')}
        onAccountDeleted={async () => {
          // Wipe local IndexedDB databases and route to welcome.
          try {
            indexedDB.deleteDatabase('tricho-keystore');
            indexedDB.deleteDatabase('tricho_meta');
            if (vaultId) {
              indexedDB.deleteDatabase(`_pouch_${vaultId}`);
            }
          } catch (err) {
            console.warn('[AppShell] indexedDB.deleteDatabase failed', err);
          }
          await wipeSession({ tokenStore });
          setDek(null);
          setVaultId(null);
          setDb(null);
          setTokenStore(null);
          setPendingOAuth(null);
          setServerVaultState(null);
          setHasExistingVault(false);
          setView('welcome');
        }}
        onNeedsReauth={() => {
          // Stale JWT; route through OAuth again. wipeSession then welcome.
          void (async () => {
            await wipeSession({ tokenStore });
            setDek(null);
            setDb(null);
            setTokenStore(null);
            setPendingOAuth(null);
            setView('welcome');
          })();
        }}
        onClose={() => setView('unlocked')}
        onOpenPlan={BILLING_UI_ENABLED ? () => setView('plan') : undefined}
      />
    );
  }

  if (view === 'plan' && tokenStore) {
    return (
      <PlanScreen
        tokenStore={tokenStore}
        onBack={() => setView(db ? 'settings' : 'unlocked')}
        onRequestBankTransferIntent={(id) => {
          setBankIntentId(id);
          setView('bank-transfer');
        }}
        onOpenBackupExport={db && vaultId ? () => setView('backup-export') : undefined}
      />
    );
  }

  if (view === 'bank-transfer' && tokenStore && bankIntentId) {
    return (
      <BankTransferInstructions
        tokenStore={tokenStore}
        intentId={bankIntentId}
        onBack={() => setView('plan')}
        onPaid={() => {
          setBankIntentId(null);
          setView('plan');
        }}
      />
    );
  }

  if (view === 'backup-export' && db && vaultId) {
    return (
      <BackupExportScreen
        db={db}
        vaultId={vaultId}
        onBack={() => setView(tokenStore ? 'plan' : 'settings')}
      />
    );
  }

  if (view === 'restore-zip' && db) {
    return (
      <RestoreFromZipScreen
        db={db}
        expectedVaultId={vaultId ?? undefined}
        onBack={() => setView(tokenStore ? 'plan' : 'welcome')}
        onRestored={() => setView('unlocked')}
      />
    );
  }

  const onLogout = useCallback(async () => {
    await wipeSession({ tokenStore });
    setDek(null);
    setVaultId(null);
    setDb(null);
    setTokenStore(null);
    setPendingOAuth(null);
    setServerVaultState(null);
    setView('welcome');
  }, [tokenStore]);

  return (
    <UnlockedShell
      db={db}
      vaultId={vaultId}
      onSettings={() => setView('settings')}
      onLogout={onLogout}
      onOpenPlan={BILLING_UI_ENABLED ? () => setView('plan') : undefined}
      gated={syncGateState.gated}
    />
  );
}

interface UnlockedShellProps {
  db: VaultDb | null;
  vaultId: string | null;
  onSettings: () => void;
  onLogout: () => void | Promise<void>;
  onOpenPlan?: () => void;
  gated: boolean;
}

function UnlockedShell({ db, vaultId, onSettings, onLogout, onOpenPlan, gated }: UnlockedShellProps): JSX.Element {
  // Hash-based router: '#/clients/<id>' opens the client detail. Hash routing
  // keeps the app a single Astro static page (no per-id [id].astro needed)
  // and works on any static host without server-side rewrites.
  const [hash, setHash] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.hash : '',
  );

  useEffect(() => {
    bootstrapTheme();
    void bootstrapLocale();
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (!db || !vaultId) {
    return <div style={{ padding: 32 }}>{m.appShell_vaultUnavailable()}</div>;
  }

  const clientMatch = hash.match(/^#\/clients\/([^/?]+)/);
  const customerId = clientMatch ? decodeURIComponent(clientMatch[1]!) : null;
  const variant: 'a' | 'b' = customerId ? 'b' : 'a';

  return (
    <div className="phone phone--viewport">
      <div className="phone-inner">
        <ChromeButtons variant={variant} backHref="#/" />
        <UpdateBanner />
        {onOpenPlan && (
          <RenewBanner onTap={onOpenPlan} />
        )}
        {customerId ? (
          <ClientDetail db={db} vaultId={vaultId} customerId={customerId} />
        ) : (
          <DailySchedule db={db} />
        )}
        {gated && onOpenPlan && (
          <GatedSheet onRenew={onOpenPlan} />
        )}
        <BottomSheet
          renderers={{
            menu: () => (
              <MenuSheet
                onSettings={() => {
                  closeSheet();
                  onSettings();
                }}
                onLogout={() => {
                  closeSheet();
                  void onLogout();
                }}
              />
            ),
            'fab-add': (payload) => <FabAddSheet payload={payload} />,
            context: () => (
              <MenuSheet
                onSettings={() => {
                  closeSheet();
                  onSettings();
                }}
                onLogout={() => {
                  closeSheet();
                  void onLogout();
                }}
              />
            ),
          }}
        />
      </div>
      <style>{`
        .phone {
          background: var(--phone-frame);
          border-radius: 44px;
          padding: 8px;
          position: relative;
          overflow: hidden;
          box-shadow: var(--phone-shadow);
          width: 390px;
          margin: 24px auto;
        }
        .phone-inner {
          position: relative;
          background: var(--bg);
          border-radius: 38px;
          overflow: hidden;
          height: 780px;
        }
        .phone-inner::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: var(--paper-grain-svg);
          background-size: 200px 200px;
          mix-blend-mode: var(--paper-blend);
          opacity: var(--paper-opacity);
          pointer-events: none;
          z-index: 25;
        }
        .phone--viewport {
          width: 100%;
          max-width: 100vw;
          padding: 0;
          border-radius: 0;
          box-shadow: none;
          background: var(--bg);
          margin: 0;
        }
        .phone--viewport .phone-inner {
          border-radius: 0;
          height: 100vh;
          height: 100dvh;
        }
        @media (min-width: 480px) {
          .phone--viewport {
            width: 390px;
            margin: 24px auto;
            background: var(--phone-frame);
            border-radius: 44px;
            padding: 8px;
            box-shadow: var(--phone-shadow);
          }
          .phone--viewport .phone-inner {
            border-radius: 38px;
            height: 780px;
          }
        }
      `}</style>
    </div>
  );
}
