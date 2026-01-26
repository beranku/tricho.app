/**
 * Token Service
 *
 * Handles JWT token issuance and validation for authenticated sessions.
 * Uses HMAC-SHA256 signing via Web Crypto API.
 * Tokens are used to authorize access to sync endpoints (CouchDB, object storage).
 */

// ============================================================================
// Types
// ============================================================================

/**
 * JWT payload structure
 */
export interface TokenPayload {
  /** Subject - User ID */
  sub: string;
  /** Username (email) */
  username: string;
  /** Issued at timestamp (seconds) */
  iat: number;
  /** Expiration timestamp (seconds) */
  exp: number;
  /** Token type */
  type: 'access' | 'refresh';
}

/**
 * Decoded and verified token result
 */
export interface VerifiedToken {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

/**
 * Token pair returned after authentication
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Session record for tracking active sessions
 */
export interface Session {
  userId: string;
  username: string;
  refreshTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  deviceInfo?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Token configuration
 * In production, JWT_SECRET should be a strong random value from environment
 */
const tokenConfig = {
  /** Secret for signing JWTs - MUST be set in production */
  secret: process.env.JWT_SECRET || 'tricho-dev-secret-change-in-production',
  /** Access token expiration in seconds (15 minutes) */
  accessTokenExpiry: Number(process.env.ACCESS_TOKEN_EXPIRY) || 15 * 60,
  /** Refresh token expiration in seconds (7 days) */
  refreshTokenExpiry: Number(process.env.REFRESH_TOKEN_EXPIRY) || 7 * 24 * 60 * 60,
  /** Token issuer */
  issuer: process.env.JWT_ISSUER || 'tricho-auth-service',
};

// ============================================================================
// In-Memory Session Storage (Development Only)
// ============================================================================

/**
 * In-memory session storage
 * WARNING: This is for development only. Replace with Redis/DB in production.
 */
const sessions = new Map<string, Session>();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the signing key as a CryptoKey
 */
let signingKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (signingKey) {
    return signingKey;
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(tokenConfig.secret);

  signingKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  return signingKey;
}

/**
 * Base64url encode a string or Uint8Array
 */
function base64urlEncode(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const base64 = Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64url decode to string
 */
function base64urlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Generate a random token ID
 */
function generateTokenId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash a string using SHA-256 (for refresh token storage)
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Token Functions
// ============================================================================

/**
 * Create a JWT token
 *
 * @param payload - Token payload
 * @returns Signed JWT string
 */
async function createToken(payload: TokenPayload): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await getSigningKey();
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64urlEncode(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify and decode a JWT token
 *
 * @param token - JWT string to verify
 * @returns Verification result with payload if valid
 */
export async function verifyToken(token: string): Promise<VerifiedToken> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Verify signature
    const key = await getSigningKey();
    const signatureBytes = Buffer.from(
      encodedSignature.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (encodedSignature.length % 4)) % 4),
      'base64'
    );

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Decode payload
    const payload = JSON.parse(base64urlDecode(encodedPayload)) as TokenPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token verification failed';
    return { valid: false, error: message };
  }
}

/**
 * Issue a new token pair after successful authentication
 *
 * @param userId - The authenticated user's ID
 * @param username - The authenticated user's username
 * @param deviceInfo - Optional device identifier for session tracking
 * @returns Token pair with access and refresh tokens
 */
export async function issueTokens(
  userId: string,
  username: string,
  deviceInfo?: string
): Promise<TokenPair> {
  const now = Math.floor(Date.now() / 1000);

  // Create access token
  const accessPayload: TokenPayload = {
    sub: userId,
    username,
    iat: now,
    exp: now + tokenConfig.accessTokenExpiry,
    type: 'access',
  };

  // Create refresh token
  const refreshPayload: TokenPayload = {
    sub: userId,
    username,
    iat: now,
    exp: now + tokenConfig.refreshTokenExpiry,
    type: 'refresh',
  };

  const accessToken = await createToken(accessPayload);
  const refreshToken = await createToken(refreshPayload);

  // Store session with hashed refresh token
  const refreshTokenHash = await hashString(refreshToken);
  const sessionId = generateTokenId();

  const session: Session = {
    userId,
    username,
    refreshTokenHash,
    createdAt: new Date(),
    expiresAt: new Date((now + tokenConfig.refreshTokenExpiry) * 1000),
    deviceInfo,
  };

  sessions.set(sessionId, session);

  return {
    accessToken,
    refreshToken,
    expiresIn: tokenConfig.accessTokenExpiry,
    tokenType: 'Bearer',
  };
}

/**
 * Refresh an access token using a valid refresh token
 *
 * @param refreshToken - The refresh token
 * @returns New token pair or null if refresh token is invalid
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenPair | null> {
  // Verify refresh token
  const result = await verifyToken(refreshToken);

  if (!result.valid || !result.payload) {
    return null;
  }

  if (result.payload.type !== 'refresh') {
    return null;
  }

  // Find session with matching refresh token hash
  const refreshTokenHash = await hashString(refreshToken);
  let foundSession: Session | null = null;
  let foundSessionId: string | null = null;

  for (const [sessionId, session] of sessions.entries()) {
    if (session.refreshTokenHash === refreshTokenHash && session.userId === result.payload.sub) {
      foundSession = session;
      foundSessionId = sessionId;
      break;
    }
  }

  if (!foundSession || !foundSessionId) {
    return null;
  }

  // Check if session is expired
  if (foundSession.expiresAt < new Date()) {
    sessions.delete(foundSessionId);
    return null;
  }

  // Issue new tokens (rotate refresh token for security)
  const newTokens = await issueTokens(
    result.payload.sub,
    result.payload.username,
    foundSession.deviceInfo
  );

  // Remove old session
  sessions.delete(foundSessionId);

  return newTokens;
}

/**
 * Revoke a session (logout)
 *
 * @param userId - The user ID to revoke sessions for
 * @param refreshToken - Optional specific refresh token to revoke
 * @returns Number of sessions revoked
 */
export async function revokeSession(userId: string, refreshToken?: string): Promise<number> {
  let revokedCount = 0;

  if (refreshToken) {
    // Revoke specific session
    const refreshTokenHash = await hashString(refreshToken);

    for (const [sessionId, session] of sessions.entries()) {
      if (session.userId === userId && session.refreshTokenHash === refreshTokenHash) {
        sessions.delete(sessionId);
        revokedCount++;
        break;
      }
    }
  } else {
    // Revoke all sessions for user
    for (const [sessionId, session] of sessions.entries()) {
      if (session.userId === userId) {
        sessions.delete(sessionId);
        revokedCount++;
      }
    }
  }

  return revokedCount;
}

/**
 * Get active session count for a user
 *
 * @param userId - The user ID
 * @returns Number of active sessions
 */
export function getActiveSessionCount(userId: string): number {
  let count = 0;
  const now = new Date();

  for (const session of sessions.values()) {
    if (session.userId === userId && session.expiresAt > now) {
      count++;
    }
  }

  return count;
}

/**
 * Clean up expired sessions
 * Should be called periodically (e.g., every hour)
 *
 * @returns Number of sessions cleaned up
 */
export function cleanupExpiredSessions(): number {
  let cleanedCount = 0;
  const now = new Date();

  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(sessionId);
      cleanedCount++;
    }
  }

  return cleanedCount;
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get token configuration (for debugging/info endpoints)
 */
export function getTokenConfig() {
  return {
    accessTokenExpiry: tokenConfig.accessTokenExpiry,
    refreshTokenExpiry: tokenConfig.refreshTokenExpiry,
    issuer: tokenConfig.issuer,
  };
}
