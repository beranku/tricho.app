import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleLock } from './idle-lock';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('IdleLock.start / onLock', () => {
  it('fires onLock exactly once after the timeout elapses', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ timeoutMs: 1000, onLock });
    lock.start();

    vi.advanceTimersByTime(999);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);

    // After firing, another full interval without a reset should NOT fire again
    // because the timer is one-shot per cycle.
    vi.advanceTimersByTime(10_000);
    expect(onLock).toHaveBeenCalledTimes(1);

    lock.stop();
  });

  it('uses the default 15-minute timeout when none is provided', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ onLock });
    lock.start();
    vi.advanceTimersByTime(15 * 60 * 1000 - 1);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);
    lock.stop();
  });
});

describe('activity resets the timer', () => {
  it('a DOM event (mousedown) resets the countdown', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ timeoutMs: 500, onLock });
    lock.start();

    vi.advanceTimersByTime(400);
    window.dispatchEvent(new Event('mousedown'));
    vi.advanceTimersByTime(400);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onLock).toHaveBeenCalledTimes(1);

    lock.stop();
  });

  it('visibilitychange resets the timer too', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ timeoutMs: 300, onLock });
    lock.start();
    vi.advanceTimersByTime(250);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(250);
    expect(onLock).not.toHaveBeenCalled();
    lock.stop();
  });
});

describe('stop()', () => {
  it('prevents onLock from firing', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ timeoutMs: 500, onLock });
    lock.start();
    vi.advanceTimersByTime(100);
    lock.stop();
    vi.advanceTimersByTime(10_000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it('is idempotent when called without start', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ timeoutMs: 500, onLock });
    expect(() => {
      lock.stop();
      lock.stop();
    }).not.toThrow();
  });

  it('unbinds event listeners so later events do nothing', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ timeoutMs: 500, onLock });
    lock.start();
    lock.stop();
    vi.advanceTimersByTime(400);
    window.dispatchEvent(new Event('mousedown'));
    // After stop, dispatching events must not start a new timer.
    vi.advanceTimersByTime(10_000);
    expect(onLock).not.toHaveBeenCalled();
  });
});

describe('start is idempotent', () => {
  it('calling start twice does not double-fire onLock', () => {
    const onLock = vi.fn();
    const lock = new IdleLock({ timeoutMs: 500, onLock });
    lock.start();
    lock.start();
    vi.advanceTimersByTime(500);
    expect(onLock).toHaveBeenCalledTimes(1);
    lock.stop();
  });
});
