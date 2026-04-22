import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LoginScreen } from './LoginScreen';
import { SettingsScreen } from './SettingsScreen';
import { SyncStatus } from './SyncStatus';
import { CustomerCRM } from './CustomerCRM';
import { PhotoCapture } from './PhotoCapture';
import { OAuthScreen } from './OAuthScreen';
import { DeviceLimitScreen } from './DeviceLimitScreen';
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
import { openVaultDb, closeVaultDb, type VaultDb } from '../db/pouch';
import { userDbUrlFor } from '../sync/couch-auth';
import { startSync, stopSync } from '../sync/couch';
import { uploadVaultState, downloadVaultState } from '../sync/couch-vault-state';
import {
  consumePendingOAuthResult,
  clearAuthCompleteHash,
  type OAuthResult,
} from '../auth/oauth';
import { TokenStore } from '../auth/token-store';
import { IdleLock } from '../sync/idle-lock';

type View = 'loading' | 'oauth' | 'login' | 'unlocked' | 'settings' | 'device-limit';

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
      // - No local vault, OAuth result present → create/restore flow.
      // - No local vault, no OAuth result → show OAuth screen.
      if (hasVault) {
        setView('login');
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

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>TrichoApp</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SyncStatus variant="compact" />
          {username && <button onClick={() => setView('settings')}>Settings</button>}
        </div>
      </header>
      {db && vaultId ? (
        <>
          <section style={{ background: 'rgba(255,255,255,0.8)', borderRadius: 16, padding: 24, boxShadow: '0 4px 18px rgba(0,0,0,0.05)', marginBottom: 16 }}>
            <CustomerCRM db={db} />
          </section>
          <section style={{ background: 'rgba(255,255,255,0.8)', borderRadius: 16, padding: 24, boxShadow: '0 4px 18px rgba(0,0,0,0.05)' }}>
            <PhotoCapture db={db} vaultId={vaultId} />
          </section>
          <section style={{ marginTop: 16, fontSize: 12, color: '#999' }}>
            Vault <code>{vaultId}</code>
            {username && <> · user <code>{username}</code></>}
          </section>
        </>
      ) : (
        <p>Vault not available.</p>
      )}
    </div>
  );
}
