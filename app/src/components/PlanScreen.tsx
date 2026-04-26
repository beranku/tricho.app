import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { m } from '../i18n';
import { subscriptionStore, refreshSubscription, cancelSubscription } from '../lib/store/subscription';
import {
  daysRemaining,
  isInGrace,
  openStripePortal,
  type Subscription,
} from '../auth/subscription';
import type { TokenStore } from '../auth/token-store';
import { PlanPicker } from './PlanPicker';

export interface PlanScreenProps {
  tokenStore: TokenStore | null;
  onBack: () => void;
  onRequestBankTransferIntent?: (intentId: string) => void;
  onOpenBackupExport?: () => void;
}

export function PlanScreen({ tokenStore, onBack, onRequestBankTransferIntent, onOpenBackupExport }: PlanScreenProps): JSX.Element {
  const sub = useStore(subscriptionStore);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tokenStore) void refreshSubscription(tokenStore.jwt());
  }, [tokenStore]);

  const onManage = async () => {
    if (!tokenStore?.jwt()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await openStripePortal(tokenStore.jwt()!, window.location.href);
      if (r?.portalUrl) window.location.assign(r.portalUrl);
      else setError('Stripe portal unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!tokenStore?.jwt()) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await cancelSubscription(tokenStore.jwt()!);
      if (!ok) setError('Cancel failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={containerStyle} aria-labelledby="plan-screen-title">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={iconBtnStyle} aria-label={m.billing_back()}>←</button>
        <h2 id="plan-screen-title" style={{ margin: 0 }}>{m.plan_screenTitle()}</h2>
      </header>

      {sub == null ? (
        <p style={{ color: '#666' }}>…</p>
      ) : (
        <PlanCurrentState sub={sub} />
      )}

      {error && <div role="alert" style={errStyle}>{error}</div>}

      {sub != null && (
        <div style={{ display: 'grid', gap: 8 }}>
          {sub.tier === 'free' && (
            <button onClick={() => setPickerOpen(true)} style={primaryBtnStyle}>{m.plan_upgrade()}</button>
          )}
          {onOpenBackupExport && (
            <button onClick={onOpenBackupExport} style={secondaryBtnStyle}>{m.plan_localBackup_title()}</button>
          )}
          {sub.tier === 'paid' && sub.provider === 'stripe' && sub.status !== 'canceled' && (
            <>
              <button onClick={onManage} disabled={busy} style={secondaryBtnStyle}>
                {m.plan_manageSubscription()}
              </button>
              <button onClick={onCancel} disabled={busy} style={dangerBtnStyle}>
                {m.plan_cancel()}
              </button>
            </>
          )}
          {sub.tier === 'paid' && sub.provider === 'bank-transfer' && (
            <>
              <button onClick={() => setPickerOpen(true)} style={primaryBtnStyle}>
                {m.plan_payNextPeriod()}
              </button>
              {sub.status !== 'canceled' && (
                <button onClick={onCancel} disabled={busy} style={dangerBtnStyle}>
                  {m.plan_cancel()}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {pickerOpen && tokenStore && (
        <PlanPicker
          tokenStore={tokenStore}
          onClose={() => setPickerOpen(false)}
          onBankTransferIntent={(id) => {
            setPickerOpen(false);
            onRequestBankTransferIntent?.(id);
          }}
        />
      )}
    </section>
  );
}

function PlanCurrentState({ sub }: { sub: Subscription }): JSX.Element {
  const days = useMemo(() => daysRemaining(sub.paidUntil), [sub.paidUntil]);
  const grace = isInGrace(sub);
  const dateStr = (ts: number | null): string => (ts == null ? '—' : new Date(ts).toLocaleDateString());

  if (sub.tier === 'free') {
    return (
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px' }}>{m.plan_freeTitle()}</h3>
        <p style={{ margin: 0, color: '#555', fontSize: 14 }}>{m.plan_freeBlurb()}</p>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#888' }}>
          {m.plan_currentPlanLabel()}: <strong>{m.plan_tier_free()}</strong>
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#888' }}>
          {m.plan_currentRetentionLocal()}
        </p>
      </div>
    );
  }

  const planLabel = renderPlanLabel(sub.tierKey, sub.billingPeriod);
  if (grace) {
    return (
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px' }}>{m.plan_inGraceTitle()}</h3>
        <p style={{ margin: 0, color: '#555', fontSize: 14 }}>
          {m.plan_inGraceBody({ date: dateStr(sub.gracePeriodEndsAt) })}
        </p>
      </div>
    );
  }
  if (sub.status === 'canceled') {
    return (
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px' }}>{m.plan_canceledTitle({ date: dateStr(sub.paidUntil) })}</h3>
        <p style={{ margin: 0, color: '#555', fontSize: 14 }}>{planLabel}</p>
      </div>
    );
  }
  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 4px' }}>{planLabel}</h3>
      <p style={{ margin: 0, color: '#555', fontSize: 14 }}>
        {m.plan_paidUntil({ date: dateStr(sub.paidUntil) })}
      </p>
      <p style={{ margin: '4px 0 0', color: '#888', fontSize: 13 }}>
        {m.plan_daysRemaining({ days })}
      </p>
      <p style={{ margin: '4px 0 0', color: '#888', fontSize: 13 }}>
        {m.plan_currentRetention({ months: sub.backupRetentionMonths ?? 0 })}
      </p>
      <p style={{ margin: '4px 0 0', color: '#888', fontSize: 13 }}>
        {m.plan_devices({ count: sub.deviceLimit })}
      </p>
    </div>
  );
}

function renderPlanLabel(tierKey: 'free' | 'pro' | 'max', period: 'month' | 'year' | null): string {
  const tier = tierKey === 'pro' ? m.plan_tier_pro() : tierKey === 'max' ? m.plan_tier_max() : m.plan_tier_free();
  if (!period) return tier;
  const periodLabel = period === 'year' ? m.plan_period_yearly() : m.plan_period_monthly();
  return `${tier} · ${periodLabel}`;
}

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 16,
  maxWidth: 480,
  margin: '0 auto',
};
const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(0,0,0,0.06)',
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  background: '#007aff',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 15,
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: 'rgba(255,255,255,0.85)',
  color: '#000',
  cursor: 'pointer',
  fontSize: 15,
};
const dangerBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid rgba(255,59,48,0.3)',
  background: 'rgba(255,59,48,0.05)',
  color: '#ff3b30',
  cursor: 'pointer',
  fontSize: 14,
};
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 8,
  cursor: 'pointer',
  fontSize: 18,
};
const errStyle: React.CSSProperties = {
  color: '#ff3b30',
  fontSize: 13,
  padding: '8px 12px',
  background: 'rgba(255,59,48,0.06)',
  borderRadius: 8,
};
