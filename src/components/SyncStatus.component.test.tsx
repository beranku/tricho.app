import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatus } from './SyncStatus';
import { expectA11yBasics } from '../test/component-setup';
import { setLocale } from '../i18n';
import * as couch from '../sync/couch';

vi.mock('../sync/couch', async () => {
  const actual = await vi.importActual<typeof couch>('../sync/couch');
  return {
    ...actual,
    getSyncState: vi.fn(() => ({
      status: 'idle' as const,
      error: null,
      lastEventAt: null,
      pushed: 0,
      pulled: 0,
      username: null,
    })),
    subscribeSyncEvents: vi.fn(() => () => void 0),
  };
});

type SyncState = ReturnType<typeof couch.getSyncState>;

function mockState(s: Partial<SyncState>): void {
  const getState = couch.getSyncState as unknown as ReturnType<typeof vi.fn>;
  const base: SyncState = {
    status: 'idle',
    error: null,
    errorClass: null,
    lastEventAt: null,
    pushed: 0,
    pulled: 0,
    username: null,
  };
  getState.mockReturnValue({ ...base, ...s });
}

beforeEach(() => {
  // SyncStatus assertions check English UI strings (e.g. "up to date").
  setLocale('en');
  mockState({ status: 'idle' });
});

describe('SyncStatus', () => {
  it('renders the idle label by default', () => {
    render(<SyncStatus />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    expectA11yBasics();
  });

  it('renders the syncing status when the store says so', () => {
    mockState({ status: 'syncing' });
    render(<SyncStatus />);
    expect(screen.getByText(/syncing/i)).toBeInTheDocument();
  });

  it('renders paused (Up to date) variant', () => {
    mockState({ status: 'paused' });
    render(<SyncStatus />);
    expect(screen.getByText(/up to date/i)).toBeInTheDocument();
  });

  it('shows the humanised reason for network errors', () => {
    mockState({ status: 'error', error: 'connection refused', errorClass: 'network' });
    render(<SyncStatus />);
    expect(screen.getByText(/sync error/i)).toBeInTheDocument();
    expect(screen.getByText(/no connection/i)).toBeInTheDocument();
  });

  it('shows the humanised reason for auth errors', () => {
    mockState({ status: 'error', error: '401 unauthorized', errorClass: 'auth' });
    render(<SyncStatus />);
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
  });

  it('shows the humanised reason for vault-mismatch errors', () => {
    mockState({ status: 'error', error: '412 precondition failed', errorClass: 'vault-mismatch' });
    render(<SyncStatus />);
    expect(screen.getByText(/vault out of sync/i)).toBeInTheDocument();
  });

  it('shows a fallback for unknown errors', () => {
    mockState({ status: 'error', error: 'something weird', errorClass: 'unknown' });
    render(<SyncStatus />);
    expect(screen.getByText(/something didn't fit/i)).toBeInTheDocument();
  });

  it('does NOT show the raw error string in the rendered UI (avoids exposing stack traces)', () => {
    mockState({ status: 'error', error: 'AbortError: signal aborted', errorClass: 'network' });
    render(<SyncStatus />);
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument();
    expect(screen.queryByText(/signal aborted/)).not.toBeInTheDocument();
  });

  it('renders a "Retry" button when db + username are provided AND status is error', () => {
    mockState({ status: 'error', error: 'oops', errorClass: 'network' });
    const fakeDb = {} as never;
    render(<SyncStatus db={fakeDb} username="user-x" />);
    expect(screen.getByTestId('sync-status-retry')).toBeInTheDocument();
  });

  it('does NOT render a Retry button without db + username', () => {
    mockState({ status: 'error', error: 'oops', errorClass: 'network' });
    render(<SyncStatus />);
    expect(screen.queryByTestId('sync-status-retry')).not.toBeInTheDocument();
  });

  it('does NOT render a Retry button when status is healthy', () => {
    mockState({ status: 'paused' });
    const fakeDb = {} as never;
    render(<SyncStatus db={fakeDb} username="user-x" />);
    expect(screen.queryByTestId('sync-status-retry')).not.toBeInTheDocument();
  });
});
