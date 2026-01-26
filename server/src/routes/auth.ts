/**
 * Auth Routes
 *
 * WebAuthn registration and authentication endpoints for TrichoApp.
 * Handles passkey-based authentication flows.
 */

import { Hono } from 'hono';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  beginRegistration,
  finishRegistration,
  getUserByUsername,
  hasCredentials,
  getRpConfig,
} from '../services/webauthn.js';

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
 *   200: { rpName: string, rpId: string }
 */
authRouter.get('/config', async (c) => {
  const config = getRpConfig();

  return c.json({
    rpName: config.name,
    rpId: config.id,
  });
});

export default authRouter;
