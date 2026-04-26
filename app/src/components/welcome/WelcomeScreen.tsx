import React from 'react';
import { OnboardingWizard, type OnboardingWizardProps } from './OnboardingWizard';

/**
 * Thin wrapper around `<OnboardingWizard>` so the route binding stays
 * decoupled from the wizard internals. AppShell mounts this component
 * whenever no vault is unlocked.
 */
export function WelcomeScreen(props: OnboardingWizardProps): JSX.Element {
  return <OnboardingWizard {...props} />;
}
