import React from 'react';
import { m } from '../../i18n';

interface FinalCardProps {
  onOpenApp: () => void;
}

export function FinalCard({ onOpenApp }: FinalCardProps): JSX.Element {
  return (
    <section className="welcome-final" data-testid="wizard-final">
      <p className="welcome-final__welcome">{m.wizard_final_welcome()}</p>
      <p className="welcome-final__sub">{m.wizard_final_sub()}</p>
      <button
        type="button"
        className="btn btn--primary welcome-final__cta"
        onClick={onOpenApp}
        data-testid="wizard-final-cta"
      >
        {m.wizard_final_cta()}
      </button>
    </section>
  );
}
