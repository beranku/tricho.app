import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import type { WrappedKeyData } from '../db/keystore';
import { startSync, stopSync, isSyncing, getSyncState, subscribeSyncEvents, type SyncState } from '../sync/couch';
import type { VaultDb } from '../db/pouch';
import { SyncStatus } from './SyncStatus';
import type { TokenStore } from '../auth/token-store';
import { fetchDevices, revokeDevice, type DeviceListEntry, type OAuthSubscription } from '../auth/oauth';
import { localeStore, m } from '../i18n';

export type WrapDekWithRsHandler = (rs: Uint8Array) => Promise<WrappedKeyData>;

export interface SettingsScreenProps {
  vaultId: string;
  db: VaultDb;
  username: string;
  onWrapDekWithRs: WrapDekWithRsHandler;
  tokenStore?: TokenStore;
  onClose?: () => void;
  onOpenPlan?: () => void;
  className?: string;
}

export function SettingsScreen({
  vaultId,
  db,
  username,
  onWrapDekWithRs,
  tokenStore,
  onClose,
  onOpenPlan,
  className,
}: SettingsScreenProps): JSX.Element {
  useStore(localeStore);
  const [syncOn, setSyncOn] = useState<boolean>(isSyncing);
  const [syncState, setSyncState] = useState<SyncState>(getSyncState);
  const [rotationBusy, setRotationBusy] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const [lastRotation, setLastRotation] = useState<number | null>(null);

  const [devices, setDevices] = useState<DeviceListEntry[] | null>(null);
  const [subscription, setSubscription] = useState<OAuthSubscription | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);

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

  const rotateRs = useCallback(async () => {
    setRotationBusy(true);
    setRotationError(null);
    try {
      const freshRs = new Uint8Array(32);
      crypto.getRandomValues(freshRs);
      await onWrapDekWithRs(freshRs);
      setLastRotation(Date.now());
    } catch (err) {
      setRotationError((err as Error).message);
    } finally {
      setRotationBusy(false);
    }
  }, [onWrapDekWithRs]);

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

      <section style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 8px' }}>{m.settings_rsRotationTitle()}</h3>
        <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14 }}>
          {m.settings_rsRotationDescription()}
        </p>
        <button
          onClick={rotateRs}
          disabled={rotationBusy}
          style={{
            padding: '8px 16px',
            borderRadius: 10,
            border: 'none',
            background: '#007aff',
            color: '#fff',
            cursor: 'pointer',
            opacity: rotationBusy ? 0.6 : 1,
          }}
        >
          {rotationBusy ? m.settings_rsRotationBusy() : m.settings_rsRotationButton()}
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
