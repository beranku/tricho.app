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

  it('shows the error message when status is error', () => {
    mockState({ status: 'error', error: 'connection refused' });
    render(<SyncStatus />);
    expect(screen.getByText(/sync error/i)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });
});
