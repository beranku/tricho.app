/**
 * Cross-island state tests — sheet, phoneScroll. Theme is tested separately
 * with the IndexedDB-backed PouchDB harness (component tier).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { sheetStore, openSheet, closeSheet } from './sheet';
import { phoneScrollStore } from './phoneScroll';

describe('sheetStore', () => {
  beforeEach(() => {
    closeSheet();
  });

  it('starts closed', () => {
    expect(sheetStore.get()).toEqual({ open: false, type: null, triggerId: null });
  });

  it('opens with type and trigger', () => {
    openSheet('menu', { triggerId: 'menu-btn' });
    expect(sheetStore.get()).toMatchObject({ open: true, type: 'menu', triggerId: 'menu-btn' });
  });

  it('replaces an existing sheet on a new open', () => {
    openSheet('menu');
    openSheet('fab-add', { payload: { startAt: 1234 } });
    const state = sheetStore.get();
    expect(state.type).toBe('fab-add');
    expect(state.payload?.startAt).toBe(1234);
  });

  it('two subscribers see the same state', () => {
    const seenA: boolean[] = [];
    const seenB: boolean[] = [];
    const unsubA = sheetStore.listen((s) => seenA.push(s.open));
    const unsubB = sheetStore.listen((s) => seenB.push(s.open));
    openSheet('menu');
    expect(seenA).toEqual([true]);
    expect(seenB).toEqual([true]);
    unsubA();
    unsubB();
  });
});

describe('phoneScrollStore', () => {
  it('starts with no stuck day, today not in view', () => {
    expect(phoneScrollStore.get()).toEqual({
      stuckDay: null,
      todayInView: false,
      todayDirection: null,
    });
  });

  it('emits to subscribers on update', () => {
    const seen: Array<typeof phoneScrollStore.value> = [];
    const unsub = phoneScrollStore.listen((s) => seen.push({ ...s }));
    phoneScrollStore.set({ stuckDay: '2026-04-25', todayInView: true, todayDirection: null });
    expect(seen.length).toBe(1);
    expect(seen[0]?.stuckDay).toBe('2026-04-25');
    unsub();
  });
});
