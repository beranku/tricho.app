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
  tokenStore: TokenStore;
  onDeviceFreed: () => void;
  onCancel?: () => void;
  onUpgrade?: () => void;
}

const sectionStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: '80px auto',
  padding: 32,
  borderRadius: 20,
  background: 'rgba(255,255,255,0.9)',
  boxShadow: '0 18px 40px rgba(15,23,42,0.18)',
};

export function DeviceLimitScreen({ tokenStore, onDeviceFreed, onCancel, onUpgrade }: DeviceLimitScreenProps): JSX.Element {
  useStore(localeStore);
  const [devices, setDevices] = useState<DeviceListEntry[] | null>(null);
  const [subscription, setSubscription] = useState<OAuthSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const ok = await tokenStore.ensureFreshJwt();
    if (!ok) { setError(m.deviceLimit_sessionExpired_full()); return; }
    const result = await fetchDevices(tokenStore.jwt()!);
    if (!result) { setError(m.deviceLimit_loadDevicesError()); return; }
    setDevices(result.devices);
    setSubscription(result.subscription);
  }, [tokenStore]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onRevoke = useCallback(async (deviceId: string) => {
    setBusy(true);
    try {
      const ok = await tokenStore.ensureFreshJwt();
      if (!ok) { setError(m.settings_sessionExpired()); return; }
      const revoked = await revokeDevice(tokenStore.jwt()!, deviceId);
      if (!revoked) { setError(m.deviceLimit_revokeFailed()); return; }
      onDeviceFreed();
    } finally {
      setBusy(false);
    }
  }, [tokenStore, onDeviceFreed]);

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
          {devices.map((d) => (
            <li
              key={d.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.08)',
                background: 'rgba(255,255,255,0.7)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{d.name}</div>
                <div style={{ fontSize: 11, color: '#999' }}>
                  {m.deviceLimit_addedAt({
                    date: new Date(d.addedAt).toLocaleString(),
                    seen: new Date(d.lastSeenAt).toLocaleString(),
                  })}
                </div>
              </div>
              <button
                disabled={busy}
                onClick={() => onRevoke(d.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: '#ff3b30',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {m.deviceLimit_revoke()}
              </button>
            </li>
          ))}
        </ul>
      )}

      {subscription?.tier === 'free' && onUpgrade && (
        <button
          onClick={onUpgrade}
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
