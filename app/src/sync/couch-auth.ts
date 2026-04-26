/**
 * CouchDB URL helpers.
 *
 * Authentication is done through tricho-auth (OAuth → JWT) in src/auth/.
 * This module only exports the pieces that any sync consumer needs regardless
 * of how the session was established: the CouchDB base URL and the per-user
 * DB URL derived from the hex-encoded username.
 */

const COUCHDB_URL = (import.meta.env?.VITE_COUCHDB_URL as string | undefined) ?? 'http://localhost:5984';

export function getCouchdbUrl(): string {
  return COUCHDB_URL;
}

/**
 * CouchDB with `couch_peruser` enabled creates `userdb-<hex(username)>` per
 * authenticated user. Give a username in, get the replication URL back.
 */
export function userDbUrlFor(username: string): string {
  const hex = Array.from(new TextEncoder().encode(username))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${COUCHDB_URL}/userdb-${hex}`;
}
