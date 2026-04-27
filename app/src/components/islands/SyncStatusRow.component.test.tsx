import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SyncStatusRow } from './SyncStatusRow';
import type { SyncListener } from '../../sync/couch';

let listener: SyncListener | null = null;
vi.mock('../../sync/couch', () => ({
  subscribeSyncEvents: vi.fn((cb: SyncListener) => {
    listener = cb;
    cb({ status: 'idle', error: null, errorClass: null, lastEventAt: null, pushed: 0, pulled: 0, username: null });
    return () => { listener = null; };
  }),
}));

describe('SyncStatusRow', () => {
  beforeEach(() => {
    listener = null;
  });

  it('renders the idle Czech label by default', () => {
    render(<SyncStatusRow />);
    expect(screen.getByText('Připraveno')).toBeInTheDocument();
  });

  it('updates label when state transitions to syncing', () => {
    render(<SyncStatusRow />);
    expect(screen.getByText('Připraveno')).toBeInTheDocument();
    act(() =>
      listener?.({
        status: 'syncing',
        error: null,
        errorClass: null,
        lastEventAt: 1,
        pushed: 0,
        pulled: 0,
        username: 'u',
      }),
    );
    expect(screen.getByText('Synchronizuji…')).toBeInTheDocument();
  });

  it('shows the error label when status is error', () => {
    render(<SyncStatusRow />);
    act(() =>
      listener?.({
        status: 'error',
        error: 'boom',
        errorClass: 'unknown',
        lastEventAt: 1,
        pushed: 0,
        pulled: 0,
        username: 'u',
      }),
    );
    expect(screen.getByText('Chyba synchronizace')).toBeInTheDocument();
  });
});
