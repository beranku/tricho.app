/**
 * jsdom polyfills + globals for component tests.
 *
 * jsdom doesn't ship: getUserMedia, navigator.credentials (full),
 * BroadcastChannel, IntersectionObserver, ResizeObserver, or
 * HTMLCanvasElement.toBlob. Components in this app consume several of
 * these, so a shared shim keeps every test file free of boilerplate.
 *
 * Also pulls in @testing-library/jest-dom matchers.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

// Reset DOM + mocks between tests so one test's side effects don't leak.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // ── getUserMedia ─────────────────────────────────────────────────
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
          getVideoTracks: () => [{ stop: vi.fn() }],
          getAudioTracks: () => [],
        }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
  }

  // ── WebAuthn credential API ──────────────────────────────────────
  if (!navigator.credentials) {
    Object.defineProperty(navigator, 'credentials', {
      writable: true,
      value: {
        create: vi.fn().mockResolvedValue(null),
        get: vi.fn().mockResolvedValue(null),
      },
    });
  }

  // ── BroadcastChannel ─────────────────────────────────────────────
  if (typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel === 'undefined') {
    (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = class {
      name: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor(name: string) { this.name = name; }
      postMessage(): void { /* no-op in tests */ }
      close(): void { /* no-op */ }
      addEventListener(): void { /* no-op */ }
      removeEventListener(): void { /* no-op */ }
    } as unknown;
  }

  // ── IntersectionObserver / ResizeObserver ────────────────────────
  if (typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === 'undefined') {
    (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] { return []; }
    } as unknown;
  }
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown;
  }

  // ── HTMLCanvasElement.toBlob — jsdom has no canvas backend ───────
  if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.toBlob) {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback): void {
      queueMicrotask(() => cb(new Blob([new Uint8Array(8)], { type: 'image/png' })));
    };
  }
});

/**
 * Minimal a11y invariants every screen must satisfy. Call at the end of
 * each component test. Throws with a descriptive message on violation.
 */
export function expectA11yBasics(s: typeof screen = screen): void {
  const inputs = s.queryAllByRole('textbox')
    .concat(s.queryAllByRole('spinbutton'))
    .concat(s.queryAllByRole('combobox'));
  for (const input of inputs) {
    const label = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
    const id = input.getAttribute('id');
    const hasExternalLabel = id ? s.container?.querySelector(`label[for="${id}"]`) : null;
    if (!label && !hasExternalLabel) {
      throw new Error(
        `a11y: input without label — ${input.outerHTML.slice(0, 120)}`,
      );
    }
  }
  const buttons = s.queryAllByRole('button');
  for (const btn of buttons) {
    const text = btn.textContent?.trim();
    const aria = btn.getAttribute('aria-label');
    if (!text && !aria) {
      throw new Error(
        `a11y: button without accessible name — ${btn.outerHTML.slice(0, 120)}`,
      );
    }
  }
}
