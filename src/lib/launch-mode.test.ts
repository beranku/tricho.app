import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectBrowser, detectLaunchMode } from './launch-mode';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

function stubMatchMedia(standalone: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)' ? standalone : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  // window.matchMedia (jsdom binds it to globalThis already).
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: globalThis.matchMedia,
  });
}

function stubNavigator(opts: { ua: string; standalone?: boolean }): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: opts.ua,
  });
  Object.defineProperty(window.navigator, 'standalone', {
    configurable: true,
    value: opts.standalone ?? false,
  });
}

describe('detectLaunchMode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns "pwa" when display-mode is standalone (Android Chrome)', () => {
    stubMatchMedia(true);
    stubNavigator({ ua: ANDROID_UA });
    expect(detectLaunchMode()).toBe('pwa');
  });

  it('returns "pwa" when navigator.standalone is true (legacy iOS)', () => {
    stubMatchMedia(false);
    stubNavigator({ ua: IOS_UA, standalone: true });
    expect(detectLaunchMode()).toBe('pwa');
  });

  it('returns "browser" when neither flag is set (regular tab)', () => {
    stubMatchMedia(false);
    stubNavigator({ ua: DESKTOP_UA, standalone: false });
    expect(detectLaunchMode()).toBe('browser');
  });

  it('returns "browser" when matchMedia throws', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => {
        throw new Error('not supported');
      }),
    );
    stubNavigator({ ua: DESKTOP_UA });
    expect(detectLaunchMode()).toBe('browser');
  });
});

describe('detectBrowser', () => {
  afterEach(() => {
    // Reset UA / standalone to avoid leakage.
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: DESKTOP_UA,
    });
  });

  it('returns "ios" for iPhone Safari UA', () => {
    stubNavigator({ ua: IOS_UA });
    expect(detectBrowser()).toBe('ios');
  });

  it('returns "ios" for iPad Safari UA', () => {
    stubNavigator({
      ua: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile',
    });
    expect(detectBrowser()).toBe('ios');
  });

  it('returns "android" for Android Chrome UA', () => {
    stubNavigator({ ua: ANDROID_UA });
    expect(detectBrowser()).toBe('android');
  });

  it('returns "other" for desktop UAs', () => {
    stubNavigator({ ua: DESKTOP_UA });
    expect(detectBrowser()).toBe('other');
  });

  it('returns "other" for Firefox on Linux', () => {
    stubNavigator({
      ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
    });
    expect(detectBrowser()).toBe('other');
  });
});

describe('detectLaunchMode × detectBrowser combinations', () => {
  afterEach(() => vi.unstubAllGlobals());

  const cases: Array<{
    label: string;
    ua: string;
    standalone: boolean;
    expectedMode: 'browser' | 'pwa';
    expectedBrowser: 'ios' | 'android' | 'other';
  }> = [
    { label: 'browser × ios', ua: IOS_UA, standalone: false, expectedMode: 'browser', expectedBrowser: 'ios' },
    { label: 'browser × android', ua: ANDROID_UA, standalone: false, expectedMode: 'browser', expectedBrowser: 'android' },
    { label: 'browser × other', ua: DESKTOP_UA, standalone: false, expectedMode: 'browser', expectedBrowser: 'other' },
    { label: 'pwa × ios (display-mode)', ua: IOS_UA, standalone: true, expectedMode: 'pwa', expectedBrowser: 'ios' },
    { label: 'pwa × android', ua: ANDROID_UA, standalone: true, expectedMode: 'pwa', expectedBrowser: 'android' },
    { label: 'pwa × other', ua: DESKTOP_UA, standalone: true, expectedMode: 'pwa', expectedBrowser: 'other' },
  ];

  for (const c of cases) {
    it(c.label, () => {
      stubMatchMedia(c.standalone);
      stubNavigator({ ua: c.ua, standalone: c.standalone });
      expect(detectLaunchMode()).toBe(c.expectedMode);
      expect(detectBrowser()).toBe(c.expectedBrowser);
    });
  }
});
