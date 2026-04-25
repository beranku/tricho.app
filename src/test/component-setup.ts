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

  // ── HTMLCanvasElement.toBlob + getContext — jsdom has no canvas backend.
  // jsdom DOES define toBlob but it throws "not implemented", so unconditional overwrite.
  // Blobs returned by the polyfill must expose arrayBuffer() because production
  // code reads canvas captures with `await blob.arrayBuffer()`.
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback): void {
      const bytes = new Uint8Array(8);
      const blob = new Blob([bytes], { type: 'image/jpeg' }) as Blob & { arrayBuffer: () => Promise<ArrayBuffer> };
      // jsdom Blob lacks arrayBuffer in older versions; polyfill it.
      if (typeof blob.arrayBuffer !== 'function') {
        blob.arrayBuffer = () => Promise.resolve(bytes.buffer.slice(0));
      }
      queueMicrotask(() => cb(blob));
    };
  }
  // Same patch on Blob.prototype globally so any Blob created in tests works.
  if (typeof Blob !== 'undefined' && !(Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer) {
    (Blob.prototype as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = function () {
      return Promise.resolve(new Uint8Array(8).buffer);
    };
  }
  if (typeof HTMLCanvasElement !== 'undefined') {
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (type: string) => unknown;
    };
    proto.getContext = function (): unknown {
      return {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
        putImageData: vi.fn(),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
      };
    };
  }

  // ── HTMLMediaElement.play — jsdom doesn't implement video playback
  if (typeof HTMLMediaElement !== 'undefined') {
    const proto = HTMLMediaElement.prototype as unknown as {
      play: () => Promise<void>;
      pause: () => void;
    };
    proto.play = vi.fn(() => Promise.resolve());
    proto.pause = vi.fn();
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
