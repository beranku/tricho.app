import React, { useEffect, useMemo, useState } from 'react';
import { m, getLocale } from '../i18n';
import {
  fetchPublicPlans,
  startStripeCheckout,
  createBankTransferIntent,
  formatAmount,
  type PublicPlan,
  type PaidPlanId,
} from '../auth/subscription';
import type { TokenStore } from '../auth/token-store';

export interface PlanPickerProps {
  tokenStore: TokenStore;
  onClose: () => void;
  onBankTransferIntent: (intentId: string) => void;
}

type Tier = 'pro' | 'max';
type Period = 'month' | 'year';

export function PlanPicker({ tokenStore, onClose, onBankTransferIntent }: PlanPickerProps): JSX.Element {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchPublicPlans().then(setPlans);
  }, []);

  const selectedPlanId = useMemo<PaidPlanId | null>(() => {
    if (!selectedTier) return null;
    return `${selectedTier}-${selectedPeriod === 'month' ? 'monthly' : 'yearly'}` as PaidPlanId;
  }, [selectedTier, selectedPeriod]);

  const selectedPlan = useMemo(() => {
    if (!selectedPlanId) return null;
    return plans.find((p) => p.id === selectedPlanId) ?? null;
  }, [plans, selectedPlanId]);

  const onCard = async () => {
    if (!selectedPlanId) return;
    setBusy(true);
    setError(null);
    try {
      const successUrl = `${window.location.origin}/?plan=ok`;
      const cancelUrl = window.location.href;
      const r = await startStripeCheckout(tokenStore.jwt() ?? '', { plan: selectedPlanId, successUrl, cancelUrl });
      if (r?.checkoutUrl) window.location.assign(r.checkoutUrl);
      else setError(m.plan_paymentFailed());
    } finally {
      setBusy(false);
    }
  };

  const onBank = async () => {
    if (!selectedPlanId) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await createBankTransferIntent(tokenStore.jwt() ?? '', selectedPlanId);
      if (intent?.intentId) {
        onBankTransferIntent(intent.intentId);
      } else {
        setError(m.plan_paymentFailed());
      }
    } finally {
      setBusy(false);
    }
  };

  const locale = (getLocale() === 'cs' ? 'cs' : 'en') as 'cs' | 'en';
  const proPlan = plans.find((p) => p.id === `pro-${selectedPeriod === 'month' ? 'monthly' : 'yearly'}`);
  const maxPlan = plans.find((p) => p.id === `max-${selectedPeriod === 'month' ? 'monthly' : 'yearly'}`);

  return (
    <div role="dialog" aria-modal="true" style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{m.plan_pickerTitle()}</h3>
          <button onClick={onClose} aria-label={m.common_close()} style={iconBtnStyle}>×</button>
        </header>

        {/* Period toggle */}
        <div style={periodTabsStyle} role="tablist" aria-label={m.plan_periodTabsLabel()}>
          <button
            role="tab"
            aria-selected={selectedPeriod === 'month'}
            onClick={() => setSelectedPeriod('month')}
            style={tabStyle(selectedPeriod === 'month')}
          >
            {m.plan_period_monthly()}
          </button>
          <button
            role="tab"
            aria-selected={selectedPeriod === 'year'}
            onClick={() => setSelectedPeriod('year')}
            style={tabStyle(selectedPeriod === 'year')}
          >
            {m.plan_period_yearly()}
          </button>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {proPlan && (
            <PlanRow
              plan={proPlan}
              selected={selectedTier === 'pro'}
              onClick={() => setSelectedTier('pro')}
              tierLabel={m.plan_tier_pro()}
              retentionLabel={m.plan_retention_12months()}
              locale={locale}
            />
          )}
          {maxPlan && (
            <PlanRow
              plan={maxPlan}
              selected={selectedTier === 'max'}
              onClick={() => setSelectedTier('max')}
              tierLabel={m.plan_tier_max()}
              retentionLabel={m.plan_retention_5years()}
              locale={locale}
            />
          )}
        </ul>

        {selectedPlan && (
          <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
            <button onClick={onCard} disabled={busy} style={primaryBtnStyle}>
              <div style={{ fontWeight: 600 }}>{m.plan_pickerCard()}</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{m.plan_pickerCardSubtitle()}</div>
            </button>
            <button onClick={onBank} disabled={busy} style={secondaryBtnStyle}>
              <div style={{ fontWeight: 600 }}>{m.plan_pickerBank()}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{m.plan_pickerBankSubtitle()}</div>
            </button>
          </div>
        )}

        {error && <div role="alert" style={errStyle}>{error}</div>}
      </div>
    </div>
  );
}

interface PlanRowProps {
  plan: PublicPlan;
  selected: boolean;
  onClick: () => void;
  tierLabel: string;
  retentionLabel: string;
  locale: 'cs' | 'en';
}

function PlanRow({ plan, selected, onClick, tierLabel, retentionLabel, locale }: PlanRowProps): JSX.Element {
  return (
    <li>
      <button
        onClick={onClick}
        style={{
          ...planRowStyle,
          borderColor: selected ? '#007aff' : 'rgba(0,0,0,0.1)',
          background: selected ? 'rgba(0,122,255,0.08)' : 'rgba(255,255,255,0.9)',
        }}
      >
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{tierLabel}</div>
          <div style={{ fontSize: 13, color: '#666' }}>
            {m.plan_devices({ count: plan.deviceLimit })} · {retentionLabel}
          </div>
        </div>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatAmount(plan.amountMinor, plan.currency, locale)}</div>
      </button>
    </li>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 16,
};
const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 16, padding: 16, maxWidth: 420, width: '100%',
};
const periodTabsStyle: React.CSSProperties = {
  display: 'flex', gap: 4, padding: 4, borderRadius: 10,
  background: 'rgba(0,0,0,0.04)', marginBottom: 12,
};
const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none',
  background: active ? '#fff' : 'transparent',
  color: active ? '#000' : '#555',
  fontWeight: active ? 600 : 500,
  cursor: 'pointer',
});
const planRowStyle: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)',
  background: 'rgba(255,255,255,0.9)', cursor: 'pointer',
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '12px 14px', borderRadius: 12, background: '#007aff', color: '#fff',
  border: 'none', cursor: 'pointer', textAlign: 'left',
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.95)',
  color: '#000', border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer', textAlign: 'left',
};
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer',
};
const errStyle: React.CSSProperties = {
  marginTop: 12, color: '#ff3b30', fontSize: 13, padding: '8px 12px',
  background: 'rgba(255,59,48,0.06)', borderRadius: 8,
};
