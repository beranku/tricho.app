/**
 * Auth Context for TrichoApp
 *
 * Provides authentication state management across the React application.
 * Handles WebAuthn passkey authentication, PRF-based key derivation,
 * and recovery secret fallback flows.
 *
 * @module context/AuthContext
 *
 * @example
 * ```tsx
 * import { AuthProvider, useAuth } from '@/context/AuthContext';
 *
 * // Wrap your app with the provider
 * function Root() {
 *   return (
 *     <AuthProvider>
 *       <App />
 *     </AuthProvider>
 *   );
 * }
 *
 * // Use the auth context in components
 * function MyComponent() {
 *   const { isAuthenticated, user, login, logout } = useAuth();
 *
 *   if (!isAuthenticated) {
 *     return <LoginScreen onLogin={login} />;
 *   }
 *
 *   return <Dashboard user={user} />;
 * }
 * ```
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type { DerivedKek, DataEncryptionKey, RecoverySecret } from '../crypto/keys';
import type { UnlockResult, UnlockMethod, StoredDeviceCredentials } from '../auth/prf';
import { initDatabase, closeDatabase, DatabaseState, getDatabaseState } from '../db/index';
import { setupCollections } from '../db/schemas/index';

// ============================================================================
// Types
// ============================================================================

/**
 * Authentication state enum
 */
export enum AuthState {
  /** Initial loading state */
  Loading = 'loading',
  /** User needs to set up account (first time) */
  NeedsSetup = 'needs_setup',
  /** User is locked (needs to authenticate) */
  Locked = 'locked',
  /** User is authenticated and app is ready */
  Authenticated = 'authenticated',
  /** Authentication error occurred */
  Error = 'error',
}

/**
 * User information stored after authentication
 */
export interface AuthUser {
  /** User ID from auth service */
  userId: string;
  /** Username (email) */
  username: string;
  /** Credential ID used for authentication */
  credentialId?: string;
}

/**
 * Authentication context state
 */
export interface AuthContextState {
  /** Current authentication state */
  authState: AuthState;
  /** Authenticated user info (null if not authenticated) */
  user: AuthUser | null;
  /** Method used for last unlock (prf or rs) */
  unlockMethod: UnlockMethod | null;
  /** Whether PRF is supported on this device/browser */
  prfSupported: boolean;
  /** Error message if in error state */
  error: string | null;
  /** Whether the database is initialized */
  isDatabaseReady: boolean;
  /** Whether we have a recovery secret that needs to be shown */
  hasUnsavedRecovery: boolean;
}

/**
 * Authentication actions available through context
 */
export interface AuthContextActions {
  /** Start first-time setup flow */
  startSetup: () => void;
  /** Login with passkey (for existing users, requires RS for fallback) */
  login: (options: LoginOptions) => Promise<void>;
  /**
   * Login with passkey using PRF only (daily unlock flow).
   * Does not require recovery secret - PRF provides key material.
   * Returns true if successful, false if PRF failed (user needs recovery).
   */
  loginWithPrf: (options: PrfLoginOptions) => Promise<boolean>;
  /** Complete first-time setup */
  completeSetup: (result: SetupResult) => Promise<void>;
  /** Recover account using recovery secret */
  recoverWithSecret: (recoverySecret: RecoverySecret) => Promise<void>;
  /** Mark recovery as saved (user has saved their QR code) */
  markRecoverySaved: () => void;
  /** Lock the app (require re-authentication) */
  lock: () => Promise<void>;
  /** Logout and clear all local data */
  logout: () => Promise<void>;
  /** Clear any error state */
  clearError: () => void;
}

/**
 * Options for login
 */
export interface LoginOptions {
  /** Username for authentication */
  username: string;
  /** Recovery secret (required for RS fallback) */
  recoverySecret: RecoverySecret;
  /** Force a specific unlock method */
  forceMethod?: UnlockMethod;
  /** Device info for session tracking */
  deviceInfo?: string;
}

/**
 * Options for PRF-only login (daily unlock)
 * Recovery secret is optional - only needed if PRF fails
 */
export interface PrfLoginOptions {
  /** Username for authentication */
  username: string;
  /** Device info for session tracking */
  deviceInfo?: string;
}

/**
 * Result from first-time setup
 */
export interface SetupResult {
  /** User info from registration */
  user: AuthUser;
  /** Derived KEK from setup */
  kek: DerivedKek;
  /** Data encryption key */
  dek: DataEncryptionKey;
  /** Recovery secret to be saved */
  recoverySecret: RecoverySecret;
  /** Device salt for this device */
  deviceSalt: Uint8Array;
  /** PRF salt if PRF was used */
  prfSalt?: Uint8Array;
  /** Whether PRF was used during setup */
  prfSucceeded: boolean;
}

/**
 * Full auth context type
 */
export type AuthContextType = AuthContextState & AuthContextActions;

// ============================================================================
// Context
// ============================================================================

/**
 * Default context state
 */
const defaultState: AuthContextState = {
  authState: AuthState.Loading,
  user: null,
  unlockMethod: null,
  prfSupported: false,
  error: null,
  isDatabaseReady: false,
  hasUnsavedRecovery: false,
};

/**
 * Default context with no-op actions (for use outside provider)
 */
const defaultContext: AuthContextType = {
  ...defaultState,
  startSetup: () => {},
  login: async () => {},
  loginWithPrf: async () => false,
  completeSetup: async () => {},
  recoverWithSecret: async () => {},
  markRecoverySaved: () => {},
  lock: async () => {},
  logout: async () => {},
  clearError: () => {},
};

/**
 * React context for authentication state
 */
const AuthContext = createContext<AuthContextType>(defaultContext);

// ============================================================================
// Reducer
// ============================================================================

/**
 * Action types for auth reducer
 */
type AuthAction =
  | { type: 'INIT_LOADING' }
  | { type: 'INIT_NEEDS_SETUP'; payload: { prfSupported: boolean } }
  | { type: 'INIT_LOCKED'; payload: { prfSupported: boolean } }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; payload: { user: AuthUser; unlockMethod: UnlockMethod; prfSupported: boolean } }
  | { type: 'LOGIN_ERROR'; payload: { error: string } }
  | { type: 'SETUP_COMPLETE'; payload: { user: AuthUser; unlockMethod: UnlockMethod; prfSupported: boolean } }
  | { type: 'DATABASE_READY' }
  | { type: 'DATABASE_ERROR'; payload: { error: string } }
  | { type: 'MARK_RECOVERY_SAVED' }
  | { type: 'LOCK' }
  | { type: 'LOGOUT' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR'; payload: { error: string } };

/**
 * Auth state reducer
 */
function authReducer(state: AuthContextState, action: AuthAction): AuthContextState {
  switch (action.type) {
    case 'INIT_LOADING':
      return {
        ...state,
        authState: AuthState.Loading,
        error: null,
      };

    case 'INIT_NEEDS_SETUP':
      return {
        ...state,
        authState: AuthState.NeedsSetup,
        prfSupported: action.payload.prfSupported,
        error: null,
      };

    case 'INIT_LOCKED':
      return {
        ...state,
        authState: AuthState.Locked,
        prfSupported: action.payload.prfSupported,
        error: null,
      };

    case 'LOGIN_START':
      return {
        ...state,
        error: null,
      };

    case 'LOGIN_SUCCESS':
      return {
        ...state,
        authState: AuthState.Authenticated,
        user: action.payload.user,
        unlockMethod: action.payload.unlockMethod,
        prfSupported: action.payload.prfSupported,
        error: null,
      };

    case 'LOGIN_ERROR':
      return {
        ...state,
        authState: AuthState.Error,
        error: action.payload.error,
      };

    case 'SETUP_COMPLETE':
      return {
        ...state,
        authState: AuthState.Authenticated,
        user: action.payload.user,
        unlockMethod: action.payload.unlockMethod,
        prfSupported: action.payload.prfSupported,
        hasUnsavedRecovery: true,
        error: null,
      };

    case 'DATABASE_READY':
      return {
        ...state,
        isDatabaseReady: true,
      };

    case 'DATABASE_ERROR':
      return {
        ...state,
        authState: AuthState.Error,
        error: action.payload.error,
        isDatabaseReady: false,
      };

    case 'MARK_RECOVERY_SAVED':
      return {
        ...state,
        hasUnsavedRecovery: false,
      };

    case 'LOCK':
      return {
        ...state,
        authState: AuthState.Locked,
        isDatabaseReady: false,
      };

    case 'LOGOUT':
      return {
        ...defaultState,
        authState: AuthState.NeedsSetup,
        prfSupported: state.prfSupported,
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null,
        authState: state.authState === AuthState.Error ? AuthState.Locked : state.authState,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload.error,
        authState: AuthState.Error,
      };

    default:
      return state;
  }
}

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  /** Stored user credentials */
  USER: 'tricho:user',
  /** Wrapped DEK */
  WRAPPED_DEK: 'tricho:wrapped_dek',
  /** Device credentials (salt, PRF info) */
  DEVICE_CREDS: 'tricho:device_creds',
  /** Recovery export confirmation */
  RECOVERY_EXPORTED: 'tricho:recovery_exported',
  /** Account exists flag */
  ACCOUNT_EXISTS: 'tricho:account_exists',
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an account exists on this device
 */
function hasExistingAccount(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  return localStorage.getItem(STORAGE_KEYS.ACCOUNT_EXISTS) === 'true';
}

/**
 * Check if recovery has been exported
 */
function hasRecoveryBeenExported(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  return localStorage.getItem(STORAGE_KEYS.RECOVERY_EXPORTED) === 'true';
}

/**
 * Mark account as existing
 */
function markAccountExists(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.ACCOUNT_EXISTS, 'true');
  }
}

/**
 * Save user info to storage
 */
function saveUserToStorage(user: AuthUser): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  }
}

/**
 * Load user info from storage
 */
function loadUserFromStorage(): AuthUser | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const data = localStorage.getItem(STORAGE_KEYS.USER);
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Clear all auth data from storage
 */
function clearAuthStorage(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.WRAPPED_DEK);
    localStorage.removeItem(STORAGE_KEYS.DEVICE_CREDS);
    localStorage.removeItem(STORAGE_KEYS.RECOVERY_EXPORTED);
    localStorage.removeItem(STORAGE_KEYS.ACCOUNT_EXISTS);
  }
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Props for AuthProvider
 */
export interface AuthProviderProps {
  children: ReactNode;
  /** Optional initial PRF support check result */
  initialPrfSupported?: boolean;
}

/**
 * Authentication provider component.
 * Wraps the app and provides auth state management.
 *
 * @param props - Provider props
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <AuthProvider>
 *       <Router>
 *         <Routes />
 *       </Router>
 *     </AuthProvider>
 *   );
 * }
 * ```
 */
export function AuthProvider({ children, initialPrfSupported = false }: AuthProviderProps) {
  const [state, dispatch] = useReducer(authReducer, {
    ...defaultState,
    prfSupported: initialPrfSupported,
  });

  // Track the current DEK for database operations
  const dekRef = React.useRef<DataEncryptionKey | null>(null);

  // ========================================================================
  // Initialization
  // ========================================================================

  useEffect(() => {
    async function initialize() {
      dispatch({ type: 'INIT_LOADING' });

      try {
        // Check PRF capabilities
        let prfSupported = initialPrfSupported;

        // Dynamically import to avoid SSR issues
        if (typeof window !== 'undefined') {
          try {
            const { getPrfCapabilities } = await import('../auth/prf');
            const capabilities = await getPrfCapabilities();
            prfSupported = capabilities.prfLikelyAvailable;
          } catch {
            // PRF check failed, continue without it
          }
        }

        // Check if account exists
        if (hasExistingAccount()) {
          // User has an account, needs to unlock
          dispatch({ type: 'INIT_LOCKED', payload: { prfSupported } });
        } else {
          // New user, needs setup
          dispatch({ type: 'INIT_NEEDS_SETUP', payload: { prfSupported } });
        }
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload: { error: error instanceof Error ? error.message : 'Initialization failed' },
        });
      }
    }

    initialize();
  }, [initialPrfSupported]);

  // ========================================================================
  // Actions
  // ========================================================================

  /**
   * Start the setup flow
   */
  const startSetup = useCallback(() => {
    dispatch({ type: 'INIT_NEEDS_SETUP', payload: { prfSupported: state.prfSupported } });
  }, [state.prfSupported]);

  /**
   * Login with passkey
   */
  const login = useCallback(async (options: LoginOptions) => {
    dispatch({ type: 'LOGIN_START' });

    try {
      // Dynamically import auth modules
      const { unlockWithPasskey } = await import('../auth/prf');
      const { unwrapDek, deserializeWrappedDek } = await import('../crypto/keys');
      const { base64urlDecode } = await import('../crypto/utils');

      // Get stored wrapped DEK
      const wrappedDekStr = localStorage.getItem(STORAGE_KEYS.WRAPPED_DEK);
      if (!wrappedDekStr) {
        throw new Error('No wrapped DEK found. Please recover your account.');
      }

      // Attempt unlock
      const result: UnlockResult = await unlockWithPasskey(options.username, {
        recoverySecret: options.recoverySecret,
        forceMethod: options.forceMethod,
        deviceInfo: options.deviceInfo,
      });

      // Unwrap DEK (decode from base64url first)
      const wrappedDekBytes = base64urlDecode(wrappedDekStr);
      const wrappedDek = deserializeWrappedDek(wrappedDekBytes);
      const dek = await unwrapDek(wrappedDek, result.kek.key);

      // Store DEK reference
      dekRef.current = dek;

      // Initialize database
      const { db } = await initDatabase({ dek });
      await setupCollections(db);

      // Get or create user info
      const storedUser = loadUserFromStorage();
      const user: AuthUser = storedUser || {
        userId: result.authResult.userId || options.username,
        username: options.username,
        credentialId: result.authResult.credentialId,
      };

      // Save user if not already saved
      if (!storedUser) {
        saveUserToStorage(user);
      }

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: {
          user,
          unlockMethod: result.unlockMethod,
          prfSupported: result.prfSucceeded,
        },
      });

      dispatch({ type: 'DATABASE_READY' });
    } catch (error) {
      dispatch({
        type: 'LOGIN_ERROR',
        payload: { error: error instanceof Error ? error.message : 'Login failed' },
      });
    }
  }, []);

  /**
   * Login with passkey using PRF only (daily unlock flow).
   * This is the preferred method for returning users when PRF is supported.
   * Does not require recovery secret - PRF provides key material directly.
   *
   * @returns true if PRF login succeeded, false if PRF failed (user needs recovery)
   */
  const loginWithPrf = useCallback(async (options: PrfLoginOptions): Promise<boolean> => {
    dispatch({ type: 'LOGIN_START' });

    try {
      // Dynamically import auth modules
      const { authenticateWithPasskey } = await import('../auth/passkey');
      const { loadStoredCredentials, saveStoredCredentials, createStoredCredentials } = await import('../auth/prf');
      const { deriveKekFromPRF, unwrapDek, deserializeWrappedDek, generateDeviceSalt } = await import('../crypto/keys');
      const { base64urlDecode, base64urlEncode } = await import('../crypto/utils');

      // Get stored wrapped DEK
      const wrappedDekStr = localStorage.getItem(STORAGE_KEYS.WRAPPED_DEK);
      if (!wrappedDekStr) {
        dispatch({
          type: 'LOGIN_ERROR',
          payload: { error: 'No account data found. Please recover your account.' },
        });
        return false;
      }

      // Load stored device credentials for PRF salt
      const storedCreds = loadStoredCredentials();
      let deviceSalt: Uint8Array;
      let prfSalt: Uint8Array;

      if (storedCreds) {
        deviceSalt = base64urlDecode(storedCreds.deviceSalt);
        prfSalt = storedCreds.prfSalt ? base64urlDecode(storedCreds.prfSalt) : deviceSalt;
      } else {
        // No stored credentials - generate new ones
        deviceSalt = generateDeviceSalt();
        prfSalt = deviceSalt;
      }

      // Attempt passkey authentication with PRF
      const authResult = await authenticateWithPasskey(options.username, {
        prfSalt,
        deviceInfo: options.deviceInfo,
      });

      // Check if PRF succeeded
      if (!authResult.prfSupported || !authResult.prfOutput) {
        // PRF not available - user needs to use recovery flow
        dispatch({
          type: 'LOGIN_ERROR',
          payload: { error: 'PRF not supported on this device. Please use recovery QR code.' },
        });
        return false;
      }

      // Derive KEK from PRF output
      const kek = await deriveKekFromPRF(authResult.prfOutput, deviceSalt);

      // Unwrap DEK
      const wrappedDekBytes = base64urlDecode(wrappedDekStr);
      const wrappedDek = deserializeWrappedDek(wrappedDekBytes);
      const dek = await unwrapDek(wrappedDek, kek);

      // Store DEK reference
      dekRef.current = dek;

      // Initialize database
      const { db } = await initDatabase({ dek });
      await setupCollections(db);

      // Get or create user info
      const storedUser = loadUserFromStorage();
      const user: AuthUser = storedUser || {
        userId: authResult.userId || options.username,
        username: options.username,
        credentialId: authResult.credentialId,
      };

      // Save user if not already saved
      if (!storedUser) {
        saveUserToStorage(user);
      }

      // Update stored credentials with latest unlock info
      const newCreds = createStoredCredentials(
        {
          unlockMethod: 'prf',
          kek: { key: kek, source: 'prf', deviceSalt },
          deviceSalt,
          prfSalt,
          prfSucceeded: true,
          authResult,
        },
        user.userId
      );
      saveStoredCredentials(newCreds);

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: {
          user,
          unlockMethod: 'prf',
          prfSupported: true,
        },
      });

      dispatch({ type: 'DATABASE_READY' });
      return true;
    } catch (error) {
      // Check if this is a decryption error (wrong KEK)
      const errorMessage = error instanceof Error ? error.message : 'Login failed';

      // If DEK unwrap failed, it might mean:
      // 1. PRF output changed (different authenticator used)
      // 2. Device salt doesn't match
      // User needs to use recovery flow
      if (errorMessage.includes('decrypt') || errorMessage.includes('unwrap') || errorMessage.includes('tag')) {
        dispatch({
          type: 'LOGIN_ERROR',
          payload: { error: 'Unable to decrypt data. Please use recovery QR code to restore access.' },
        });
        return false;
      }

      dispatch({
        type: 'LOGIN_ERROR',
        payload: { error: errorMessage },
      });
      return false;
    }
  }, []);

  /**
   * Complete first-time setup
   */
  const completeSetup = useCallback(async (result: SetupResult) => {
    try {
      // Store DEK reference
      dekRef.current = result.dek;

      // Wrap DEK with KEK
      const { wrapDek, serializeWrappedDek } = await import('../crypto/keys');
      const { base64urlEncode } = await import('../crypto/utils');
      const wrappedDek = await wrapDek(result.dek, result.kek.key);
      const wrappedDekBytes = serializeWrappedDek(wrappedDek);
      const wrappedDekStr = base64urlEncode(wrappedDekBytes);

      // Save to storage
      localStorage.setItem(STORAGE_KEYS.WRAPPED_DEK, wrappedDekStr);
      saveUserToStorage(result.user);
      markAccountExists();

      // Save device credentials
      const { createStoredCredentials, saveStoredCredentials } = await import('../auth/prf');
      const storedCreds: StoredDeviceCredentials = createStoredCredentials(
        {
          unlockMethod: result.prfSucceeded ? 'prf' : 'rs',
          kek: result.kek,
          deviceSalt: result.deviceSalt,
          prfSalt: result.prfSalt,
          prfSucceeded: result.prfSucceeded,
          authResult: {
            verified: true,
            userId: result.user.userId,
            credentialId: result.user.credentialId,
            prfSupported: result.prfSucceeded,
          },
        },
        result.user.userId
      );
      saveStoredCredentials(storedCreds);

      // Initialize database
      const { db } = await initDatabase({ dek: result.dek });
      await setupCollections(db);

      dispatch({
        type: 'SETUP_COMPLETE',
        payload: {
          user: result.user,
          unlockMethod: result.prfSucceeded ? 'prf' : 'rs',
          prfSupported: result.prfSucceeded,
        },
      });

      dispatch({ type: 'DATABASE_READY' });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: { error: error instanceof Error ? error.message : 'Setup failed' },
      });
    }
  }, []);

  /**
   * Recover account with recovery secret
   */
  const recoverWithSecret = useCallback(async (recoverySecret: RecoverySecret) => {
    try {
      dispatch({ type: 'LOGIN_START' });

      // For recovery, we need to:
      // 1. Derive KEK from RS
      // 2. Generate new device salt
      // 3. Get wrapped DEK from server (or fail if no sync available)
      // 4. Unwrap DEK and init database

      const { deriveKekFromRS, generateDeviceSalt, unwrapDek, deserializeWrappedDek } = await import('../crypto/keys');
      const { base64urlDecode } = await import('../crypto/utils');
      const { markDeviceAsRecovered } = await import('../auth/recovery');

      // Check for wrapped DEK (must exist for recovery to work)
      const wrappedDekStr = localStorage.getItem(STORAGE_KEYS.WRAPPED_DEK);
      if (!wrappedDekStr) {
        throw new Error('No encrypted data found on this device. Sync with server first.');
      }

      // Generate new device salt for this recovered device
      const deviceSalt = generateDeviceSalt();

      // Derive KEK from recovery secret
      const kek = await deriveKekFromRS(recoverySecret, deviceSalt);

      // Unwrap DEK (decode from base64url first)
      const wrappedDekBytes = base64urlDecode(wrappedDekStr);
      const wrappedDek = deserializeWrappedDek(wrappedDekBytes);
      const dek = await unwrapDek(wrappedDek, kek);

      // Store DEK reference
      dekRef.current = dek;

      // Initialize database
      const { db } = await initDatabase({ dek });
      await setupCollections(db);

      // Get stored user
      const user = loadUserFromStorage();
      if (!user) {
        throw new Error('No user data found. Account recovery incomplete.');
      }

      // Mark device as recovered
      markDeviceAsRecovered();

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: {
          user,
          unlockMethod: 'rs',
          prfSupported: false,
        },
      });

      dispatch({ type: 'DATABASE_READY' });
    } catch (error) {
      dispatch({
        type: 'LOGIN_ERROR',
        payload: { error: error instanceof Error ? error.message : 'Recovery failed' },
      });
    }
  }, []);

  /**
   * Mark recovery as saved
   */
  const markRecoverySaved = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.RECOVERY_EXPORTED, 'true');
    }
    dispatch({ type: 'MARK_RECOVERY_SAVED' });
  }, []);

  /**
   * Lock the app
   */
  const lock = useCallback(async () => {
    // Clear DEK reference
    if (dekRef.current) {
      dekRef.current.fill(0);
      dekRef.current = null;
    }

    // Close database
    await closeDatabase();

    dispatch({ type: 'LOCK' });
  }, []);

  /**
   * Logout and clear all data
   */
  const logout = useCallback(async () => {
    // Clear DEK reference
    if (dekRef.current) {
      dekRef.current.fill(0);
      dekRef.current = null;
    }

    // Close and destroy database
    const { destroyDatabase } = await import('../db/index');
    await destroyDatabase();

    // Clear storage
    clearAuthStorage();

    // Also clear device credentials
    try {
      const { clearStoredCredentials } = await import('../auth/prf');
      clearStoredCredentials();
    } catch {
      // Ignore errors clearing credentials
    }

    dispatch({ type: 'LOGOUT' });
  }, []);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  // ========================================================================
  // Context Value
  // ========================================================================

  const value = useMemo<AuthContextType>(
    () => ({
      ...state,
      startSetup,
      login,
      loginWithPrf,
      completeSetup,
      recoverWithSecret,
      markRecoverySaved,
      lock,
      logout,
      clearError,
    }),
    [state, startSetup, login, loginWithPrf, completeSetup, recoverWithSecret, markRecoverySaved, lock, logout, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access auth context.
 * Must be used within an AuthProvider.
 *
 * @returns Auth context value
 * @throws Error if used outside AuthProvider
 *
 * @example
 * ```tsx
 * function LoginButton() {
 *   const { login, authState } = useAuth();
 *
 *   const handleLogin = async () => {
 *     await login({ username: 'user@example.com', recoverySecret });
 *   };
 *
 *   return (
 *     <button onClick={handleLogin} disabled={authState === AuthState.Loading}>
 *       Login with Passkey
 *     </button>
 *   );
 * }
 * ```
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (context === defaultContext) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

/**
 * Hook to check if user is authenticated.
 *
 * @returns true if user is authenticated
 *
 * @example
 * ```tsx
 * function ProtectedRoute({ children }) {
 *   const isAuthenticated = useIsAuthenticated();
 *
 *   if (!isAuthenticated) {
 *     return <Navigate to="/login" />;
 *   }
 *
 *   return children;
 * }
 * ```
 */
export function useIsAuthenticated(): boolean {
  const { authState } = useAuth();
  return authState === AuthState.Authenticated;
}

/**
 * Hook to get current auth state.
 *
 * @returns Current auth state
 */
export function useAuthState(): AuthState {
  const { authState } = useAuth();
  return authState;
}

/**
 * Hook to get current user.
 *
 * @returns Current user or null
 */
export function useUser(): AuthUser | null {
  const { user } = useAuth();
  return user;
}

/**
 * Hook to check if database is ready.
 *
 * @returns true if database is initialized and ready
 */
export function useIsDatabaseReady(): boolean {
  const { isDatabaseReady } = useAuth();
  return isDatabaseReady;
}

/**
 * Hook to get auth error.
 *
 * @returns Current error message or null
 */
export function useAuthError(): string | null {
  const { error } = useAuth();
  return error;
}

// ============================================================================
// Exports
// ============================================================================

export { AuthContext };
export default AuthProvider;
