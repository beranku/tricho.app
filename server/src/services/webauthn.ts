/**
 * WebAuthn Service
 *
 * Handles WebAuthn registration and authentication ceremonies using @simplewebauthn/server.
 * Uses in-memory storage for development - should be replaced with persistent storage in production.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';

// ============================================================================
// Types
// ============================================================================

/**
 * Stored WebAuthn credential for a user
 */
export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  createdAt: Date;
  deviceType: string;
  backedUp: boolean;
}

/**
 * User record with associated credentials
 */
export interface User {
  id: string;
  username: string;
  credentials: StoredCredential[];
  createdAt: Date;
  currentChallenge?: string;
}

/**
 * Result from beginning registration
 */
export interface BeginRegistrationResult {
  options: PublicKeyCredentialCreationOptionsJSON;
  userId: string;
}

/**
 * Result from finishing registration
 */
export interface FinishRegistrationResult {
  verified: boolean;
  userId: string;
  credentialId: string;
}

/**
 * Result from beginning authentication
 */
export interface BeginAuthenticationResult {
  options: PublicKeyCredentialRequestOptionsJSON;
  userId: string;
}

/**
 * Result from finishing authentication
 */
export interface FinishAuthenticationResult {
  verified: boolean;
  userId: string;
  username: string;
  credentialId: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Relying Party configuration
 * In production, these should come from environment variables
 */
const rpConfig = {
  name: process.env.RP_NAME || 'TrichoApp',
  id: process.env.RP_ID || 'localhost',
  origin: process.env.RP_ORIGIN || 'http://localhost:4321',
};

/**
 * Get RP origins - supports multiple origins for development
 */
function getExpectedOrigins(): string[] {
  const origins = process.env.RP_ORIGINS?.split(',') || [
    'http://localhost:4321',
    'http://localhost:3000',
  ];
  return origins;
}

// ============================================================================
// In-Memory Storage (Development Only)
// ============================================================================

/**
 * In-memory user storage
 * WARNING: This is for development only. Replace with persistent storage in production.
 */
const users = new Map<string, User>();

/**
 * Username to user ID mapping for quick lookups
 */
const usernameToId = new Map<string, string>();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique user ID
 */
function generateUserId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert Uint8Array to base64url string
 */
function uint8ArrayToBase64url(array: Uint8Array): string {
  const base64 = Buffer.from(array).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Get or create a user by username
 */
function getOrCreateUser(username: string): User {
  const existingId = usernameToId.get(username);
  if (existingId) {
    const user = users.get(existingId);
    if (user) {
      return user;
    }
  }

  // Create new user
  const userId = generateUserId();
  const user: User = {
    id: userId,
    username,
    credentials: [],
    createdAt: new Date(),
  };

  users.set(userId, user);
  usernameToId.set(username, userId);

  return user;
}

/**
 * Get user by ID
 */
export function getUserById(userId: string): User | undefined {
  return users.get(userId);
}

/**
 * Get user by username
 */
export function getUserByUsername(username: string): User | undefined {
  const userId = usernameToId.get(username);
  if (!userId) return undefined;
  return users.get(userId);
}

// ============================================================================
// Registration Functions
// ============================================================================

/**
 * Begin WebAuthn registration ceremony
 *
 * Generates registration options for the client to pass to navigator.credentials.create()
 *
 * @param username - The username (typically email) for the new account
 * @returns Registration options and user ID
 */
export async function beginRegistration(
  username: string
): Promise<BeginRegistrationResult> {
  // Validate username
  if (!username || typeof username !== 'string') {
    throw new Error('Username is required');
  }

  const trimmedUsername = username.trim().toLowerCase();
  if (trimmedUsername.length < 3) {
    throw new Error('Username must be at least 3 characters');
  }

  // Get or create user
  const user = getOrCreateUser(trimmedUsername);

  // Get existing credentials to exclude (prevent re-registration of same authenticator)
  const excludeCredentials = user.credentials.map((cred) => ({
    id: cred.id,
    transports: cred.transports,
  }));

  // Generate registration options
  const options = await generateRegistrationOptions({
    rpName: rpConfig.name,
    rpID: rpConfig.id,
    userName: user.username,
    userID: new TextEncoder().encode(user.id),
    userDisplayName: user.username,
    attestationType: 'none', // We don't need attestation for this use case
    excludeCredentials,
    authenticatorSelection: {
      // Prefer platform authenticators (Face ID, Touch ID, Windows Hello)
      authenticatorAttachment: 'platform',
      // Require user verification (biometric or PIN)
      userVerification: 'required',
      // Allow discoverable credentials (passkeys)
      residentKey: 'required',
    },
    // Request PRF extension support for key derivation
    extensions: {
      // Note: PRF registration only checks for support, actual PRF use is during authentication
    },
  });

  // Store challenge for verification
  user.currentChallenge = options.challenge;
  users.set(user.id, user);

  return {
    options,
    userId: user.id,
  };
}

/**
 * Finish WebAuthn registration ceremony
 *
 * Verifies the registration response from the client and stores the credential
 *
 * @param userId - The user ID from beginRegistration
 * @param response - The registration response from navigator.credentials.create()
 * @returns Verification result with credential ID
 */
export async function finishRegistration(
  userId: string,
  response: RegistrationResponseJSON
): Promise<FinishRegistrationResult> {
  // Get user
  const user = users.get(userId);
  if (!user) {
    throw new Error('User not found. Please start registration again.');
  }

  // Get stored challenge
  const expectedChallenge = user.currentChallenge;
  if (!expectedChallenge) {
    throw new Error('No registration challenge found. Please start registration again.');
  }

  // Clear challenge (single use)
  user.currentChallenge = undefined;

  let verification: VerifiedRegistrationResponse;

  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getExpectedOrigins(),
      expectedRPID: rpConfig.id,
      requireUserVerification: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    throw new Error(`Registration verification failed: ${message}`);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Registration verification failed');
  }

  const { registrationInfo } = verification;

  // Create stored credential
  const credential: StoredCredential = {
    id: registrationInfo.credential.id,
    publicKey: registrationInfo.credential.publicKey,
    counter: registrationInfo.credential.counter,
    transports: response.response.transports,
    createdAt: new Date(),
    deviceType: registrationInfo.credentialDeviceType,
    backedUp: registrationInfo.credentialBackedUp,
  };

  // Store credential
  user.credentials.push(credential);
  users.set(user.id, user);

  return {
    verified: true,
    userId: user.id,
    credentialId: uint8ArrayToBase64url(
      new Uint8Array(Buffer.from(credential.id, 'base64url'))
    ),
  };
}

// ============================================================================
// Authentication Functions
// ============================================================================

/**
 * Begin WebAuthn authentication ceremony
 *
 * Generates authentication options for the client to pass to navigator.credentials.get()
 *
 * @param username - The username (typically email) of the account to authenticate
 * @returns Authentication options and user ID
 */
export async function beginAuthentication(
  username: string
): Promise<BeginAuthenticationResult> {
  // Validate username
  if (!username || typeof username !== 'string') {
    throw new Error('Username is required');
  }

  const trimmedUsername = username.trim().toLowerCase();
  if (trimmedUsername.length < 3) {
    throw new Error('Username must be at least 3 characters');
  }

  // Get user
  const user = getUserByUsername(trimmedUsername);
  if (!user) {
    throw new Error('User not found');
  }

  // Check if user has any credentials
  if (user.credentials.length === 0) {
    throw new Error('No credentials registered for this user');
  }

  // Get allowed credentials for this user
  const allowCredentials = user.credentials.map((cred) => ({
    id: cred.id,
    transports: cred.transports,
  }));

  // Generate authentication options
  const options = await generateAuthenticationOptions({
    rpID: rpConfig.id,
    userVerification: 'required',
    allowCredentials,
    timeout: 60000, // 60 seconds
  });

  // Store challenge for verification
  user.currentChallenge = options.challenge;
  users.set(user.id, user);

  return {
    options,
    userId: user.id,
  };
}

/**
 * Finish WebAuthn authentication ceremony
 *
 * Verifies the authentication response from the client
 *
 * @param userId - The user ID from beginAuthentication
 * @param response - The authentication response from navigator.credentials.get()
 * @returns Verification result with user information
 */
export async function finishAuthentication(
  userId: string,
  response: AuthenticationResponseJSON
): Promise<FinishAuthenticationResult> {
  // Get user
  const user = users.get(userId);
  if (!user) {
    throw new Error('User not found. Please start authentication again.');
  }

  // Get stored challenge
  const expectedChallenge = user.currentChallenge;
  if (!expectedChallenge) {
    throw new Error('No authentication challenge found. Please start authentication again.');
  }

  // Clear challenge (single use)
  user.currentChallenge = undefined;

  // Find the credential used for authentication
  const credentialId = response.id;
  const credential = user.credentials.find((cred) => cred.id === credentialId);
  if (!credential) {
    throw new Error('Credential not found for this user');
  }

  let verification: VerifiedAuthenticationResponse;

  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getExpectedOrigins(),
      expectedRPID: rpConfig.id,
      credential: {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      },
      requireUserVerification: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    throw new Error(`Authentication verification failed: ${message}`);
  }

  if (!verification.verified) {
    throw new Error('Authentication verification failed');
  }

  // Update counter to prevent replay attacks
  credential.counter = verification.authenticationInfo.newCounter;
  users.set(user.id, user);

  return {
    verified: true,
    userId: user.id,
    username: user.username,
    credentialId: uint8ArrayToBase64url(
      new Uint8Array(Buffer.from(credential.id, 'base64url'))
    ),
  };
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Get RP configuration (for debugging/info endpoints)
 */
export function getRpConfig() {
  return {
    name: rpConfig.name,
    id: rpConfig.id,
    // Don't expose origin in production
  };
}

/**
 * Check if a user has any registered credentials
 */
export function hasCredentials(username: string): boolean {
  const user = getUserByUsername(username);
  return user ? user.credentials.length > 0 : false;
}

/**
 * Get credential count for a user
 */
export function getCredentialCount(username: string): number {
  const user = getUserByUsername(username);
  return user ? user.credentials.length : 0;
}
