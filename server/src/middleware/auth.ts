/**
 * Auth Middleware
 *
 * Hono middleware for protecting routes with JWT authentication.
 * Validates Bearer tokens and adds user information to the request context.
 */

import type { Context, Next, MiddlewareHandler } from 'hono';
import { verifyToken, type TokenPayload } from '../services/tokens.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Authenticated user information added to context
 */
export interface AuthUser {
  userId: string;
  username: string;
  tokenType: 'access' | 'refresh';
}

/**
 * Extended context variables for authenticated requests
 */
export interface AuthVariables {
  user: AuthUser;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 *
 * @param authHeader - Authorization header value
 * @returns Token string or null if not found/invalid
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Auth middleware that requires a valid access token
 *
 * Validates the Bearer token from the Authorization header and adds
 * the authenticated user information to the context.
 *
 * Usage:
 * ```typescript
 * import { requireAuth } from '../middleware/auth.js';
 *
 * app.use('/api/protected/*', requireAuth());
 *
 * app.get('/api/protected/data', (c) => {
 *   const user = c.get('user');
 *   return c.json({ userId: user.userId });
 * });
 * ```
 */
export function requireAuth(): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header',
        },
        401
      );
    }

    const result = await verifyToken(token);

    if (!result.valid || !result.payload) {
      return c.json(
        {
          error: 'Unauthorized',
          message: result.error || 'Invalid token',
        },
        401
      );
    }

    // Only allow access tokens (not refresh tokens) for API access
    if (result.payload.type !== 'access') {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Invalid token type',
        },
        401
      );
    }

    // Add user info to context
    const user: AuthUser = {
      userId: result.payload.sub,
      username: result.payload.username,
      tokenType: result.payload.type,
    };

    c.set('user', user);

    await next();
  };
}

/**
 * Optional auth middleware that validates token if present but doesn't require it
 *
 * Useful for endpoints that behave differently for authenticated vs anonymous users.
 *
 * Usage:
 * ```typescript
 * import { optionalAuth } from '../middleware/auth.js';
 *
 * app.use('/api/public/*', optionalAuth());
 *
 * app.get('/api/public/data', (c) => {
 *   const user = c.get('user'); // May be undefined
 *   if (user) {
 *     return c.json({ message: `Hello, ${user.username}` });
 *   }
 *   return c.json({ message: 'Hello, anonymous' });
 * });
 * ```
 */
export function optionalAuth(): MiddlewareHandler<{ Variables: Partial<AuthVariables> }> {
  return async (c: Context<{ Variables: Partial<AuthVariables> }>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const token = extractBearerToken(authHeader);

    if (token) {
      const result = await verifyToken(token);

      if (result.valid && result.payload && result.payload.type === 'access') {
        const user: AuthUser = {
          userId: result.payload.sub,
          username: result.payload.username,
          tokenType: result.payload.type,
        };

        c.set('user', user);
      }
    }

    await next();
  };
}

/**
 * Middleware to require a specific token type (access or refresh)
 *
 * Useful for refresh token endpoints that need to accept refresh tokens.
 *
 * @param tokenType - Required token type
 */
export function requireTokenType(
  tokenType: 'access' | 'refresh'
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header',
        },
        401
      );
    }

    const result = await verifyToken(token);

    if (!result.valid || !result.payload) {
      return c.json(
        {
          error: 'Unauthorized',
          message: result.error || 'Invalid token',
        },
        401
      );
    }

    if (result.payload.type !== tokenType) {
      return c.json(
        {
          error: 'Unauthorized',
          message: `Expected ${tokenType} token`,
        },
        401
      );
    }

    const user: AuthUser = {
      userId: result.payload.sub,
      username: result.payload.username,
      tokenType: result.payload.type,
    };

    c.set('user', user);

    await next();
  };
}

/**
 * Extract user from context (type-safe helper)
 *
 * @param c - Hono context
 * @returns AuthUser or undefined
 */
export function getAuthUser(c: Context<{ Variables: AuthVariables }>): AuthUser {
  return c.get('user');
}

/**
 * Check if request is authenticated (helper for optional auth routes)
 *
 * @param c - Hono context
 * @returns true if user is authenticated
 */
export function isAuthenticated(c: Context<{ Variables: Partial<AuthVariables> }>): boolean {
  return c.get('user') !== undefined;
}
