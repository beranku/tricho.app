import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import type { TokenStore } from '../auth/token-store';
import {
  fetchDevices,
  revokeDevice,
  type DeviceListEntry,
  type OAuthSubscription,
} from '../auth/oauth';
import { localeStore, m } from '../i18n';

export interface DeviceLimitScreenProps {
  /** Post-unlock auth — uses the in-memory TokenStore for fresh JWT. */
  tokenStore?: TokenStore;
  /** Pre-unlock auth — JWT direct from the OAuth callback, before any
   *  vault is opened. Exactly one of `tokenStore` and `oauthJwt` MUST be
   *  provided. */
  oauthJwt?: string;
  /** Local device id, used to mark "this device" in the list and to block
   *  self-revocation. */
  localDeviceId?: string | null;
  onDeviceFreed: () => void;
  onCancel?: () => void;
  onUpgrade?: () => void;
}

function isProUpgradable(sub: OAuthSubscription | null): boolean {
  if (!sub) return false;
  // tierKey is the discriminator we read on `OAuthSubscription`. When
  // `tierKey === 'pro'`, upgrading to `max` is still possible. `max` users
  // have nowhere to go.
  const tierKey = (sub as { tierKey?: string }).tierKey;
  return tierKey === 'pro';
}

const sectionStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: '80px auto',
  padding: 32,
  borderRadius: 20,
  background: 'rgba(255,255,255,0.9)',
  boxShadow: '0 18px 40px rgba(15,23,42,0.18)',
};

export function DeviceLimitScreen({
  tokenStore,
  oauthJwt,
  localDeviceId,
  onDeviceFreed,
  onCancel,
  onUpgrade,
}: DeviceLimitScreenProps): JSX.Element {
  useStore(localeStore);
  const [devices, setDevices] = useState<DeviceListEntry[] | null>(null);
  const [subscription, setSubscription] = useState<OAuthSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the JWT for each call. Pre-unlock callers pass `oauthJwt`
  // directly; post-unlock callers pass a `TokenStore` whose JWT may need
  // refresh.
  const getJwt = useCallback(async (): Promise<string | null> => {
    if (tokenStore) {
      const ok = await tokenStore.ensureFreshJwt();
      if (!ok) return null;
      return tokenStore.jwt();
    }
    return oauthJwt ?? null;
  }, [tokenStore, oauthJwt]);

  const refresh = useCallback(async () => {
    setError(null);
    const jwt = await getJwt();
    if (!jwt) { setError(m.deviceLimit_sessionExpired_full()); return; }
    const result = await fetchDevices(jwt);
    if (!result) { setError(m.deviceLimit_loadDevicesError()); return; }
    setDevices(result.devices);
    setSubscription(result.subscription);
  }, [getJwt]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onRevoke = useCallback(async (deviceId: string) => {
    if (localDeviceId && deviceId === localDeviceId) {
      setError(m.deviceLimit_cannotRevokeSelf());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const jwt = await getJwt();
      if (!jwt) { setError(m.settings_sessionExpired()); return; }
      const revoked = await revokeDevice(jwt, deviceId);
      if (!revoked) { setError(m.deviceLimit_revokeFailed()); return; }
      onDeviceFreed();
    } finally {
      setBusy(false);
    }
  }, [getJwt, localDeviceId, onDeviceFreed]);

  return (
    <div style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>{m.deviceLimit_title()}</h2>
      <p style={{ color: '#555', fontSize: 14 }}>
        {subscription
          ? m.deviceLimit_descriptionWith({
              tier: subscription.tier,
              limit: subscription.deviceLimit,
            })
          : m.deviceLimit_descriptionWithout()}
      </p>

      {error && (
        <div role="alert" style={{ color: '#ff3b30', marginBottom: 12 }}>{error}</div>
      )}

      {devices === null ? (
        <p style={{ color: '#666' }}>{m.deviceLimit_loading()}</p>
      ) : devices.length === 0 ? (
        <p style={{ color: '#666' }}>{m.deviceLimit_noOtherDevices()}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {devices.map((d) => {
            const isCurrent = Boolean(localDeviceId && d.id === localDeviceId);
            return (
            <li
              key={d.id}
              data-testid={isCurrent ? 'device-row-current' : 'device-row'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 10,
                border: isCurrent ? '1px solid var(--copper-border, rgba(186,108,52,0.4))' : '1px solid rgba(0,0,0,0.08)',
                background: isCurrent ? 'rgba(186,108,52,0.06)' : 'rgba(255,255,255,0.7)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{d.name}</span>
                  {isCurrent && (
                    <span
                      data-testid="device-row-current-badge"
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: 'rgba(186,108,52,0.18)',
                        color: '#7a4519',
                        fontWeight: 500,
                      }}
                    >
                      {m.deviceLimit_currentDevice()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#999' }}>
                  {m.deviceLimit_addedAt({
                    date: new Date(d.addedAt).toLocaleString(),
                    seen: new Date(d.lastSeenAt).toLocaleString(),
                  })}
                </div>
              </div>
              <button
                disabled={busy || isCurrent}
                onClick={() => onRevoke(d.id)}
                title={isCurrent ? m.deviceLimit_cannotRevokeSelf() : undefined}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: isCurrent ? 'rgba(255,59,48,0.2)' : '#ff3b30',
                  color: '#fff',
                  border: 'none',
                  cursor: isCurrent ? 'not-allowed' : 'pointer',
                  opacity: busy || isCurrent ? 0.6 : 1,
                }}
              >
                {m.deviceLimit_revoke()}
              </button>
            </li>
            );
          })}
        </ul>
      )}

      {/*
        Upgrade ramp is shown for `free` or for paid subs whose tierKey is
        `pro` (i.e. there's still room to upgrade). Max users have nowhere
        to upgrade — revocation is the only path.
      */}
      {onUpgrade && (subscription?.tier === 'free' || isProUpgradable(subscription)) && (
        <button
          onClick={onUpgrade}
          data-testid="device-limit-upgrade-cta"
          style={{
            marginTop: 16,
            padding: '10px 16px',
            borderRadius: 10,
            background: '#007aff',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {m.deviceLimit_upgradeCta()}
        </button>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#007aff', cursor: 'pointer' }}
        >
          {m.deviceLimit_cancel()}
        </button>
      )}
    </div>
  );
}
