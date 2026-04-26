/**
 * Live sync between the local PouchDB and the user's CouchDB per-user database.
 *
 * PouchDB already handles checkpointing, retry, and event reporting — so this
 * module is mostly a thin state layer for the UI, plus a deterministic
 * conflict resolver that keeps the revision with the latest `updatedAt` and
 * discards the losers.
 */

import type PouchDBType from 'pouchdb-browser';
import type { VaultDb } from '../db/pouch';
import type { BaseEncryptedDoc } from '../db/types';
import { userDbUrlFor } from './couch-auth';

type PouchConstructor = typeof PouchDBType;

let pouchPromise: Promise<PouchConstructor> | null = null;
async function getPouch(): Promise<PouchConstructor> {
  if (pouchPromise) return pouchPromise;
  pouchPromise = (async () => {
    const [{ default: PouchDB }, { default: PouchFind }] = await Promise.all([
      import('pouchdb-browser'),
      import('pouchdb-find'),
    ]);
    PouchDB.plugin(PouchFind);
    return PouchDB as PouchConstructor;
  })();
  return pouchPromise;
}

export type SyncStatus = 'idle' | 'connecting' | 'syncing' | 'paused' | 'error' | 'gated';

/**
 * Coarse classification of a sync error. The UI uses this to render a
 * humanised message; the raw `error` string is kept for diagnostics.
 *
 * - `network`: transport-level failure (offline, CORS, DNS, TLS).
 * - `auth`: server returned 401 (refresh token rotated, signed out).
 * - `vault-mismatch`: server refused our payload (412, 409 on vault-state).
 * - `unknown`: anything we couldn't classify.
 */
export type SyncErrorClass = 'network' | 'auth' | 'vault-mismatch' | 'unknown';

export interface SyncState {
  status: SyncStatus;
  error: string | null;
  /** Set whenever `status === 'error'`; null otherwise. */
  errorClass: SyncErrorClass | null;
  lastEventAt: number | null;
  pushed: number;
  pulled: number;
  username: string | null;
  /** When status is 'gated', the paidUntil from the 402 response. */
  gatedPaidUntil?: number | null;
  gatedReason?: string | null;
}

export type SyncListener = (state: SyncState) => void;

const listeners = new Set<SyncListener>();

let state: SyncState = {
  status: 'idle',
  error: null,
  errorClass: null,
  lastEventAt: null,
  pushed: 0,
  pulled: 0,
  username: null,
};

let active: PouchDB.Replication.Sync<BaseEncryptedDoc> | null = null;
let currentDb: VaultDb | null = null;

function emit(patch: Partial<SyncState>): void {
  state = { ...state, ...patch, lastEventAt: Date.now() };
  for (const l of listeners) l(state);
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSyncEvents(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * MVCC conflict resolution. When a doc has `_conflicts`, pick the revision
 * with the highest `updatedAt`, keep it, mark the losers deleted. Payloads are
 * opaque ciphertext — we can't merge semantically, so newest-wins is the only
 * sensible policy here.
 */
async function resolveConflicts(db: VaultDb, docId: string): Promise<void> {
  const row = await db.pouch.get<BaseEncryptedDoc>(docId, { conflicts: true }).catch(() => null);
  if (!row || !row._conflicts || row._conflicts.length === 0) return;

  const candidates: Array<BaseEncryptedDoc & { _rev: string }> = [row];
  for (const rev of row._conflicts) {
    const alt = await db.pouch.get<BaseEncryptedDoc>(docId, { rev }).catch(() => null);
    if (alt) candidates.push(alt as BaseEncryptedDoc & { _rev: string });
  }
  candidates.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const [keeper, ...losers] = candidates;
  if (!keeper) return;

  for (const loser of losers) {
    await db.pouch.remove(loser._id, loser._rev).catch(() => void 0);
  }
}

export interface StartSyncOpts {
  username: string;
  remoteUrl?: string;
  /**
   * Custom fetch for the PouchDB remote — used to inject `Authorization:
   * Bearer <jwt>` and transparently refresh on 401. If omitted, plain fetch
   * with `credentials: include` is used (cookie-based, legacy path).
   */
  fetch?: typeof fetch;
  onChange?: (change: { id: string; deleted: boolean }) => void;
}

const defaultFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'include' });

export async function startSync(db: VaultDb, opts: StartSyncOpts): Promise<void> {
  stopSync();
  currentDb = db;

  const remoteUrl = opts.remoteUrl ?? userDbUrlFor(opts.username);
  const PouchDB = await getPouch();
  const remote = new PouchDB<BaseEncryptedDoc>(remoteUrl, {
    skip_setup: true,
    fetch: opts.fetch ?? defaultFetch,
  });

  emit({ status: 'connecting', error: null, errorClass: null, username: opts.username, pushed: 0, pulled: 0 });

  active = db.pouch
    .sync(remote, { live: true, retry: true })
    .on('change', (info) => {
      const direction = info.direction;
      const docs = info.change.docs ?? [];
      emit({
        status: 'syncing',
        pushed: state.pushed + (direction === 'push' ? docs.length : 0),
        pulled: state.pulled + (direction === 'pull' ? docs.length : 0),
      });
      for (const d of docs) {
        const id = (d as { _id?: string })._id;
        if (!id) continue;
        opts.onChange?.({ id, deleted: Boolean((d as { _deleted?: boolean })._deleted) });
        void resolveConflicts(db, id);
      }
    })
    .on('paused', (err) => {
      if (isPlanExpiredErr(err)) {
        gateOnPlanExpired(err);
        return;
      }
      emit({
        status: err ? 'paused' : 'paused',
        error: err ? String(err) : null,
        errorClass: err ? classifySyncError(err) : null,
      });
    })
    .on('active', () => emit({ status: 'syncing', error: null, errorClass: null }))
    .on('denied', (err) => {
      if (isPlanExpiredErr(err)) {
        gateOnPlanExpired(err);
        return;
      }
      emit({
        status: 'error',
        error: `denied: ${String(err)}`,
        errorClass: classifySyncError(err),
      });
    })
    .on('error', (err) => {
      if (isPlanExpiredErr(err)) {
        gateOnPlanExpired(err);
        return;
      }
      emit({
        status: 'error',
        error: String(err),
        errorClass: classifySyncError(err),
      });
    });
}

/**
 * Classify a sync error from the PouchDB replication stream into one of
 * four buckets the UI can render a humanised label for. Pattern-matches on
 * the error's `status` (HTTP) when present, falling back to keyword
 * heuristics on `name` and `message`.
 */
export function classifySyncError(err: unknown): SyncErrorClass {
  if (!err) return 'unknown';
  const e = err as { status?: number; name?: string; message?: string };
  // HTTP status takes precedence when PouchDB surfaces it.
  if (e.status === 401 || e.status === 403) return 'auth';
  if (e.status === 412 || e.status === 409) return 'vault-mismatch';
  // Transport-level: offline, network failure, fetch errors.
  const msg = (e.message ?? '').toLowerCase();
  const name = (e.name ?? '').toLowerCase();
  if (
    name === 'networkerror' ||
    name === 'aborterror' ||
    name === 'typeerror' ||
    /failed to fetch|networkerror|offline|cors|dns|tls|certificate/.test(msg)
  ) {
    return 'network';
  }
  // Auth-ish error strings (token expired, unauthorized).
  if (/unauthor(i|i)zed|forbidden|token|signature/.test(msg)) {
    return 'auth';
  }
  return 'unknown';
}

function isPlanExpiredErr(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'PlanExpiredError' || /plan_expired/i.test(e.message ?? '');
}

function gateOnPlanExpired(err: unknown): void {
  const e = err as { paidUntil?: number | null; reason?: string };
  if (active) {
    try { active.cancel(); } catch { /* noop */ }
    active = null;
  }
  emit({
    status: 'gated',
    error: null,
    errorClass: null,
    gatedPaidUntil: e.paidUntil ?? null,
    gatedReason: e.reason ?? 'plan_expired',
  });
}

export function stopSync(): void {
  if (active) {
    active.cancel();
    active = null;
  }
  currentDb = null;
  emit({ status: 'idle', error: null, errorClass: null, username: null });
}

export function isSyncing(): boolean {
  return active !== null;
}
