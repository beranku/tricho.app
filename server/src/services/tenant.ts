/**
 * Tenant Service
 *
 * Handles user/tenant provisioning with CouchDB database creation.
 * Each user gets their own CouchDB database for storing encrypted documents.
 * The database name is derived from the user ID to ensure uniqueness.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Result from provisioning a new tenant
 */
export interface ProvisionTenantResult {
  success: boolean;
  tenantId: string;
  databaseName: string;
  databaseUrl: string;
  error?: string;
}

/**
 * Result from checking tenant status
 */
export interface TenantStatus {
  exists: boolean;
  tenantId: string;
  databaseName: string;
  databaseUrl: string;
  docCount?: number;
  diskSize?: number;
}

/**
 * CouchDB database info response
 */
interface CouchDBDatabaseInfo {
  db_name: string;
  doc_count: number;
  disk_size: number;
  update_seq: string;
}

/**
 * Tenant record for tracking provisioned databases
 */
export interface TenantRecord {
  userId: string;
  databaseName: string;
  createdAt: Date;
  status: 'active' | 'suspended' | 'deleted';
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * CouchDB configuration
 * In production, these should come from environment variables
 */
const couchDbConfig = {
  /** CouchDB admin URL */
  url: process.env.COUCHDB_URL || 'http://localhost:5984',
  /** CouchDB admin username */
  adminUser: process.env.COUCHDB_USER || 'admin',
  /** CouchDB admin password */
  adminPassword: process.env.COUCHDB_PASSWORD || 'password',
  /** Database name prefix for tenant databases */
  databasePrefix: process.env.COUCHDB_DB_PREFIX || 'tricho_user_',
};

// ============================================================================
// In-Memory Tenant Registry (Development Only)
// ============================================================================

/**
 * In-memory tenant registry
 * WARNING: This is for development only. Replace with persistent storage in production.
 */
const tenants = new Map<string, TenantRecord>();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a safe CouchDB database name from user ID
 * CouchDB database names must start with a lowercase letter and can only contain
 * lowercase letters (a-z), digits (0-9), and special characters: _ $ ( ) + - /
 *
 * @param userId - The user's unique ID
 * @returns A valid CouchDB database name
 */
function generateDatabaseName(userId: string): string {
  // Sanitize user ID: convert to lowercase, replace invalid chars
  const sanitized = userId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${couchDbConfig.databasePrefix}${sanitized}`;
}

/**
 * Get basic auth header for CouchDB admin requests
 */
function getAuthHeader(): string {
  const credentials = `${couchDbConfig.adminUser}:${couchDbConfig.adminPassword}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Get the full URL for a tenant database
 */
function getDatabaseUrl(databaseName: string): string {
  return `${couchDbConfig.url}/${databaseName}`;
}

/**
 * Make a request to CouchDB
 */
async function couchDbRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${couchDbConfig.url}${path}`;
  const headers: Record<string, string> = {
    'Authorization': getAuthHeader(),
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

// ============================================================================
// Database Management Functions
// ============================================================================

/**
 * Check if a CouchDB database exists
 *
 * @param databaseName - The database name to check
 * @returns True if the database exists
 */
async function databaseExists(databaseName: string): Promise<boolean> {
  try {
    const response = await couchDbRequest(`/${databaseName}`, {
      method: 'HEAD',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create a new CouchDB database
 *
 * @param databaseName - The database name to create
 * @returns True if creation succeeded
 */
async function createDatabase(databaseName: string): Promise<boolean> {
  try {
    const response = await couchDbRequest(`/${databaseName}`, {
      method: 'PUT',
    });

    if (response.ok) {
      return true;
    }

    // Database might already exist (409 Conflict)
    if (response.status === 409) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get database info from CouchDB
 *
 * @param databaseName - The database name
 * @returns Database info or null if not found
 */
async function getDatabaseInfo(databaseName: string): Promise<CouchDBDatabaseInfo | null> {
  try {
    const response = await couchDbRequest(`/${databaseName}`, {
      method: 'GET',
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as CouchDBDatabaseInfo;
  } catch {
    return null;
  }
}

/**
 * Delete a CouchDB database
 * WARNING: This permanently deletes all data in the database
 *
 * @param databaseName - The database name to delete
 * @returns True if deletion succeeded
 */
async function deleteDatabase(databaseName: string): Promise<boolean> {
  try {
    const response = await couchDbRequest(`/${databaseName}`, {
      method: 'DELETE',
    });

    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/**
 * Set up database security rules
 * Creates a security document that restricts access to the database
 *
 * @param databaseName - The database name
 * @param userId - The user ID who should have access
 * @returns True if security was set up successfully
 */
async function setupDatabaseSecurity(
  databaseName: string,
  userId: string
): Promise<boolean> {
  try {
    const securityDoc = {
      admins: {
        names: [couchDbConfig.adminUser],
        roles: ['_admin'],
      },
      members: {
        names: [userId],
        roles: [],
      },
    };

    const response = await couchDbRequest(`/${databaseName}/_security`, {
      method: 'PUT',
      body: JSON.stringify(securityDoc),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create design documents for the database
 * Sets up indexes and views needed for efficient queries
 *
 * @param databaseName - The database name
 * @returns True if design documents were created successfully
 */
async function createDesignDocuments(databaseName: string): Promise<boolean> {
  try {
    // Create a design document for common views
    const designDoc = {
      _id: '_design/tricho',
      language: 'javascript',
      views: {
        // View to find documents by type
        by_type: {
          map: 'function(doc) { if (doc.type) { emit(doc.type, null); } }',
        },
        // View to find documents by update time
        by_updated: {
          map: 'function(doc) { if (doc.updatedAt) { emit(doc.updatedAt, null); } }',
        },
        // View to find non-deleted documents
        active: {
          map: 'function(doc) { if (!doc.deleted) { emit(doc._id, null); } }',
        },
      },
    };

    const response = await couchDbRequest(`/${databaseName}/_design/tricho`, {
      method: 'PUT',
      body: JSON.stringify(designDoc),
    });

    // 409 means it already exists, which is fine
    return response.ok || response.status === 409;
  } catch {
    return false;
  }
}

// ============================================================================
// Tenant Provisioning Functions
// ============================================================================

/**
 * Provision a new tenant (create their CouchDB database)
 *
 * This is called after successful user registration to set up their data store.
 * Creates the database, security rules, and design documents.
 *
 * @param userId - The user's unique ID
 * @returns Provisioning result with database details
 */
export async function provisionTenant(userId: string): Promise<ProvisionTenantResult> {
  // Check if tenant already exists
  const existingTenant = tenants.get(userId);
  if (existingTenant) {
    return {
      success: true,
      tenantId: userId,
      databaseName: existingTenant.databaseName,
      databaseUrl: getDatabaseUrl(existingTenant.databaseName),
    };
  }

  // Generate database name
  const databaseName = generateDatabaseName(userId);
  const databaseUrl = getDatabaseUrl(databaseName);

  // Create the database
  const created = await createDatabase(databaseName);
  if (!created) {
    return {
      success: false,
      tenantId: userId,
      databaseName,
      databaseUrl,
      error: 'Failed to create database',
    };
  }

  // Set up security
  const securitySet = await setupDatabaseSecurity(databaseName, userId);
  if (!securitySet) {
    // Database was created but security failed - this is a warning, not fatal
    // In production, you might want to retry or alert
  }

  // Create design documents
  const designCreated = await createDesignDocuments(databaseName);
  if (!designCreated) {
    // Design docs failed - this is also a warning
    // Views can be created later if needed
  }

  // Record the tenant
  const tenant: TenantRecord = {
    userId,
    databaseName,
    createdAt: new Date(),
    status: 'active',
  };
  tenants.set(userId, tenant);

  return {
    success: true,
    tenantId: userId,
    databaseName,
    databaseUrl,
  };
}

/**
 * Get tenant status and database info
 *
 * @param userId - The user's unique ID
 * @returns Tenant status with database details
 */
export async function getTenantStatus(userId: string): Promise<TenantStatus> {
  const tenant = tenants.get(userId);
  const databaseName = tenant?.databaseName || generateDatabaseName(userId);
  const databaseUrl = getDatabaseUrl(databaseName);

  // Check if database exists in CouchDB
  const exists = await databaseExists(databaseName);

  if (!exists) {
    return {
      exists: false,
      tenantId: userId,
      databaseName,
      databaseUrl,
    };
  }

  // Get database info
  const info = await getDatabaseInfo(databaseName);

  return {
    exists: true,
    tenantId: userId,
    databaseName,
    databaseUrl,
    docCount: info?.doc_count,
    diskSize: info?.disk_size,
  };
}

/**
 * Suspend a tenant (disable their database access)
 * This doesn't delete data, just marks the tenant as suspended
 *
 * @param userId - The user's unique ID
 * @returns True if suspension succeeded
 */
export async function suspendTenant(userId: string): Promise<boolean> {
  const tenant = tenants.get(userId);
  if (!tenant) {
    return false;
  }

  tenant.status = 'suspended';
  tenants.set(userId, tenant);
  return true;
}

/**
 * Reactivate a suspended tenant
 *
 * @param userId - The user's unique ID
 * @returns True if reactivation succeeded
 */
export async function reactivateTenant(userId: string): Promise<boolean> {
  const tenant = tenants.get(userId);
  if (!tenant) {
    return false;
  }

  tenant.status = 'active';
  tenants.set(userId, tenant);
  return true;
}

/**
 * Delete a tenant and their database
 * WARNING: This permanently deletes all user data
 *
 * @param userId - The user's unique ID
 * @returns True if deletion succeeded
 */
export async function deleteTenant(userId: string): Promise<boolean> {
  const tenant = tenants.get(userId);
  if (!tenant) {
    return false;
  }

  // Delete the database
  const deleted = await deleteDatabase(tenant.databaseName);
  if (!deleted) {
    return false;
  }

  // Update tenant record
  tenant.status = 'deleted';
  tenants.set(userId, tenant);

  return true;
}

/**
 * Get tenant by user ID
 *
 * @param userId - The user's unique ID
 * @returns Tenant record or undefined
 */
export function getTenant(userId: string): TenantRecord | undefined {
  return tenants.get(userId);
}

/**
 * Check if tenant is active
 *
 * @param userId - The user's unique ID
 * @returns True if tenant exists and is active
 */
export function isTenantActive(userId: string): boolean {
  const tenant = tenants.get(userId);
  return tenant?.status === 'active';
}

// ============================================================================
// Database Credential Functions
// ============================================================================

/**
 * Generate database credentials for a user
 * In a production system, this would create a per-user CouchDB user
 * For development, we return the database URL with inline auth
 *
 * @param userId - The user's unique ID
 * @returns Object with database connection details
 */
export function getDatabaseCredentials(userId: string): {
  databaseName: string;
  databaseUrl: string;
  syncUrl: string;
} {
  const tenant = tenants.get(userId);
  const databaseName = tenant?.databaseName || generateDatabaseName(userId);

  // Full URL including auth for development
  // In production, use per-user credentials or JWT proxy
  const authUrl = `${couchDbConfig.url.replace('://', `://${couchDbConfig.adminUser}:${couchDbConfig.adminPassword}@`)}/${databaseName}`;

  return {
    databaseName,
    databaseUrl: getDatabaseUrl(databaseName),
    syncUrl: authUrl,
  };
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Get CouchDB configuration (for debugging/info endpoints)
 * Excludes sensitive credentials
 */
export function getCouchDbConfig(): { url: string; databasePrefix: string } {
  return {
    url: couchDbConfig.url,
    databasePrefix: couchDbConfig.databasePrefix,
  };
}

/**
 * Test CouchDB connection
 *
 * @returns True if CouchDB is reachable
 */
export async function testConnection(): Promise<boolean> {
  try {
    const response = await couchDbRequest('/', { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get all tenant records (for admin purposes)
 * WARNING: Only use for debugging/admin interfaces
 *
 * @returns Array of all tenant records
 */
export function getAllTenants(): TenantRecord[] {
  return Array.from(tenants.values());
}
