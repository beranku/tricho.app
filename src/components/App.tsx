/**
 * App Shell Component
 *
 * The main application shell that handles:
 * - Authentication state routing
 * - Loading states
 * - Error boundaries
 * - Database readiness
 *
 * @module components/App
 *
 * @example
 * ```tsx
 * // In your Astro page or entry point:
 * import { App } from '@/components/App';
 *
 * <App client:load />
 * ```
 */

import React, { type ReactNode } from 'react';
import {
  AuthProvider,
  useAuth,
  useIsAuthenticated,
  useAuthState,
  useUser,
  useIsDatabaseReady,
  useAuthError,
  AuthState,
  type AuthContextType,
  type AuthUser,
} from '../context/AuthContext';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the App component
 */
export interface AppProps {
  /** Custom loading component */
  loadingComponent?: ReactNode;
  /** Custom error component */
  errorComponent?: (props: { error: string; onRetry: () => void }) => ReactNode;
  /** Component to show during setup */
  setupComponent?: ReactNode;
  /** Component to show when locked (login screen) */
  loginComponent?: ReactNode;
  /** Main app content (shown when authenticated) */
  children?: ReactNode;
}

/**
 * Props for AppContent (inner component after provider)
 */
interface AppContentProps extends AppProps {}

// ============================================================================
// Loading Component
// ============================================================================

/**
 * Default loading state component
 */
function DefaultLoading() {
  return (
    <div className="app-loading" role="status" aria-label="Loading application">
      <div className="app-loading-spinner">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="app-loading-icon"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      <p className="app-loading-text">Loading TrichoApp...</p>
    </div>
  );
}

// ============================================================================
// Error Component
// ============================================================================

/**
 * Props for default error component
 */
interface DefaultErrorProps {
  error: string;
  onRetry: () => void;
}

/**
 * Default error state component
 */
function DefaultError({ error, onRetry }: DefaultErrorProps) {
  return (
    <div className="app-error" role="alert">
      <div className="app-error-content">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="app-error-icon"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h2 className="app-error-title">Something went wrong</h2>
        <p className="app-error-message">{error}</p>
        <button type="button" className="app-error-retry" onClick={onRetry}>
          Try Again
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Default Placeholder Components
// ============================================================================

/**
 * Placeholder for setup screen (to be replaced with actual LoginScreen)
 */
function DefaultSetupPlaceholder() {
  const { startSetup } = useAuth();

  return (
    <div className="app-placeholder app-setup">
      <div className="app-placeholder-content">
        <h1>Welcome to TrichoApp</h1>
        <p>Your secure, offline-first CRM for hairdressers.</p>
        <p className="app-placeholder-note">
          Setup component not provided. Pass a setupComponent prop to App.
        </p>
        <button type="button" onClick={startSetup}>
          Start Setup
        </button>
      </div>
    </div>
  );
}

/**
 * Placeholder for login screen (to be replaced with actual LoginScreen)
 */
function DefaultLoginPlaceholder() {
  return (
    <div className="app-placeholder app-login">
      <div className="app-placeholder-content">
        <h1>TrichoApp</h1>
        <p>Please authenticate to continue.</p>
        <p className="app-placeholder-note">
          Login component not provided. Pass a loginComponent prop to App.
        </p>
      </div>
    </div>
  );
}

/**
 * Placeholder for main content
 */
function DefaultContentPlaceholder() {
  const { user, logout, lock } = useAuth();

  return (
    <div className="app-placeholder app-content">
      <div className="app-placeholder-content">
        <h1>Welcome, {user?.username || 'User'}!</h1>
        <p>You are authenticated.</p>
        <p className="app-placeholder-note">
          No children provided. Pass your app content as children to App.
        </p>
        <div className="app-placeholder-actions">
          <button type="button" onClick={lock}>
            Lock App
          </button>
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// App Content (Inner Component)
// ============================================================================

/**
 * Inner component that uses auth context to render appropriate view.
 */
function AppContent({
  loadingComponent,
  errorComponent,
  setupComponent,
  loginComponent,
  children,
}: AppContentProps) {
  const auth = useAuth();
  const {
    authState,
    error,
    isDatabaseReady,
    clearError,
  } = auth;

  // Handle error state
  const handleRetry = () => {
    clearError();
    // Force re-initialization by reloading
    window.location.reload();
  };

  // Render based on auth state
  switch (authState) {
    case AuthState.Loading:
      return <>{loadingComponent || <DefaultLoading />}</>;

    case AuthState.Error:
      if (errorComponent) {
        return <>{errorComponent({ error: error || 'Unknown error', onRetry: handleRetry })}</>;
      }
      return <DefaultError error={error || 'Unknown error'} onRetry={handleRetry} />;

    case AuthState.NeedsSetup:
      return <>{setupComponent || <DefaultSetupPlaceholder />}</>;

    case AuthState.Locked:
      return <>{loginComponent || <DefaultLoginPlaceholder />}</>;

    case AuthState.Authenticated:
      // Wait for database to be ready before showing content
      if (!isDatabaseReady) {
        return <>{loadingComponent || <DefaultLoading />}</>;
      }
      return <>{children || <DefaultContentPlaceholder />}</>;

    default:
      return <DefaultError error="Unknown application state" onRetry={handleRetry} />;
  }
}

// ============================================================================
// App Shell Error Boundary
// ============================================================================

/**
 * Error boundary state
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for the app shell
 */
class AppErrorBoundary extends React.Component<
  { children: ReactNode; fallback?: (props: { error: Error; reset: () => void }) => ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback?: (props: { error: Error; reset: () => void }) => ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error for debugging
    console.error('App error boundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.handleReset });
      }

      return (
        <div className="app-crash" role="alert">
          <div className="app-crash-content">
            <h1>Application Error</h1>
            <p>TrichoApp encountered an unexpected error.</p>
            <details>
              <summary>Error Details</summary>
              <pre>{this.state.error.message}</pre>
            </details>
            <button type="button" onClick={this.handleReset}>
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Main App Component
// ============================================================================

/**
 * Main App Shell Component.
 *
 * Provides authentication context and routes to appropriate screens
 * based on auth state (loading, setup, locked, authenticated).
 *
 * @param props - App props
 *
 * @example
 * ```tsx
 * // Basic usage with default components
 * <App />
 *
 * // With custom components
 * <App
 *   loadingComponent={<CustomLoader />}
 *   setupComponent={<SetupWizard />}
 *   loginComponent={<LoginScreen />}
 * >
 *   <MainContent />
 * </App>
 * ```
 */
export function App(props: AppProps) {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppContent {...props} />
      </AuthProvider>
    </AppErrorBoundary>
  );
}

// ============================================================================
// App Shell Sub-components (for composition)
// ============================================================================

/**
 * Component that only renders when authenticated.
 * Use inside App children.
 *
 * @example
 * ```tsx
 * <App>
 *   <AuthenticatedView>
 *     <Dashboard />
 *   </AuthenticatedView>
 * </App>
 * ```
 */
export function AuthenticatedView({ children }: { children: ReactNode }) {
  const { authState, isDatabaseReady } = useAuth();

  if (authState !== AuthState.Authenticated || !isDatabaseReady) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Component that only renders when locked (needs authentication).
 *
 * @example
 * ```tsx
 * <App>
 *   <LockedView>
 *     <LoginPrompt />
 *   </LockedView>
 * </App>
 * ```
 */
export function LockedView({ children }: { children: ReactNode }) {
  const { authState } = useAuth();

  if (authState !== AuthState.Locked) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Component that only renders during setup.
 *
 * @example
 * ```tsx
 * <App>
 *   <SetupView>
 *     <SetupWizard />
 *   </SetupView>
 * </App>
 * ```
 */
export function SetupView({ children }: { children: ReactNode }) {
  const { authState } = useAuth();

  if (authState !== AuthState.NeedsSetup) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Component that shows loading state.
 *
 * @example
 * ```tsx
 * <App>
 *   <LoadingView>
 *     <CustomSpinner />
 *   </LoadingView>
 * </App>
 * ```
 */
export function LoadingView({ children }: { children: ReactNode }) {
  const { authState } = useAuth();

  if (authState !== AuthState.Loading) {
    return null;
  }

  return <>{children}</>;
}

// ============================================================================
// Recovery Reminder Component
// ============================================================================

/**
 * Component that reminds user to save recovery QR if they haven't.
 * Shows a persistent banner until user confirms they've saved it.
 *
 * @example
 * ```tsx
 * <App>
 *   <RecoveryReminder onSaveRecovery={() => setShowQR(true)} />
 *   <MainContent />
 * </App>
 * ```
 */
export function RecoveryReminder({
  onSaveRecovery,
}: {
  onSaveRecovery: () => void;
}) {
  const { hasUnsavedRecovery, markRecoverySaved } = useAuth();

  if (!hasUnsavedRecovery) {
    return null;
  }

  return (
    <div className="recovery-reminder" role="alert">
      <div className="recovery-reminder-content">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div className="recovery-reminder-text">
          <strong>Save your Recovery Code!</strong>
          <span>Without it, you cannot recover your data if you lose access.</span>
        </div>
        <div className="recovery-reminder-actions">
          <button type="button" className="recovery-reminder-save" onClick={onSaveRecovery}>
            Save Now
          </button>
          <button type="button" className="recovery-reminder-dismiss" onClick={markRecoverySaved}>
            I've Saved It
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Database Ready Gate
// ============================================================================

/**
 * Component that waits for database to be ready before rendering children.
 * Shows a loading state while waiting.
 *
 * @example
 * ```tsx
 * <App>
 *   <DatabaseReadyGate>
 *     <CustomerList />
 *   </DatabaseReadyGate>
 * </App>
 * ```
 */
export function DatabaseReadyGate({
  children,
  loadingComponent,
}: {
  children: ReactNode;
  loadingComponent?: ReactNode;
}) {
  const { isDatabaseReady, authState } = useAuth();

  // Only show loading if authenticated but database not ready
  if (authState === AuthState.Authenticated && !isDatabaseReady) {
    return <>{loadingComponent || <DefaultLoading />}</>;
  }

  // Don't render if not authenticated
  if (authState !== AuthState.Authenticated) {
    return null;
  }

  return <>{children}</>;
}

// ============================================================================
// Exports
// ============================================================================

export default App;

// Re-export auth context for convenience
export {
  AuthProvider,
  useAuth,
  useIsAuthenticated,
  useAuthState,
  useUser,
  useIsDatabaseReady,
  useAuthError,
  AuthState,
  type AuthUser,
  type AuthContextType,
} from '../context/AuthContext';
