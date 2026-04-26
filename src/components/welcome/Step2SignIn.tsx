import React, { useState } from 'react';
import { startProviderLogin, type OAuthProvider } from '../../auth/oauth';
import { AppleLogo, GoogleLogo } from './icons';
import { m } from '../../i18n';

interface Step2SignInProps {
  /** Override for tests — defaults to `startProviderLogin`. */
  onStart?: (provider: OAuthProvider) => void;
}

export function Step2SignIn({ onStart }: Step2SignInProps): JSX.Element {
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const start = onStart ?? startProviderLogin;

  return (
    <div className="step2-signin">
      <div className="oauth-buttons">
        <button
          type="button"
          className="oauth-btn oauth-btn--apple"
          disabled={busy !== null}
          onClick={() => {
            setBusy('apple');
            start('apple');
          }}
          data-testid="wizard-step2-apple"
        >
          <AppleLogo className="oauth-btn__logo" />
          <span>{busy === 'apple' ? m.wizard_step2_redirecting() : m.wizard_step2_continueApple()}</span>
        </button>
        <button
          type="button"
          className="oauth-btn oauth-btn--google"
          disabled={busy !== null}
          onClick={() => {
            setBusy('google');
            start('google');
          }}
          data-testid="wizard-step2-google"
        >
          <GoogleLogo className="oauth-btn__logo" />
          <span>{busy === 'google' ? m.wizard_step2_redirecting() : m.wizard_step2_continueGoogle()}</span>
        </button>
      </div>
      <p className="oauth-footer">{m.wizard_step2_footer()}</p>
    </div>
  );
}
