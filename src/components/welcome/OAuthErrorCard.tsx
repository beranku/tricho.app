import React from 'react';
import { useStore } from '@nanostores/react';
import { localeStore, m } from '../../i18n';

export interface OAuthErrorCardProps {
  errorClass: 'provider-cancelled' | 'provider-error' | 'device-blocked' | 'unknown';
}

/**
 * Inline error card rendered on Step 2 of the welcome wizard when the
 * OAuth callback returned a non-null `error`. Copper-amber border, single
 * humanised message, does not block the provider buttons.
 */
export function OAuthErrorCard({ errorClass }: OAuthErrorCardProps): JSX.Element {
  useStore(localeStore);
  const message =
    errorClass === 'provider-cancelled'
      ? m.oauthError_providerCancelled()
      : errorClass === 'provider-error'
      ? m.oauthError_providerError()
      : errorClass === 'device-blocked'
      ? m.oauthError_deviceBlocked()
      : m.oauthError_unknown();

  return (
    <div
      role="alert"
      data-testid="oauth-error-card"
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        border: '1px solid var(--copper-border, rgba(186,108,52,0.4))',
        background: 'var(--copper-tint, rgba(186,108,52,0.06))',
        color: 'var(--copper-mid, rgb(122,69,25))',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {message}
    </div>
  );
}
