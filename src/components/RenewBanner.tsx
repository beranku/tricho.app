import React, { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { m } from '../i18n';
import { subscriptionStore } from '../lib/store/subscription';
import { daysRemaining, isInGrace } from '../auth/subscription';

export interface RenewBannerProps {
  onTap: () => void;
}

const SHOW_WITHIN_DAYS = 7;

export function RenewBanner({ onTap }: RenewBannerProps): JSX.Element | null {
  const sub = useStore(subscriptionStore);
  const days = useMemo(() => daysRemaining(sub?.paidUntil ?? null), [sub?.paidUntil]);
  if (!sub || sub.tier !== 'paid') return null;
  const grace = isInGrace(sub);
  const showSoon = !grace && days > 0 && days <= SHOW_WITHIN_DAYS;
  if (!grace && !showSoon) return null;
  const label = grace
    ? m.plan_inGraceTitle()
    : m.plan_renewSoonBanner({ days });
  return (
    <button onClick={onTap} style={bannerStyle}>
      {label}
    </button>
  );
}

const bannerStyle: React.CSSProperties = {
  width: '100%',
  display: 'block',
  padding: '8px 12px',
  borderRadius: 10,
  background: 'rgba(255,149,0,0.12)',
  border: '1px solid rgba(255,149,0,0.4)',
  color: '#a8590f',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'center',
};
