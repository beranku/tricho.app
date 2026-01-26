/**
 * Environment configuration for TrichoApp
 *
 * This module provides type-safe access to environment variables.
 * Client-side variables must be prefixed with VITE_ to be exposed by Vite.
 *
 * @module config/env
 */

/**
 * Environment configuration interface
 * Contains all client-accessible environment variables
 */
export interface EnvConfig {
  /** CouchDB server URL for document replication */
  couchdbUrl: string;
  /** Auth service URL for WebAuthn endpoints */
  authUrl: string;
  /** Object storage URL for encrypted photo blobs */
  objectStorageUrl: string;
  /** Enable debug logging */
  debug: boolean;
  /** Development mode flag (disables some security checks) */
  devMode: boolean;
}

/**
 * Default configuration values for development
 */
const DEFAULT_CONFIG: EnvConfig = {
  couchdbUrl: 'http://localhost:5984',
  authUrl: 'http://localhost:3000',
  objectStorageUrl: 'http://localhost:9000',
  debug: false,
  devMode: true,
};

/**
 * Parse a boolean environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Get the environment configuration
 * Reads from Vite's import.meta.env and falls back to defaults
 */
function getEnvConfig(): EnvConfig {
  // In browser context, Vite exposes env vars via import.meta.env
  // In Node.js context (SSR), we use process.env
  const isBrowser = typeof window !== 'undefined';

  if (isBrowser) {
    // Client-side: use Vite's import.meta.env
    const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

    return {
      couchdbUrl: env.VITE_COUCHDB_URL || DEFAULT_CONFIG.couchdbUrl,
      authUrl: env.VITE_AUTH_URL || DEFAULT_CONFIG.authUrl,
      objectStorageUrl: env.VITE_OBJECT_STORAGE_URL || DEFAULT_CONFIG.objectStorageUrl,
      debug: parseBoolean(env.VITE_DEBUG, DEFAULT_CONFIG.debug),
      devMode: parseBoolean(env.VITE_DEV_MODE, DEFAULT_CONFIG.devMode),
    };
  }

  // Server-side: return defaults (server has its own env handling)
  return DEFAULT_CONFIG;
}

/**
 * Cached environment configuration
 */
let cachedConfig: EnvConfig | null = null;

/**
 * Get the environment configuration (cached)
 * This is the main export for accessing environment variables
 *
 * @returns The environment configuration object
 *
 * @example
 * ```typescript
 * import { env } from '@/config/env';
 *
 * const replicationUrl = `${env.couchdbUrl}/db_${userId}`;
 * ```
 */
export function getEnv(): EnvConfig {
  if (cachedConfig === null) {
    cachedConfig = getEnvConfig();
  }
  return cachedConfig;
}

/**
 * Convenience export for direct access
 * Use this in components and modules that need environment variables
 */
export const env = getEnv();

/**
 * Validate that required environment variables are set
 * Call this during app initialization to fail fast if config is missing
 *
 * @throws Error if required environment variables are not configured
 */
export function validateEnv(): void {
  const config = getEnv();
  const errors: string[] = [];

  // In production, require all URLs to be properly configured
  if (!config.devMode) {
    if (config.couchdbUrl === DEFAULT_CONFIG.couchdbUrl) {
      errors.push('VITE_COUCHDB_URL must be configured for production');
    }
    if (config.authUrl === DEFAULT_CONFIG.authUrl) {
      errors.push('VITE_AUTH_URL must be configured for production');
    }
    if (config.objectStorageUrl === DEFAULT_CONFIG.objectStorageUrl) {
      errors.push('VITE_OBJECT_STORAGE_URL must be configured for production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get CouchDB URL for a specific user's database
 * Each user has their own CouchDB database for sync
 *
 * @param userId - The user's unique identifier
 * @returns Full URL to the user's CouchDB database
 */
export function getCouchDbUrl(userId: string): string {
  const config = getEnv();
  // Sanitize userId for URL safety
  const safeUserId = encodeURIComponent(userId.toLowerCase().replace(/[^a-z0-9_-]/g, '_'));
  return `${config.couchdbUrl}/user_${safeUserId}`;
}

/**
 * Get auth service endpoint URL
 *
 * @param endpoint - The API endpoint path (e.g., '/api/auth/register/begin')
 * @returns Full URL to the auth service endpoint
 */
export function getAuthUrl(endpoint: string): string {
  const config = getEnv();
  // Ensure endpoint starts with /
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${config.authUrl}${path}`;
}

/**
 * Get object storage URL for photo operations
 *
 * @param path - Optional path within storage (e.g., 'photos/user_123/abc.enc')
 * @returns Full URL to object storage
 */
export function getObjectStorageUrl(path?: string): string {
  const config = getEnv();
  if (path) {
    const safePath = path.startsWith('/') ? path.slice(1) : path;
    return `${config.objectStorageUrl}/${safePath}`;
  }
  return config.objectStorageUrl;
}
