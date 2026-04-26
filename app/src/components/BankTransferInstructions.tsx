import React, { useEffect, useRef, useState } from 'react';
import { m, getLocale } from '../i18n';
import {
  fetchBankTransferIntent,
  cancelBankTransferIntent,
  formatAmount,
  type BankTransferIntent,
} from '../auth/subscription';
import { refreshSubscription } from '../lib/store/subscription';
import type { TokenStore } from '../auth/token-store';

const POLL_INTERVAL_MS = 30_000;

export interface BankTransferInstructionsProps {
  tokenStore: TokenStore;
  intentId: string;
  onBack: () => void;
  onPaid: () => void;
}

export function BankTransferInstructions({
  tokenStore,
  intentId,
  onBack,
  onPaid,
}: BankTransferInstructionsProps): JSX.Element {
  const [intent, setIntent] = useState<BankTransferIntent | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // initial fetch
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const jwt = tokenStore.jwt();
      if (!jwt) return;
      const next = await fetchBankTransferIntent(jwt, intentId);
      if (stopped) return;
      if (next) setIntent(next);
      if (next?.status === 'paid') {
        await refreshSubscription(jwt);
        onPaid();
      }
    };
    void tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [tokenStore, intentId, onPaid]);

  // QR rendering
  useEffect(() => {
    if (!intent || !canvasRef.current) return;
    let cancelled = false;
    void import('qrcode').then(({ default: QRCode }) => {
      if (cancelled || !canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, intent.qrCodePayload, { width: 220, margin: 1 }).catch(() => {
        // QR rendering failure is non-fatal — the textual instructions are sufficient.
      });
    });
    return () => {
      cancelled = true;
    };
  }, [intent]);

  const onCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  };

  const onCancelIntent = async () => {
    if (!intent || !tokenStore.jwt()) return;
    const ok = await cancelBankTransferIntent(tokenStore.jwt()!, intent.intentId);
    if (ok) onBack();
  };

  if (!intent) {
    return (
      <section style={containerStyle}>
        <p>…</p>
      </section>
    );
  }

  const locale = (getLocale() === 'cs' ? 'cs' : 'en') as 'cs' | 'en';
  const planLabel = renderPlanLabel(intent.plan);

  return (
    <section style={containerStyle} aria-labelledby="bt-instructions-title">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={iconBtnStyle} aria-label={m.billing_back()}>←</button>
        <h2 id="bt-instructions-title" style={{ margin: 0 }}>{planLabel}</h2>
      </header>

      <p style={{ margin: 0, color: '#555', fontSize: 14 }}>{m.billing_payInstructions()}</p>

      <dl style={dlStyle}>
        <Row
          label={m.billing_amount()}
          value={formatAmount(intent.amountMinor, intent.currency, locale)}
          onCopy={() => onCopy('amount', String(intent.amountMinor / 100))}
          copied={copied === 'amount'}
        />
        <Row
          label={m.billing_iban()}
          value={intent.iban}
          onCopy={() => onCopy('iban', intent.iban)}
          copyLabel={m.billing_copyIban()}
          copied={copied === 'iban'}
        />
        <Row
          label={m.billing_account()}
          value={intent.accountNumber}
          onCopy={() => onCopy('account', intent.accountNumber)}
          copyLabel={m.billing_copyAccount()}
          copied={copied === 'account'}
        />
        <Row
          label={m.billing_vs()}
          value={intent.vs}
          onCopy={() => onCopy('vs', intent.vs)}
          copyLabel={m.billing_copyVs()}
          copied={copied === 'vs'}
        />
      </dl>

      <p style={{ margin: 0, fontSize: 13, color: '#888' }}>{m.billing_orScanQr()}</p>
      <canvas ref={canvasRef} aria-label={m.billing_qrAlt()} style={{ alignSelf: 'center' }} />

      <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
        {m.billing_intentExpiresAt({ date: new Date(intent.expiresAt).toLocaleDateString() })}
      </p>

      {intent.status === 'pending' && (
        <p style={{ margin: 0, fontSize: 13, color: '#666', fontStyle: 'italic' }}>
          {m.billing_pendingPolling()}
        </p>
      )}

      <button onClick={onCancelIntent} style={cancelBtnStyle}>{m.billing_cancelIntent()}</button>
    </section>
  );
}

function Row({
  label,
  value,
  onCopy,
  copyLabel,
  copied,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copyLabel?: string;
  copied: boolean;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <dt style={dtStyle}>{label}</dt>
        <dd style={ddStyle}>{value}</dd>
      </div>
      <button onClick={onCopy} style={copyBtnStyle} aria-label={copyLabel ?? label}>
        {copied ? m.billing_copied() : '⎘'}
      </button>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  maxWidth: 480,
  margin: '0 auto',
};
const dlStyle: React.CSSProperties = {
  margin: 0,
  display: 'grid',
  gap: 8,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(0,0,0,0.06)',
};
const dtStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const ddStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 14,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const copyBtnStyle: React.CSSProperties = {
  background: 'rgba(0,122,255,0.08)',
  color: '#007aff',
  border: 'none',
  padding: '6px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 13,
};
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 8,
  cursor: 'pointer',
  fontSize: 18,
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(0,0,0,0.05)',
  border: '1px solid rgba(0,0,0,0.08)',
  cursor: 'pointer',
  fontSize: 14,
  color: '#555',
};

function renderPlanLabel(plan: 'pro-monthly' | 'pro-yearly' | 'max-monthly' | 'max-yearly'): string {
  const tier = plan.startsWith('pro') ? m.plan_tier_pro() : m.plan_tier_max();
  const period = plan.endsWith('monthly') ? m.plan_period_monthly() : m.plan_period_yearly();
  return `${tier} · ${period}`;
}
