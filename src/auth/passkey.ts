/**
 * Passkey Authentication Module
 *
 * Implements WebAuthn passkey registration and authentication flows using @simplewebauthn/browser.
 * This module provides the client-side ceremony handling for passkey-based authentication.
 *
 * @module auth/passkey
 *
 * @example
 * ```typescript
 * import { registerPasskey, authenticateWithPasskey } from '@/auth/passkey';
 *
 * // Register a new passkey
 * const result = await registerPasskey('user@example.com');
 * console.log('Registered credential:', result.credentialId);
 *
 * // Authenticate with existing passkey
 * const authResult = await authenticateWithPasskey('user@example.com');
 * console.log('Authenticated:', authResult.userId);
 * ```
 */

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';
import { getAuthUrl } from '../config/env';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from passkey registration
 */
export interface PasskeyRegistrationResult {
  /** Whether registration was successful */
  verified: boolean;
  /** User ID from the server */
  userId: string;
  /** Credential ID of the registered passkey */
  credentialId: string;
}

/**
 * Result from passkey authentication
 */
export interface PasskeyAuthenticationResult {
  /** Whether authentication was successful */
  verified: boolean;
  /** User ID from the server */
  userId: string;
  /** Username of the authenticated user */
  username: string;
  /** Credential ID used for authentication */
  credentialId: string;
  /** Access token for API requests */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Access token expiry in seconds */
  expiresIn: number;
  /** Token type (always 'Bearer') */
  tokenType: string;
}

/**
 * Options for passkey registration
 */
export interface PasskeyRegistrationOptions {
  /** Optional signal for aborting the ceremony */
  signal?: AbortSignal;
  /** Device info string for session tracking */
  deviceInfo?: string;
}

/**
 * Options for passkey authentication
 */
export interface PasskeyAuthenticationOptions {
  /** Optional signal for aborting the ceremony */
  signal?: AbortSignal;
  /** Device info string for session tracking */
  deviceInfo?: string;
  /** Use conditional UI (autofill) for authentication */
  useAutofill?: boolean;
}

/**
 * WebAuthn capability information
 */
export interface WebAuthnCapabilities {
  /** Browser supports WebAuthn */
  webAuthnSupported: boolean;
  /** Browser supports WebAuthn autofill (conditional UI) */
  autofillSupported: boolean;
  /** Platform authenticator (Face ID, Touch ID, Windows Hello) is available */
  platformAuthenticatorAvailable: boolean;
}

/**
 * Auth server registration begin response
 */
interface ServerRegistrationBeginResponse {
  options: PublicKeyCredentialCreationOptionsJSON;
  userId: string;
}

/**
 * Auth server registration finish response
 */
interface ServerRegistrationFinishResponse {
  verified: boolean;
  userId: string;
  credentialId: string;
}

/**
 * Auth server authentication begin response
 */
interface ServerAuthenticationBeginResponse {
  options: PublicKeyCredentialRequestOptionsJSON;
  userId: string;
}

/**
 * Auth server authentication finish response
 */
interface ServerAuthenticationFinishResponse {
  verified: boolean;
  userId: string;
  username: string;
  credentialId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

/**
 * Server error response
 */
interface ServerErrorResponse {
  error: string;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when WebAuthn is not supported
 */
export class WebAuthnNotSupportedError extends Error {
  constructor(message = 'WebAuthn is not supported in this browser') {
    super(message);
    this.name = 'WebAuthnNotSupportedError';
  }
}

/**
 * Error thrown when the passkey ceremony is cancelled by the user
 */
export class PasskeyCancelledError extends Error {
  constructor(message = 'Passkey ceremony was cancelled') {
    super(message);
    this.name = 'PasskeyCancelledError';
  }
}

/**
 * Error thrown when there's a server communication error
 */
export class PasskeyServerError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'PasskeyServerError';
  }
}

/**
 * Error thrown when passkey verification fails
 */
export class PasskeyVerificationError extends Error {
  constructor(message = 'Passkey verification failed') {
    super(message);
    this.name = 'PasskeyVerificationError';
  }
}

// ============================================================================
// Capability Detection
// ============================================================================

/**
 * Check WebAuthn capabilities in the current browser.
 * Call this before attempting passkey operations to determine available features.
 *
 * @returns Promise resolving to capability information
 *
 * @example
 * ```typescript
 * const caps = await getWebAuthnCapabilities();
 * if (!caps.webAuthnSupported) {
 *   showError('Your browser does not support passkeys');
 * }
 * if (!caps.platformAuthenticatorAvailable) {
 *   showWarning('Biometric authentication may not be available');
 * }
 * ```
 */
export async function getWebAuthnCapabilities(): Promise<WebAuthnCapabilities> {
  const webAuthnSupported = browserSupportsWebAuthn();

  // Check autofill support (async)
  let autofillSupported = false;
  if (webAuthnSupported) {
    try {
      autofillSupported = await browserSupportsWebAuthnAutofill();
    } catch {
      // Autofill check failed - assume not supported
    }
  }

  // Check platform authenticator (async)
  let platformAuthenticatorAvailable = false;
  if (webAuthnSupported) {
    try {
      platformAuthenticatorAvailable = await platformAuthenticatorIsAvailable();
    } catch {
      // Platform authenticator check failed - assume not available
    }
  }

  return {
    webAuthnSupported,
    autofillSupported,
    platformAuthenticatorAvailable,
  };
}

/**
 * Check if WebAuthn is supported in the current browser.
 * This is a synchronous check for basic support.
 *
 * @returns true if WebAuthn is supported
 */
export function isWebAuthnSupported(): boolean {
  return browserSupportsWebAuthn();
}

// ============================================================================
// Registration Flow
// ============================================================================

/**
 * Register a new passkey for a user.
 * This completes the full WebAuthn registration ceremony:
 * 1. Fetch registration options from server
 * 2. Execute the WebAuthn registration ceremony (prompts user)
 * 3. Send the credential to server for verification and storage
 *
 * @param username - The username (typically email) for the account
 * @param options - Optional configuration for the registration
 * @returns Promise resolving to registration result with credential ID
 * @throws {WebAuthnNotSupportedError} If WebAuthn is not supported
 * @throws {PasskeyCancelledError} If the user cancels the ceremony
 * @throws {PasskeyServerError} If server communication fails
 * @throws {PasskeyVerificationError} If credential verification fails
 *
 * @example
 * ```typescript
 * try {
 *   const result = await registerPasskey('user@example.com');
 *   // Save userId for recovery flow
 *   localStorage.setItem('userId', result.userId);
 * } catch (error) {
 *   if (error instanceof PasskeyCancelledError) {
 *     // User cancelled - show friendly message
 *   } else if (error instanceof WebAuthnNotSupportedError) {
 *     // Browser doesn't support passkeys
 *   }
 * }
 * ```
 */
export async function registerPasskey(
  username: string,
  options: PasskeyRegistrationOptions = {}
): Promise<PasskeyRegistrationResult> {
  // Check WebAuthn support
  if (!browserSupportsWebAuthn()) {
    throw new WebAuthnNotSupportedError();
  }

  // Validate username
  if (!username || typeof username !== 'string') {
    throw new Error('Username is required');
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3) {
    throw new Error('Username must be at least 3 characters');
  }

  // Step 1: Begin registration with server
  const beginResponse = await beginRegistrationWithServer(trimmedUsername, options.signal);

  // Step 2: Execute WebAuthn registration ceremony
  let credential: RegistrationResponseJSON;
  try {
    credential = await startRegistration({
      optionsJSON: beginResponse.options,
    });
  } catch (error) {
    // Handle user cancellation and other errors
    if (error instanceof Error) {
      if (
        error.name === 'NotAllowedError' ||
        error.message.includes('cancelled') ||
        error.message.includes('canceled')
      ) {
        throw new PasskeyCancelledError('Registration was cancelled by the user');
      }
      if (error.name === 'InvalidStateError') {
        throw new PasskeyVerificationError(
          'This authenticator is already registered. Please use a different passkey.'
        );
      }
    }
    throw new PasskeyVerificationError(
      `Registration ceremony failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Step 3: Finish registration with server
  const finishResponse = await finishRegistrationWithServer(
    beginResponse.userId,
    credential,
    options.signal
  );

  return {
    verified: finishResponse.verified,
    userId: finishResponse.userId,
    credentialId: finishResponse.credentialId,
  };
}

/**
 * Begin registration by fetching options from the server.
 *
 * @internal
 */
async function beginRegistrationWithServer(
  username: string,
  signal?: AbortSignal
): Promise<ServerRegistrationBeginResponse> {
  const url = getAuthUrl('/api/auth/register/begin');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PasskeyCancelledError('Registration was aborted');
    }
    throw new PasskeyServerError(
      `Failed to connect to auth server: ${error instanceof Error ? error.message : 'Network error'}`
    );
  }

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new PasskeyServerError(
      errorBody || `Server returned ${response.status}`,
      response.status
    );
  }

  const data = (await response.json()) as ServerRegistrationBeginResponse;
  return data;
}

/**
 * Finish registration by sending the credential to the server.
 *
 * @internal
 */
async function finishRegistrationWithServer(
  userId: string,
  credential: RegistrationResponseJSON,
  signal?: AbortSignal
): Promise<ServerRegistrationFinishResponse> {
  const url = getAuthUrl('/api/auth/register/finish');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        response: credential,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PasskeyCancelledError('Registration was aborted');
    }
    throw new PasskeyServerError(
      `Failed to verify credential: ${error instanceof Error ? error.message : 'Network error'}`
    );
  }

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new PasskeyServerError(
      errorBody || `Verification failed with status ${response.status}`,
      response.status
    );
  }

  const data = (await response.json()) as ServerRegistrationFinishResponse;

  if (!data.verified) {
    throw new PasskeyVerificationError('Server rejected the credential');
  }

  return data;
}

// ============================================================================
// Authentication Flow
// ============================================================================

/**
 * Authenticate with an existing passkey.
 * This completes the full WebAuthn authentication ceremony:
 * 1. Fetch authentication options from server
 * 2. Execute the WebAuthn authentication ceremony (prompts user)
 * 3. Send the assertion to server for verification
 * 4. Receive tokens on successful authentication
 *
 * @param username - The username (typically email) for the account
 * @param options - Optional configuration for the authentication
 * @returns Promise resolving to authentication result with tokens
 * @throws {WebAuthnNotSupportedError} If WebAuthn is not supported
 * @throws {PasskeyCancelledError} If the user cancels the ceremony
 * @throws {PasskeyServerError} If server communication fails
 * @throws {PasskeyVerificationError} If assertion verification fails
 *
 * @example
 * ```typescript
 * try {
 *   const result = await authenticateWithPasskey('user@example.com');
 *   // Store tokens for API requests
 *   tokenStorage.setAccessToken(result.accessToken);
 *   tokenStorage.setRefreshToken(result.refreshToken);
 * } catch (error) {
 *   if (error instanceof PasskeyCancelledError) {
 *     // User cancelled - allow retry
 *   }
 * }
 * ```
 */
export async function authenticateWithPasskey(
  username: string,
  options: PasskeyAuthenticationOptions = {}
): Promise<PasskeyAuthenticationResult> {
  // Check WebAuthn support
  if (!browserSupportsWebAuthn()) {
    throw new WebAuthnNotSupportedError();
  }

  // Validate username
  if (!username || typeof username !== 'string') {
    throw new Error('Username is required');
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3) {
    throw new Error('Username must be at least 3 characters');
  }

  // Step 1: Begin authentication with server
  const beginResponse = await beginAuthenticationWithServer(trimmedUsername, options.signal);

  // Step 2: Execute WebAuthn authentication ceremony
  let credential: AuthenticationResponseJSON;
  try {
    credential = await startAuthentication({
      optionsJSON: beginResponse.options,
      useBrowserAutofill: options.useAutofill,
    });
  } catch (error) {
    // Handle user cancellation and other errors
    if (error instanceof Error) {
      if (
        error.name === 'NotAllowedError' ||
        error.message.includes('cancelled') ||
        error.message.includes('canceled')
      ) {
        throw new PasskeyCancelledError('Authentication was cancelled by the user');
      }
    }
    throw new PasskeyVerificationError(
      `Authentication ceremony failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Step 3: Finish authentication with server
  const finishResponse = await finishAuthenticationWithServer(
    beginResponse.userId,
    credential,
    options.deviceInfo,
    options.signal
  );

  return {
    verified: finishResponse.verified,
    userId: finishResponse.userId,
    username: finishResponse.username,
    credentialId: finishResponse.credentialId,
    accessToken: finishResponse.accessToken,
    refreshToken: finishResponse.refreshToken,
    expiresIn: finishResponse.expiresIn,
    tokenType: finishResponse.tokenType,
  };
}

/**
 * Begin authentication by fetching options from the server.
 *
 * @internal
 */
async function beginAuthenticationWithServer(
  username: string,
  signal?: AbortSignal
): Promise<ServerAuthenticationBeginResponse> {
  const url = getAuthUrl('/api/auth/authenticate/begin');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PasskeyCancelledError('Authentication was aborted');
    }
    throw new PasskeyServerError(
      `Failed to connect to auth server: ${error instanceof Error ? error.message : 'Network error'}`
    );
  }

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new PasskeyServerError(
      errorBody || `Server returned ${response.status}`,
      response.status
    );
  }

  const data = (await response.json()) as ServerAuthenticationBeginResponse;
  return data;
}

/**
 * Finish authentication by sending the assertion to the server.
 *
 * @internal
 */
async function finishAuthenticationWithServer(
  userId: string,
  credential: AuthenticationResponseJSON,
  deviceInfo?: string,
  signal?: AbortSignal
): Promise<ServerAuthenticationFinishResponse> {
  const url = getAuthUrl('/api/auth/authenticate/finish');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        response: credential,
        deviceInfo,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PasskeyCancelledError('Authentication was aborted');
    }
    throw new PasskeyServerError(
      `Failed to verify assertion: ${error instanceof Error ? error.message : 'Network error'}`
    );
  }

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new PasskeyServerError(
      errorBody || `Verification failed with status ${response.status}`,
      response.status
    );
  }

  const data = (await response.json()) as ServerAuthenticationFinishResponse;

  if (!data.verified) {
    throw new PasskeyVerificationError('Server rejected the authentication');
  }

  return data;
}

// ============================================================================
// User Status
// ============================================================================

/**
 * Check if a user has registered credentials.
 * Useful for determining whether to show "Sign In" or "Create Account".
 *
 * @param username - The username to check
 * @returns Promise resolving to credential status
 *
 * @example
 * ```typescript
 * const status = await checkUserCredentialStatus('user@example.com');
 * if (status.hasCredentials) {
 *   showSignInButton();
 * } else {
 *   showCreateAccountButton();
 * }
 * ```
 */
export async function checkUserCredentialStatus(
  username: string
): Promise<{ hasCredentials: boolean; credentialCount: number }> {
  const url = getAuthUrl(`/api/auth/status?username=${encodeURIComponent(username)}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    throw new PasskeyServerError(
      `Failed to check user status: ${error instanceof Error ? error.message : 'Network error'}`
    );
  }

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new PasskeyServerError(
      errorBody || `Server returned ${response.status}`,
      response.status
    );
  }

  const data = (await response.json()) as { hasCredentials: boolean; credentialCount: number };
  return data;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse error response from server.
 *
 * @internal
 */
async function parseErrorResponse(response: Response): Promise<string | null> {
  try {
    const errorData = (await response.json()) as ServerErrorResponse;
    return errorData.error || null;
  } catch {
    // Response body wasn't JSON
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

/**
 * Get a user-friendly description of the current device.
 * Useful for session tracking and device management UI.
 *
 * @returns Device description string
 */
export function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  const platform = navigator.platform || 'Unknown';

  // Simple device detection
  let device = 'Unknown Device';

  if (/iPhone/.test(ua)) {
    device = 'iPhone';
  } else if (/iPad/.test(ua)) {
    device = 'iPad';
  } else if (/Android/.test(ua)) {
    device = 'Android';
  } else if (/Mac/.test(platform)) {
    device = 'Mac';
  } else if (/Win/.test(platform)) {
    device = 'Windows';
  } else if (/Linux/.test(platform)) {
    device = 'Linux';
  }

  // Add browser info
  let browser = 'Unknown Browser';
  if (/Chrome/.test(ua) && !/Edg/.test(ua)) {
    browser = 'Chrome';
  } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    browser = 'Safari';
  } else if (/Firefox/.test(ua)) {
    browser = 'Firefox';
  } else if (/Edg/.test(ua)) {
    browser = 'Edge';
  }

  return `${device} - ${browser}`;
}
