/**
 * Auth Routes
 *
 * WebAuthn registration and authentication endpoints for TrichoApp.
 * Handles passkey-based authentication flows and session management.
 */

import { Hono } from 'hono';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import {
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
  getUserByUsername,
  hasCredentials,
  getRpConfig,
} from '../services/webauthn.js';
import {
  issueTokens,
  refreshAccessToken,
  revokeSession,
  getActiveSessionCount,
  getTokenConfig,
} from '../services/tokens.js';
import { requireAuth, requireTokenType, type AuthVariables } from '../middleware/auth.js';

// ============================================================================
// Types
// ============================================================================

interface RegisterBeginBody {
  username: string;
}

interface RegisterFinishBody {
  userId: string;
  response: RegistrationResponseJSON;
}

interface AuthenticateBeginBody {
  username: string;
}

interface AuthenticateFinishBody {
  userId: string;
  response: AuthenticationResponseJSON;
  deviceInfo?: string;
}

interface RefreshTokenBody {
  refreshToken: string;
}

// ============================================================================
// Router
// ============================================================================

const authRouter = new Hono();

// ============================================================================
// Registration Endpoints
// ============================================================================

/**
 * POST /api/auth/register/begin
 *
 * Begin WebAuthn registration ceremony.
 * Returns options for navigator.credentials.create()
 *
 * Request body:
 *   { username: string } - The username (email) for the new account
 *
 * Response:
 *   200: { options: PublicKeyCredentialCreationOptionsJSON, userId: string }
 *   400: { error: string } - Invalid request
 *   409: { error: string } - User already has credentials
 */
authRouter.post('/register/begin', async (c) => {
  try {
    const body = await c.req.json<RegisterBeginBody>();

    // Validate request
    if (!body.username) {
      return c.json({ error: 'Username is required' }, 400);
    }

    // Check if user already has credentials (optional - allow multiple passkeys)
    const existingUser = getUserByUsername(body.username);
    if (existingUser && existingUser.credentials.length > 0) {
      // User exists with credentials - they should authenticate instead
      // But we allow registering additional passkeys, so just warn
      // In a real app, you might require authentication before adding new passkeys
    }

    // Generate registration options
    const result = await beginRegistration(body.username);

    return c.json({
      options: result.options,
      userId: result.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';

    // Return appropriate status code based on error
    if (message.includes('at least')) {
      return c.json({ error: message }, 400);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/auth/register/finish
 *
 * Complete WebAuthn registration ceremony.
 * Verifies the credential and stores it for the user.
 *
 * Request body:
 *   {
 *     userId: string,        - The user ID from /register/begin
 *     response: object       - The response from navigator.credentials.create()
 *   }
 *
 * Response:
 *   200: { verified: boolean, userId: string, credentialId: string }
 *   400: { error: string } - Invalid request or verification failed
 *   404: { error: string } - User not found
 */
authRouter.post('/register/finish', async (c) => {
  try {
    const body = await c.req.json<RegisterFinishBody>();

    // Validate request
    if (!body.userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    if (!body.response) {
      return c.json({ error: 'Registration response is required' }, 400);
    }

    // Verify registration
    const result = await finishRegistration(body.userId, body.response);

    return c.json({
      verified: result.verified,
      userId: result.userId,
      credentialId: result.credentialId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';

    // Return appropriate status code based on error
    if (message.includes('not found') || message.includes('start registration again')) {
      return c.json({ error: message }, 404);
    }

    if (message.includes('verification failed')) {
      return c.json({ error: message }, 400);
    }

    return c.json({ error: message }, 500);
  }
});

// ============================================================================
// Authentication Endpoints
// ============================================================================

/**
 * POST /api/auth/authenticate/begin
 *
 * Begin WebAuthn authentication ceremony.
 * Returns options for navigator.credentials.get()
 *
 * Request body:
 *   { username: string } - The username (email) for the account to authenticate
 *
 * Response:
 *   200: { options: PublicKeyCredentialRequestOptionsJSON, userId: string }
 *   400: { error: string } - Invalid request
 *   404: { error: string } - User not found or no credentials registered
 */
authRouter.post('/authenticate/begin', async (c) => {
  try {
    const body = await c.req.json<AuthenticateBeginBody>();

    // Validate request
    if (!body.username) {
      return c.json({ error: 'Username is required' }, 400);
    }

    // Generate authentication options
    const result = await beginAuthentication(body.username);

    return c.json({
      options: result.options,
      userId: result.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';

    // Return appropriate status code based on error
    if (message.includes('at least')) {
      return c.json({ error: message }, 400);
    }

    if (message.includes('not found') || message.includes('No credentials')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/auth/authenticate/finish
 *
 * Complete WebAuthn authentication ceremony.
 * Verifies the credential response from the client and issues tokens.
 *
 * Request body:
 *   {
 *     userId: string,        - The user ID from /authenticate/begin
 *     response: object       - The response from navigator.credentials.get()
 *     deviceInfo?: string    - Optional device identifier for session tracking
 *   }
 *
 * Response:
 *   200: {
 *     verified: boolean,
 *     userId: string,
 *     username: string,
 *     credentialId: string,
 *     accessToken: string,
 *     refreshToken: string,
 *     expiresIn: number,
 *     tokenType: 'Bearer'
 *   }
 *   400: { error: string } - Invalid request or verification failed
 *   404: { error: string } - User or credential not found
 */
authRouter.post('/authenticate/finish', async (c) => {
  try {
    const body = await c.req.json<AuthenticateFinishBody>();

    // Validate request
    if (!body.userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    if (!body.response) {
      return c.json({ error: 'Authentication response is required' }, 400);
    }

    // Verify authentication
    const result = await finishAuthentication(body.userId, body.response);

    // Issue tokens on successful authentication
    const tokens = await issueTokens(result.userId, result.username, body.deviceInfo);

    return c.json({
      verified: result.verified,
      userId: result.userId,
      username: result.username,
      credentialId: result.credentialId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';

    // Return appropriate status code based on error
    if (message.includes('not found') || message.includes('start authentication again')) {
      return c.json({ error: message }, 404);
    }

    if (message.includes('verification failed')) {
      return c.json({ error: message }, 400);
    }

    return c.json({ error: message }, 500);
  }
});

// ============================================================================
// Utility Endpoints
// ============================================================================

/**
 * GET /api/auth/status
 *
 * Check if a username has registered credentials.
 * Useful for determining whether to show "Sign In" or "Create Account"
 *
 * Query params:
 *   username: string - The username to check
 *
 * Response:
 *   200: { hasCredentials: boolean, credentialCount: number }
 *   400: { error: string } - Missing username
 */
authRouter.get('/status', async (c) => {
  const username = c.req.query('username');

  if (!username) {
    return c.json({ error: 'Username query parameter is required' }, 400);
  }

  const exists = hasCredentials(username);
  const user = getUserByUsername(username);

  return c.json({
    hasCredentials: exists,
    credentialCount: user?.credentials.length ?? 0,
  });
});

/**
 * GET /api/auth/config
 *
 * Get WebAuthn relying party configuration.
 * Useful for debugging and client configuration.
 *
 * Response:
 *   200: { rpName: string, rpId: string, tokens: { accessTokenExpiry, refreshTokenExpiry } }
 */
authRouter.get('/config', async (c) => {
  const rpConfig = getRpConfig();
  const tokenCfg = getTokenConfig();

  return c.json({
    rpName: rpConfig.name,
    rpId: rpConfig.id,
    tokens: {
      accessTokenExpiry: tokenCfg.accessTokenExpiry,
      refreshTokenExpiry: tokenCfg.refreshTokenExpiry,
    },
  });
});

// ============================================================================
// Token Management Endpoints
// ============================================================================

/**
 * POST /api/auth/token/refresh
 *
 * Refresh access token using a valid refresh token.
 * Issues a new token pair and invalidates the old refresh token.
 *
 * Request body:
 *   { refreshToken: string }
 *
 * Response:
 *   200: { accessToken, refreshToken, expiresIn, tokenType }
 *   400: { error: string } - Missing refresh token
 *   401: { error: string } - Invalid or expired refresh token
 */
authRouter.post('/token/refresh', async (c) => {
  try {
    const body = await c.req.json<RefreshTokenBody>();

    if (!body.refreshToken) {
      return c.json({ error: 'Refresh token is required' }, 400);
    }

    const tokens = await refreshAccessToken(body.refreshToken);

    if (!tokens) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    return c.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/auth/logout
 *
 * Revoke the current session (logout).
 * Requires a valid access token.
 * Optionally revokes all sessions for the user.
 *
 * Query params:
 *   all: boolean - If true, revoke all sessions for the user
 *
 * Request body (optional):
 *   { refreshToken?: string } - Specific refresh token to revoke
 *
 * Response:
 *   200: { success: boolean, sessionsRevoked: number }
 *   401: { error: string } - Unauthorized
 */
const logoutRouter = new Hono<{ Variables: AuthVariables }>();
logoutRouter.use(requireAuth());
logoutRouter.post('/', async (c) => {
  try {
    const user = c.get('user');
    const revokeAll = c.req.query('all') === 'true';

    let refreshToken: string | undefined;

    // Try to get refresh token from body (optional)
    try {
      const body = await c.req.json<{ refreshToken?: string }>();
      refreshToken = body.refreshToken;
    } catch {
      // No body or invalid JSON - that's OK
    }

    let revokedCount: number;

    if (revokeAll) {
      // Revoke all sessions for this user
      revokedCount = await revokeSession(user.userId);
    } else if (refreshToken) {
      // Revoke specific session
      revokedCount = await revokeSession(user.userId, refreshToken);
    } else {
      // Just acknowledge logout - client should discard tokens
      revokedCount = 0;
    }

    return c.json({
      success: true,
      sessionsRevoked: revokedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logout failed';
    return c.json({ error: message }, 500);
  }
});

authRouter.route('/logout', logoutRouter);

/**
 * GET /api/auth/session
 *
 * Get current session information.
 * Requires a valid access token.
 *
 * Response:
 *   200: { userId, username, activeSessions }
 *   401: { error: string } - Unauthorized
 */
const sessionRouter = new Hono<{ Variables: AuthVariables }>();
sessionRouter.use(requireAuth());
sessionRouter.get('/', async (c) => {
  const user = c.get('user');
  const activeSessions = getActiveSessionCount(user.userId);

  return c.json({
    userId: user.userId,
    username: user.username,
    activeSessions,
  });
});

authRouter.route('/session', sessionRouter);

export default authRouter;
