import React, { useState } from 'react';
import { startProviderLogin } from '../auth/oauth';

export interface OAuthScreenProps {
  onUnlockWithRecoverySecret?: () => void;
  hint?: string | null;
}

const sectionStyle: React.CSSProperties = {
  maxWidth: 420,
  margin: '120px auto',
  padding: 32,
  borderRadius: 20,
  background: 'rgba(255,255,255,0.85)',
  boxShadow: '0 18px 40px rgba(15,23,42,0.18)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
};

const buttonBase: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: 15,
  fontWeight: 500,
  borderRadius: 12,
  border: '1px solid rgba(0,0,0,0.1)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
};

export function OAuthScreen({ onUnlockWithRecoverySecret, hint }: OAuthScreenProps): JSX.Element {
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);

  return (
    <div style={sectionStyle}>
      <header style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>TrichoApp</h1>
        <p style={{ margin: 0, color: '#555', fontSize: 14 }}>
          Your private salon CRM. Encrypted on your device.
        </p>
      </header>

      {hint && (
        <p style={{ margin: '0 0 16px', padding: 12, borderRadius: 10, background: '#f2f2f7', fontSize: 13, color: '#555' }}>
          {hint}
        </p>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        <button
          style={{ ...buttonBase, background: '#fff', color: '#1f2937' }}
          disabled={busy !== null}
          onClick={() => {
            setBusy('google');
            startProviderLogin('google');
          }}
        >
          <span aria-hidden style={{ fontWeight: 700 }}>G</span>
          {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>
        <button
          style={{ ...buttonBase, background: '#000', color: '#fff', border: 'none' }}
          disabled={busy !== null}
          onClick={() => {
            setBusy('apple');
            startProviderLogin('apple');
          }}
        >
          <span aria-hidden style={{ fontWeight: 700 }}></span>
          {busy === 'apple' ? 'Redirecting…' : 'Continue with Apple'}
        </button>
      </div>

      {onUnlockWithRecoverySecret && (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button
            onClick={onUnlockWithRecoverySecret}
            style={{ background: 'transparent', border: 'none', color: '#007aff', cursor: 'pointer', fontSize: 13 }}
          >
            Already set up on this device? Unlock with Recovery Secret
          </button>
        </div>
      )}

      <footer style={{ marginTop: 28, textAlign: 'center', fontSize: 11, color: '#999' }}>
        Sign-in is used only for sync and device management. Your data is encrypted on this device before it leaves.
      </footer>
    </div>
  );
}
