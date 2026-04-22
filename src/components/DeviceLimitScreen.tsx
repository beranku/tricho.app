import React, { useCallback, useEffect, useState } from 'react';
import type { TokenStore } from '../auth/token-store';
import {
  fetchDevices,
  revokeDevice,
  type DeviceListEntry,
  type OAuthSubscription,
} from '../auth/oauth';

export interface DeviceLimitScreenProps {
  tokenStore: TokenStore;
  onDeviceFreed: () => void;
  onCancel?: () => void;
}

const sectionStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: '80px auto',
  padding: 32,
  borderRadius: 20,
  background: 'rgba(255,255,255,0.9)',
  boxShadow: '0 18px 40px rgba(15,23,42,0.18)',
};

export function DeviceLimitScreen({ tokenStore, onDeviceFreed, onCancel }: DeviceLimitScreenProps): JSX.Element {
  const [devices, setDevices] = useState<DeviceListEntry[] | null>(null);
  const [subscription, setSubscription] = useState<OAuthSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const ok = await tokenStore.ensureFreshJwt();
    if (!ok) { setError('Session expired. Please sign in again.'); return; }
    const result = await fetchDevices(tokenStore.jwt()!);
    if (!result) { setError('Could not load devices.'); return; }
    setDevices(result.devices);
    setSubscription(result.subscription);
  }, [tokenStore]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onRevoke = useCallback(async (deviceId: string) => {
    setBusy(true);
    try {
      const ok = await tokenStore.ensureFreshJwt();
      if (!ok) { setError('Session expired.'); return; }
      const revoked = await revokeDevice(tokenStore.jwt()!, deviceId);
      if (!revoked) { setError('Revoke failed.'); return; }
      onDeviceFreed();
    } finally {
      setBusy(false);
    }
  }, [tokenStore, onDeviceFreed]);

  return (
    <div style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>Device limit reached</h2>
      <p style={{ color: '#555', fontSize: 14 }}>
        {subscription
          ? `Your ${subscription.tier} plan allows ${subscription.deviceLimit} devices.`
          : 'Your plan does not allow more devices.'}
        {' '}
        Revoke one of your existing devices to add this one, or upgrade.
      </p>

      {error && (
        <div role="alert" style={{ color: '#ff3b30', marginBottom: 12 }}>{error}</div>
      )}

      {devices === null ? (
        <p style={{ color: '#666' }}>Loading…</p>
      ) : devices.length === 0 ? (
        <p style={{ color: '#666' }}>No other devices found. Try again.</p>
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
                  added {new Date(d.addedAt).toLocaleString()} · last seen {new Date(d.lastSeenAt).toLocaleString()}
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
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#007aff', cursor: 'pointer' }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
