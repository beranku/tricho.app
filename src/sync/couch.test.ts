import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifySyncError, getSyncState, isSyncing, stopSync, subscribeSyncEvents } from './couch';

// startSync + the deterministic conflict resolver exercise PouchDB's
// replicator loop, which is integration territory (real CouchDB). These
// unit tests cover the public state + listener API only.
//
// Module-level state persists across tests; stopSync() in afterEach
// restores the idle baseline so one test doesn't poison the next.

afterEach(() => {
  stopSync();
});

describe('getSyncState', () => {
  it('starts out idle with zero counters', () => {
    const s = getSyncState();
    expect(s.status).toBe('idle');
    expect(s.pushed).toBe(0);
    expect(s.pulled).toBe(0);
    expect(s.username).toBeNull();
    expect(s.error).toBeNull();
    expect(s.errorClass).toBeNull();
  });
});

describe('isSyncing', () => {
  it('false before any startSync', () => {
    expect(isSyncing()).toBe(false);
  });
});

describe('subscribeSyncEvents', () => {
  it('invokes the listener synchronously with the current state on subscribe', () => {
    let captured: ReturnType<typeof getSyncState> | null = null;
    const unsubscribe = subscribeSyncEvents((s) => {
      captured = s;
    });
    expect(captured).toEqual(getSyncState());
    unsubscribe();
  });

  it('emits when stopSync mutates state', () => {
    const events: string[] = [];
    const unsubscribe = subscribeSyncEvents((s) => events.push(s.status));
    events.length = 0; // drop initial subscribe callback
    stopSync();
    expect(events).toContain('idle');
    unsubscribe();
  });

  it('unsubscribe stops further notifications', () => {
    let count = 0;
    const unsubscribe = subscribeSyncEvents(() => {
      count += 1;
    });
    const baseline = count;
    unsubscribe();
    stopSync();
    expect(count).toBe(baseline);
  });

  it('multiple listeners each receive events', () => {
    const a: string[] = [];
    const b: string[] = [];
    const uA = subscribeSyncEvents((s) => a.push(s.status));
    const uB = subscribeSyncEvents((s) => b.push(s.status));
    a.length = b.length = 0;
    stopSync();
    expect(a).toContain('idle');
    expect(b).toContain('idle');
    uA();
    uB();
  });
});

describe('stopSync idempotence', () => {
  it('safe to call multiple times when not running', () => {
    expect(() => {
      stopSync();
      stopSync();
      stopSync();
    }).not.toThrow();
    expect(getSyncState().status).toBe('idle');
  });
});

describe('classifySyncError', () => {
  it('classifies 401/403 as auth', () => {
    expect(classifySyncError({ status: 401 })).toBe('auth');
    expect(classifySyncError({ status: 403 })).toBe('auth');
  });

  it('classifies 412/409 as vault-mismatch', () => {
    expect(classifySyncError({ status: 412 })).toBe('vault-mismatch');
    expect(classifySyncError({ status: 409 })).toBe('vault-mismatch');
  });

  it('classifies network-y errors by name and message keywords', () => {
    expect(classifySyncError({ name: 'NetworkError' })).toBe('network');
    expect(classifySyncError({ name: 'AbortError' })).toBe('network');
    expect(classifySyncError({ name: 'TypeError', message: 'Failed to fetch' })).toBe('network');
    expect(classifySyncError({ message: 'CORS policy blocked' })).toBe('network');
    expect(classifySyncError({ message: 'TLS handshake' })).toBe('network');
  });

  it('classifies auth-ish messages without status code', () => {
    expect(classifySyncError({ message: 'unauthorized' })).toBe('auth');
    expect(classifySyncError({ message: 'token expired' })).toBe('auth');
    expect(classifySyncError({ message: 'forbidden access' })).toBe('auth');
  });

  it('falls back to unknown', () => {
    expect(classifySyncError({ message: 'something broke' })).toBe('unknown');
    expect(classifySyncError({})).toBe('unknown');
    expect(classifySyncError(null)).toBe('unknown');
    expect(classifySyncError(undefined)).toBe('unknown');
  });

  it('HTTP status takes precedence over message keyword heuristics', () => {
    // A 412 with the word "unauthorized" in the message is still a vault
    // mismatch — status wins.
    expect(classifySyncError({ status: 412, message: 'unauthorized' })).toBe('vault-mismatch');
  });
});
