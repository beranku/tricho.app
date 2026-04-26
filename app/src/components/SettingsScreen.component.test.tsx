import { describe, it, expect } from 'vitest';
import { SettingsScreen } from './SettingsScreen';

// SettingsScreen embeds SyncStatus, listens for sync state changes,
// lists/revokes devices via the oauth HTTP helpers, and drives RS
// rotation via the vault keystore. Scaffold until fixtures cover
// tokenStore + vaultDb + sync listeners.

describe('SettingsScreen', () => {
  it('module exports the component', () => {
    expect(typeof SettingsScreen).toBe('function');
  });

  it.todo('displays the current sync status chip');
  it.todo('renders device list pulled from fetchDevices');
  it.todo('revoke device → revokeDevice + refresh');
  it.todo('RS rotation flow: generate + confirm + rewrap');
  it.todo('logout → clears tokens + returns to OAuthScreen');
});
