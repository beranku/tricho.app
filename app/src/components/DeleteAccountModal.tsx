import React, { useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import { localeStore, m } from '../i18n';
import { deleteAccount } from '../auth/oauth';
import type { TokenStore } from '../auth/token-store';

const CONFIRMATION_WORD = 'SMAZAT';

export interface DeleteAccountModalProps {
  tokenStore: TokenStore;
  onCanceled: () => void;
  /** Called after the server-side delete returned 200 AND local state has
   *  been wiped. Caller MUST then route to welcome. */
  onDeleted: () => Promise<void>;
  /** Called when the JWT is stale and the user must re-authenticate before
   *  deletion can proceed. The caller routes through the OAuth flow. */
  onNeedsReauth: () => void;
}

export function DeleteAccountModal({
  tokenStore,
  onCanceled,
  onDeleted,
  onNeedsReauth,
}: DeleteAccountModalProps): JSX.Element {
  useStore(localeStore);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(async () => {
    if (typed !== CONFIRMATION_WORD) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await tokenStore.ensureFreshJwt();
      if (!ok) {
        onNeedsReauth();
        return;
      }
      const jwt = tokenStore.jwt();
      if (!jwt) {
        onNeedsReauth();
        return;
      }
      const result = await deleteAccount(jwt);
      if (result.ok) {
        await onDeleted();
        return;
      }
      if (result.reason === 'stale_jwt') {
        onNeedsReauth();
        return;
      }
      setError(m.deleteAccount_error_server());
    } catch (err) {
      console.error('[DeleteAccountModal] failed', err);
      setError(m.deleteAccount_error_server());
    } finally {
      setBusy(false);
    }
  }, [typed, tokenStore, onDeleted, onNeedsReauth]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      data-testid="delete-account-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 80,
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          maxWidth: 420,
          width: '100%',
          padding: 24,
        }}
      >
        <h2
          id="delete-account-title"
          style={{
            margin: '0 0 8px',
            fontFamily: "'Fraunces', serif",
            fontSize: 20,
            color: '#7a1f1f',
          }}
        >
          {m.deleteAccount_title()}
        </h2>
        <p style={{ margin: '0 0 12px', color: '#555', fontSize: 14, lineHeight: 1.5 }}>
          {m.deleteAccount_body()}
        </p>
        <p style={{ margin: '0 0 8px', color: '#555', fontSize: 13 }}>
          {m.deleteAccount_typeToConfirm({ word: CONFIRMATION_WORD })}
        </p>
        <input
          type="text"
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={CONFIRMATION_WORD}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
          data-testid="delete-account-typed-input"
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.15)',
            fontSize: 16,
            letterSpacing: 1,
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <p role="alert" style={{ color: '#ff3b30', fontSize: 13, marginTop: 8 }}>
            {error}
          </p>
        )}
        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || typed !== CONFIRMATION_WORD}
            data-testid="delete-account-confirm"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: typed === CONFIRMATION_WORD && !busy ? '#ff3b30' : 'rgba(255,59,48,0.4)',
              color: '#fff',
              cursor: typed === CONFIRMATION_WORD && !busy ? 'pointer' : 'not-allowed',
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            {busy ? m.deleteAccount_busy() : m.deleteAccount_confirmCta()}
          </button>
          <button
            type="button"
            onClick={onCanceled}
            disabled={busy}
            data-testid="delete-account-cancel"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.1)',
              background: 'transparent',
              color: '#333',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {m.deleteAccount_cancel()}
          </button>
        </div>
      </div>
    </div>
  );
}
