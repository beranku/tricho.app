import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LoginScreen } from './LoginScreen';
import { SettingsScreen } from './SettingsScreen';
import { OAuthScreen } from './OAuthScreen';
import { DeviceLimitScreen } from './DeviceLimitScreen';
import { JoinVaultScreen } from './JoinVaultScreen';
import { ChromeButtons } from './islands/ChromeButtons';
import { BottomSheet } from './islands/BottomSheet';
import { MenuSheet, FabAddSheet } from './islands/MenuSheet';
import { DailySchedule } from './islands/DailySchedule';
import { ClientDetail } from './islands/ClientDetail';
import { openSheet, closeSheet } from '../lib/store/sheet';
import { bootstrapTheme } from '../lib/store/theme';
import {
  createVaultState,
  generateVaultId,
  createDefaultMetadata,
  createWrappedKeyData,
  updateWrappedDekRs,
  updateWrappedDekPrf,
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

type View = 'loading' | 'oauth' | 'login' | 'join_vault' | 'unlocked' | 'settings' | 'device-limit';

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
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [hasExistingVault, setHasExistingVault] = useState(false);
  const [dek, setDek] = useState<Uint8Array | null>(null);
  const [db, setDb] = useState<VaultDb | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [tokenStore, setTokenStore] = useState<TokenStore | null>(null);
  const [pendingOAuth, setPendingOAuth] = useState<OAuthResult | null>(() => readPendingOAuth());
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [serverVaultState, setServerVaultState] = useState<VaultStateDoc | null>(null);
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
      }

      const incoming = fresh ?? pendingOAuth;

      // Device-limit gate: server refused to approve this device for the user.
      if (incoming && !incoming.deviceApproved) {
        setAuthHint(`You have reached the device limit on your plan (${incoming.subscription?.deviceLimit ?? 2}). Revoke an existing device to add this one.`);
        setView('device-limit');
        routedOnceRef.current = true;
        return;
      }

      // Route:
      // - Vault already on device → go straight to unlock.
      // - No local vault, OAuth result present → probe server for an
      //   existing vault before defaulting to "create new vault". A hit
      //   means another device already created the vault for this user;
      //   we route to the join flow so we don't silently fork the data.
      // - No local vault, no OAuth result → show OAuth screen.
      if (hasVault) {
        setView('login');
      } else if (incoming?.tokens?.jwt && incoming.couchdbUsername) {
        let probed: VaultStateDoc | null = null;
        try {
          probed = await fetchVaultStateWithTimeout(
            incoming.couchdbUsername,
            incoming.tokens.jwt,
          );
        } catch (err) {
          console.warn('[AppShell] vault-state probe failed', err);
        }
        if (probed) {
          setServerVaultState(probed);
          setView('join_vault');
        } else {
          setView('login');
        }
      } else if (incoming) {
        setView('login');
      } else {
        setView('oauth');
      }
      routedOnceRef.current = true;
    })();
  }, []);

  const onCheckVault = useCallback(async () => {
    const vaults = await listVaultStates();
    const first = vaults[0];
    return { exists: Boolean(first), vaultId: first?.vaultId ?? null };
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

  const onRegisterPasskey = useCallback(async (vId: string): Promise<void> => {
    if (!isWebAuthnAvailable()) return;
    if (!dek) return;
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

  const onJoinSignOut = useCallback(() => {
    stashPendingOAuth(null);
    setPendingOAuth(null);
    setServerVaultState(null);
    setView('oauth');
  }, []);

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
        stopSync();
        setDek(null);
        if (tokenStore) void tokenStore.clear().catch(() => null);
        setDb(null);
        setTokenStore(null);
        setView('login');
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

  const onUnlockWithRecoverySecret = useCallback(() => {
    setAuthHint(null);
    setView('login');
  }, []);

  // ── Rendering ─────────────────────────────────────────────────────────
  if (view === 'loading') {
    return <div style={{ padding: 32 }}>Loading keystore…</div>;
  }

  if (view === 'oauth') {
    return (
      <OAuthScreen
        hint={authHint}
        onUnlockWithRecoverySecret={hasExistingVault ? onUnlockWithRecoverySecret : undefined}
      />
    );
  }

  if (view === 'login') {
    return (
      <LoginScreen
        onUnlocked={onUnlocked}
        hasExistingVault={hasExistingVault}
        vaultId={vaultId ?? undefined}
        onCheckVault={onCheckVault}
        onCreateVault={onCreateVault}
        onRegisterPasskey={onRegisterPasskey}
        onUnlockWithPasskey={onUnlockWithPasskey}
        onUnlockWithRS={onUnlockWithRS}
      />
    );
  }

  if (view === 'join_vault') {
    return (
      <JoinVaultScreen
        onJoinVault={async (rs) => {
          await onJoinVault(rs);
          await onUnlocked();
        }}
        onSignOut={onJoinSignOut}
      />
    );
  }

  if (view === 'device-limit') {
    // When the server refused a new device, we don't yet have a TokenStore
    // (no vault is open). Render a minimal explanation + the option to
    // re-sign-in; revocation UX requires an existing unlocked vault.
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', padding: 32, borderRadius: 20, background: 'rgba(255,255,255,0.9)', boxShadow: '0 18px 40px rgba(15,23,42,0.18)' }}>
        <h2 style={{ marginTop: 0 }}>Device limit reached</h2>
        <p style={{ color: '#555', fontSize: 14 }}>
          {authHint ?? 'Revoke an existing device to add this one.'}
        </p>
        <p style={{ color: '#555', fontSize: 13 }}>
          Open TrichoApp on one of your existing devices, open Settings → Devices, and revoke the one you no longer use. Then come back here and sign in again.
        </p>
        <button
          onClick={() => {
            stashPendingOAuth(null);
            setPendingOAuth(null);
            setAuthHint(null);
            setView('oauth');
          }}
          style={{ padding: '8px 16px', borderRadius: 10, background: '#007aff', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Back
        </button>
      </div>
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
        onClose={() => setView('unlocked')}
      />
    );
  }

  return <UnlockedShell db={db} vaultId={vaultId} onSettings={() => setView('settings')} />;
}

interface UnlockedShellProps {
  db: VaultDb | null;
  vaultId: string | null;
  onSettings: () => void;
}

function UnlockedShell({ db, vaultId, onSettings }: UnlockedShellProps): JSX.Element {
  // Hash-based router: '#/clients/<id>' opens the client detail. Hash routing
  // keeps the app a single Astro static page (no per-id [id].astro needed)
  // and works on any static host without server-side rewrites.
  const [hash, setHash] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.hash : '',
  );

  useEffect(() => {
    bootstrapTheme();
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (!db || !vaultId) {
    return <div style={{ padding: 32 }}>Trezor není dostupný.</div>;
  }

  const clientMatch = hash.match(/^#\/clients\/([^/?]+)/);
  const customerId = clientMatch ? decodeURIComponent(clientMatch[1]!) : null;
  const variant: 'a' | 'b' = customerId ? 'b' : 'a';

  return (
    <div className="phone phone--viewport">
      <div className="phone-inner">
        <ChromeButtons variant={variant} backHref="#/" />
        {customerId ? (
          <ClientDetail db={db} vaultId={vaultId} customerId={customerId} />
        ) : (
          <DailySchedule db={db} />
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
                  // Reload to reset auth state — IdleLock-style wipe.
                  window.location.reload();
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
                  window.location.reload();
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
