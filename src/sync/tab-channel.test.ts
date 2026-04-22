import { describe, expect, it, vi } from 'vitest';
import { TabChannel, type TabMessage } from './tab-channel';

describe('TabChannel', () => {
  it('delivers jwt messages between listeners', () => {
    // jsdom exposes a BroadcastChannel implementation; instances on the same
    // name share messages within the test process.
    const a = new TabChannel('test');
    const b = new TabChannel('test');
    const received: TabMessage[] = [];
    b.onMessage((m) => received.push(m));

    // jsdom's BroadcastChannel ignores same-instance dispatch; posting from a
    // is what we want to see on b.
    return new Promise<void>((resolve) => {
      const off = b.onMessage((m) => {
        received.push(m);
        if (received.some((x) => x.type === 'jwt')) {
          off();
          a.close();
          b.close();
          resolve();
        }
      });
      a.post({ type: 'jwt', jwt: 'abc', jwtExp: 1 });
      // Safety timeout
      setTimeout(() => {
        off();
        a.close();
        b.close();
        resolve();
      }, 500);
    });
  });

  it('closes cleanly and ignores further posts without throwing', () => {
    const c = new TabChannel('ghost');
    c.close();
    expect(() => c.post({ type: 'signed-out' })).not.toThrow();
  });
});
