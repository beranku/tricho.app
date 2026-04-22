/**
 * Cross-tab coordination for auth state.
 *
 * When multiple tabs of the PWA are open they share IndexedDB but each has
 * its own in-memory JWT. Without coordination they would all refresh on the
 * same expiry tick (thundering herd). This module exposes a thin
 * BroadcastChannel wrapper so the tab that refreshes broadcasts the new JWT
 * to its peers, which skip their own refresh.
 */

export type TabMessage =
  | { type: 'jwt'; jwt: string; jwtExp: number }
  | { type: 'signed-out' }
  | { type: 'locked' };

export type TabListener = (message: TabMessage) => void;

export class TabChannel {
  private channel: BroadcastChannel | null;
  private listeners = new Set<TabListener>();

  constructor(name: string) {
    this.channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(`tricho-auth-${name}`)
        : null;
    this.channel?.addEventListener('message', (ev) => {
      for (const l of this.listeners) l(ev.data as TabMessage);
    });
  }

  post(message: TabMessage): void {
    this.channel?.postMessage(message);
  }

  onMessage(listener: TabListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
  }
}
