import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import type { WrappedKeyData } from '../db/keystore';
import { getVaultState } from '../db/keystore';
import { startSync, stopSync, isSyncing, getSyncState, subscribeSyncEvents, type SyncState } from '../sync/couch';
import type { VaultDb } from '../db/pouch';
import { SyncStatus } from './SyncStatus';
import type { TokenStore } from '../auth/token-store';
import { fetchDevices, revokeDevice, type DeviceListEntry, type OAuthSubscription } from '../auth/oauth';
import { localeStore, m } from '../i18n';
import { PinSetupScreen } from './PinSetupScreen';
import { RotateRecoverySecret } from './RotateRecoverySecret';
import { ShowRecoverySecret } from './ShowRecoverySecret';
import { DeleteAccountModal } from './DeleteAccountModal';

export type WrapDekWithRsHandler = (rs: Uint8Array) => Promise<WrappedKeyData>;

export interface SettingsScreenProps {
  vaultId: string;
  db: VaultDb;
  username: string;
  onWrapDekWithRs: WrapDekWithRsHandler;
  /** Wraps the in-memory DEK under a PBKDF2-derived KEK and persists
   *  `wrappedDekPin` + `pinSalt`. Only relevant on non-PRF authenticators. */
  onSetupPin?: (vaultId: string, pin: string) => Promise<void>;
  /** Verifier for the "Show Recovery Secret" surface. Returns true iff the
   *  given RS bytes unwrap the local `wrappedDekRs`. */
  onVerifyRs?: (rs: Uint8Array) => Promise<boolean>;
  /** Opens the restore-from-ZIP surface. */
  onOpenRestoreZip?: () => void;
  /** Called after successful account deletion (server delete + local wipe).
   *  The caller MUST route to the welcome view. */
  onAccountDeleted?: () => Promise<void>;
  /** Called when account deletion needs a re-auth (stale JWT). The caller
   *  routes through the OAuth provider. */
  onNeedsReauth?: () => void;
  tokenStore?: TokenStore;
  onClose?: () => void;
  onOpenPlan?: () => void;
  className?: string;
}

interface PinAvailability {
  hasPrf: boolean;
  hasPin: boolean;
}

export function SettingsScreen({
  vaultId,
  db,
  username,
  onWrapDekWithRs,
  onSetupPin,
  onVerifyRs,
  onOpenRestoreZip,
  onAccountDeleted,
  onNeedsReauth,
  tokenStore,
  onClose,
  onOpenPlan,
  className,
}: SettingsScreenProps): JSX.Element {
  useStore(localeStore);
  const [syncOn, setSyncOn] = useState<boolean>(isSyncing);
  const [syncState, setSyncState] = useState<SyncState>(getSyncState);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const [lastRotation, setLastRotation] = useState<number | null>(null);

  const [devices, setDevices] = useState<DeviceListEntry[] | null>(null);
  const [subscription, setSubscription] = useState<OAuthSubscription | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const [pinAvail, setPinAvail] = useState<PinAvailability | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const reloadPinAvail = useCallback(async () => {
    const v = await getVaultState(vaultId);
    if (!v) return;
    setPinAvail({
      hasPrf: Boolean(v.wrappedDekPrf && v.credentialId),
      hasPin: Boolean(v.wrappedDekPin && v.pinSalt),
    });
  }, [vaultId]);

  useEffect(() => {
    void reloadPinAvail();
  }, [reloadPinAvail]);

  const onPinSubmit = useCallback(async (pin: string) => {
    if (!onSetupPin) return;
    setPinError(null);
    try {
      await onSetupPin(vaultId, pin);
      setPinModalOpen(false);
      await reloadPinAvail();
    } catch (err) {
      setPinError((err as Error).message);
    }
  }, [onSetupPin, vaultId, reloadPinAvail]);

  useEffect(() => subscribeSyncEvents(setSyncState), []);

  const loadDevices = useCallback(async () => {
    if (!tokenStore) return;
    setDevicesError(null);
    const ok = await tokenStore.ensureFreshJwt();
    if (!ok) { setDevicesError(m.settings_signedInError()); return; }
    const result = await fetchDevices(tokenStore.jwt()!);
    if (!result) { setDevicesError(m.settings_loadDevicesError()); return; }
    setDevices(result.devices);
    setSubscription(result.subscription);
  }, [tokenStore]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const toggleSync = useCallback(async () => {
    if (isSyncing()) {
      stopSync();
      setSyncOn(false);
    } else {
      const fetchOverride = tokenStore?.bearerFetch;
      await startSync(db, { username, fetch: fetchOverride });
      setSyncOn(true);
    }
  }, [db, username, tokenStore]);

  const [rotateModalOpen, setRotateModalOpen] = useState(false);
  const [showRsModalOpen, setShowRsModalOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  const onCommitRotation = useCallback(
    async (newRs: Uint8Array) => {
      setRotationError(null);
      try {
        const wrapped = await onWrapDekWithRs(newRs);
        setLastRotation(Date.now());
        return wrapped;
      } catch (err) {
        setRotationError((err as Error).message);
        throw err;
      }
    },
    [onWrapDekWithRs],
  );

  const onRevoke = useCallback(async (deviceId: string) => {
    if (!tokenStore) return;
    const ok = await tokenStore.ensureFreshJwt();
    if (!ok) { setDevicesError(m.settings_sessionExpired()); return; }
    const revoked = await revokeDevice(tokenStore.jwt()!, deviceId);
    if (!revoked) { setDevicesError(m.settings_revokeFailed()); return; }
    await loadDevices();
  }, [tokenStore, loadDevices]);

  return (
    <div
      className={className}
      style={{ maxWidth: 640, margin: '0 auto', padding: 24, display: 'grid', gap: 20 }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{m.settings_title()}</h2>
        {onClose && (
          <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>
            {m.settings_close()}
          </button>
        )}
      </header>

      {onOpenPlan && (
        <button
          onClick={onOpenPlan}
          style={{
            padding: 16,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(0,0,0,0.06)',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 4px' }}>{m.settings_planTitle()}</h3>
            <p style={{ margin: 0, color: '#555', fontSize: 13 }}>
              {subscription?.tier === 'paid'
                ? m.settings_planActiveUntil({
                    plan: prettyPlan(
                      (subscription as { tierKey?: string }).tierKey ?? 'paid',
                      (subscription as { billingPeriod?: 'month' | 'year' | null }).billingPeriod ?? null,
                    ),
                    date: subscription.paidUntil
                      ? new Date(subscription.paidUntil).toLocaleDateString()
                      : '—',
                  })
                : m.settings_planFreeBlurb()}
            </p>
          </div>
          <span style={{ color: '#999', fontSize: 18 }}>›</span>
        </button>
      )}

      <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 8px' }}>{m.settings_syncTitle()}</h3>
        <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
          {m.settings_syncDescription()}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={toggleSync}
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              border: 'none',
              background: syncOn ? '#ff3b30' : '#007aff',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {syncOn ? m.settings_syncStop() : m.settings_syncStart()}
          </button>
          <SyncStatus variant="compact" />
        </div>
      </section>

      {tokenStore && (
        <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)' }}>
          <h3 style={{ margin: '0 0 8px' }}>{m.settings_devicesTitle()}</h3>
          <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
            {m.settings_devicesPlanLine({
              tier: subscription?.tier ?? '—',
              limit: subscription?.deviceLimit ?? '—',
            })}
          </p>
          {devicesError && (
            <div role="alert" style={{ color: '#ff3b30', marginBottom: 8, fontSize: 13 }}>{devicesError}</div>
          )}
          {devices === null ? (
            <p style={{ color: '#666', fontSize: 13 }}>{m.settings_devicesLoading()}</p>
          ) : devices.length === 0 ? (
            <p style={{ color: '#666', fontSize: 13 }}>{m.settings_devicesEmpty()}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {devices.map((d) => (
                <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.05)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: '#999' }}>
                      {m.settings_devicesAddedAt({
                        date: new Date(d.addedAt).toLocaleDateString(),
                        seen: new Date(d.lastSeenAt).toLocaleDateString(),
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => onRevoke(d.id)}
                    style={{ padding: '6px 10px', borderRadius: 8, background: '#ff3b30', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12 }}
                  >
                    {m.settings_devicesRevoke()}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/*
        PIN setup is only relevant on non-PRF authenticators. When a passkey
        already provides PRF (the daily-unlock biometric path), an extra PIN
        is friction without security gain — the section is hidden.
      */}
      {pinAvail && !pinAvail.hasPrf && onSetupPin && (
        <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)' }} data-testid="settings-pin-section">
          <h3 style={{ margin: '0 0 8px' }}>{m.settings_pinTitle()}</h3>
          <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
            {pinAvail.hasPin ? m.settings_pinChangeDescription() : m.settings_pinSetupDescription()}
          </p>
          <button
            onClick={() => { setPinError(null); setPinModalOpen(true); }}
            style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#007aff', color: '#fff', cursor: 'pointer' }}
            data-testid="settings-pin-cta"
          >
            {pinAvail.hasPin ? m.settings_pinChangeButton() : m.settings_pinSetupButton()}
          </button>
        </section>
      )}

      {pinModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.4)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 50,
          }}
          data-testid="settings-pin-modal"
        >
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '90%' }}>
            <PinSetupScreen
              mode="setup"
              onSubmit={onPinSubmit}
              onCancel={() => setPinModalOpen(false)}
              error={pinError}
            />
          </div>
        </div>
      )}

      {onOpenRestoreZip && (
        <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)' }}>
          <h3 style={{ margin: '0 0 8px' }}>{m.settings_restoreZipTitle()}</h3>
          <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
            {m.settings_restoreZipDescription()}
          </p>
          <button
            onClick={onOpenRestoreZip}
            style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.85)', color: '#000', cursor: 'pointer' }}
            data-testid="settings-restore-zip-cta"
          >
            {m.settings_restoreZipButton()}
          </button>
        </section>
      )}

      {onVerifyRs && (
        <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)' }}>
          <h3 style={{ margin: '0 0 8px' }}>{m.settings_showRsTitle()}</h3>
          <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
            {m.settings_showRsDescription()}
          </p>
          <button
            onClick={() => setShowRsModalOpen(true)}
            style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#007aff', color: '#fff', cursor: 'pointer' }}
            data-testid="settings-show-rs-cta"
          >
            {m.settings_showRsButton()}
          </button>
        </section>
      )}

      {showRsModalOpen && onVerifyRs && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            overflow: 'auto',
            zIndex: 60,
          }}
          data-testid="settings-show-rs-modal"
        >
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 480, width: '92%', margin: '40px auto' }}>
            <ShowRecoverySecret onVerify={onVerifyRs} onClose={() => setShowRsModalOpen(false)} />
          </div>
        </div>
      )}

      {rotateModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            overflow: 'auto',
            zIndex: 60,
          }}
          data-testid="settings-rotate-rs-modal"
        >
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 480, width: '92%', margin: '40px auto' }}>
            <RotateRecoverySecret
              onCommit={onCommitRotation}
              onClose={() => setRotateModalOpen(false)}
            />
          </div>
        </div>
      )}

      <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 8px' }}>{m.settings_rsRotationTitle()}</h3>
        <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
          {m.settings_rsRotationDescription()}
        </p>
        <button
          onClick={() => { setRotationError(null); setRotateModalOpen(true); }}
          style={{
            padding: '8px 16px',
            borderRadius: 10,
            border: 'none',
            background: '#007aff',
            color: '#fff',
            cursor: 'pointer',
          }}
          data-testid="settings-rs-rotate-cta"
        >
          {m.settings_rsRotationButton()}
        </button>
        {lastRotation && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#34c759' }}>
            {m.settings_rsRotationSuccess({ time: new Date(lastRotation).toLocaleString() })}
          </div>
        )}
        {rotationError && (
          <div role="alert" style={{ marginTop: 8, color: '#ff3b30', fontSize: 13 }}>
            {rotationError}
          </div>
        )}
      </section>

      {tokenStore && onAccountDeleted && (
        <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,59,48,0.04)', border: '1px solid rgba(255,59,48,0.2)' }} data-testid="settings-delete-account-section">
          <h3 style={{ margin: '0 0 8px', color: '#7a1f1f' }}>{m.settings_deleteAccountTitle()}</h3>
          <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
            {m.settings_deleteAccountDescription()}
          </p>
          <button
            onClick={() => setDeleteAccountOpen(true)}
            data-testid="settings-delete-account-cta"
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              border: '1px solid rgba(255,59,48,0.4)',
              background: 'transparent',
              color: '#ff3b30',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {m.settings_deleteAccountButton()}
          </button>
        </section>
      )}

      {deleteAccountOpen && tokenStore && onAccountDeleted && (
        <DeleteAccountModal
          tokenStore={tokenStore}
          onCanceled={() => setDeleteAccountOpen(false)}
          onDeleted={async () => {
            setDeleteAccountOpen(false);
            await onAccountDeleted();
          }}
          onNeedsReauth={() => {
            setDeleteAccountOpen(false);
            onNeedsReauth?.();
          }}
        />
      )}

      <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#666' }}>
        <div>vault: <code>{vaultId}</code></div>
        <div>user: <code>{username}</code></div>
        <div>status: <code>{syncState.status}</code></div>
      </section>
    </div>
  );
}

function prettyPlan(tierKey: string, period: 'month' | 'year' | null): string {
  const tier = tierKey === 'pro' ? m.plan_tier_pro() : tierKey === 'max' ? m.plan_tier_max() : m.plan_tier_free();
  if (!period) return tier;
  return `${tier} · ${period === 'year' ? m.plan_period_yearly() : m.plan_period_monthly()}`;
}
