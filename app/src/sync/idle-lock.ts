/**
 * Idle lock: clears in-memory secrets after inactivity.
 *
 * The DEK and JWT stay in memory for as long as the user is actively using
 * the app. After `timeoutMs` of no user interaction, `onLock` fires; the
 * caller is expected to clear its state and show the unlock screen.
 *
 * The identity doc remains encrypted at rest so we can resume once the user
 * unlocks again without reprompting for OAuth.
 */

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_EVENTS: Array<keyof WindowEventMap> = [
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

export interface IdleLockOptions {
  timeoutMs?: number;
  onLock: () => void;
}

export class IdleLock {
  private timeoutMs: number;
  private onLock: () => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private bound = false;
  private handleActivity = () => this.reset();

  constructor(opts: IdleLockOptions) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onLock = opts.onLock;
  }

  start(): void {
    if (this.bound) return;
    this.bound = true;
    for (const evt of WINDOW_EVENTS) {
      window.addEventListener(evt, this.handleActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', this.handleActivity);
    this.reset();
  }

  stop(): void {
    if (!this.bound) return;
    this.bound = false;
    for (const evt of WINDOW_EVENTS) {
      window.removeEventListener(evt, this.handleActivity);
    }
    document.removeEventListener('visibilitychange', this.handleActivity);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onLock(), this.timeoutMs);
  }
}
