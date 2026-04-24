import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSyncState, isSyncing, stopSync, subscribeSyncEvents } from './couch';

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
