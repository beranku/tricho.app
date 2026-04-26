import React from 'react';
import { HandDrawnCheckIcon, LockIcon } from './icons';
import { m } from '../../i18n';

export type StepState = 'locked' | 'active' | 'done';

interface StepCardProps {
  step: 1 | 2 | 3;
  state: StepState;
  kicker: string;
  title: string;
  /** Right-slot content for the active state (substep back link). */
  headerRight?: React.ReactNode;
  /** Body content; only rendered while `state === 'active'`. */
  children?: React.ReactNode;
  /** data-* attributes for CSS-driven flow / substep styling. */
  flow?: 'new' | 'existing' | 'restore-zip';
  substep?: 'qr' | 'verify' | 'webauthn' | 'pin-setup' | 'pick-zip' | 'verify-rs';
}

/**
 * The shared step-card primitive. State tokens are encoded as
 * `data-state="locked|active|done"` so the design-system spec can lint
 * computed opacity per state without poking React internals.
 */
export function StepCard({
  step,
  state,
  kicker,
  title,
  headerRight,
  children,
  flow,
  substep,
}: StepCardProps): JSX.Element {
  const ariaLabel =
    state === 'locked'
      ? m.wizard_aria_step_locked()
      : state === 'done'
        ? m.wizard_aria_step_done()
        : m.wizard_aria_step_active();
  return (
    <section
      className="step-card"
      data-step={step}
      data-state={state}
      data-flow={flow}
      data-substep={substep}
      aria-label={`${title} — ${ariaLabel}`}
    >
      <header className="step-card__header">
        <div className="step-card__marker" aria-hidden="true">
          {state === 'done' ? (
            <HandDrawnCheckIcon className="step-card__check" />
          ) : (
            <span>{step}</span>
          )}
        </div>
        <div className="step-card__titles">
          <span className="step-card__kicker">{kicker}</span>
          <h2 className="step-card__title">{title}</h2>
        </div>
        <div className="step-card__header-right">
          {state === 'active' && headerRight}
          {state === 'locked' && (
            <span className="step-card__lock" aria-hidden="true">
              <LockIcon />
            </span>
          )}
        </div>
      </header>
      <div className="step-card__body">{state === 'active' && children}</div>
    </section>
  );
}
