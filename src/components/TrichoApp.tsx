/**
 * TrichoApp Root Component
 *
 * The main entry point for the TrichoApp React application.
 * This component wraps the App shell with all necessary child components
 * pre-configured, making it easy to use in Astro with a single client directive.
 *
 * @module components/TrichoApp
 *
 * @example
 * ```astro
 * ---
 * import TrichoApp from '../components/TrichoApp';
 * ---
 * <TrichoApp client:load />
 * ```
 */

import React from 'react';
import { App } from './App';
import { LoginScreen } from './LoginScreen';
import { MainContent } from './MainContent';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for TrichoApp component
 */
export interface TrichoAppProps {
  /** Optional class name for styling */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * TrichoApp Root Component
 *
 * Provides the complete TrichoApp experience with:
 * - Authentication provider and state management
 * - Setup flow with passkey registration
 * - Login flow with passkey authentication
 * - Main CRM content when authenticated
 * - Error boundaries for crash protection
 */
export function TrichoApp({ className = '' }: TrichoAppProps) {
  return (
    <div className={`tricho-app ${className}`.trim()}>
      <App
        setupComponent={<LoginScreen mode="setup" />}
        loginComponent={<LoginScreen mode="login" />}
      >
        <MainContent />
      </App>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default TrichoApp;
