import { describe, it, expect } from 'vitest';
import { CustomerCRM } from './CustomerCRM';

// CustomerCRM is backed by a real VaultDb (encrypted PouchDB). Proper
// testing will use the in-memory pouch fixture from src/test/fixtures/
// plus seedCustomer() to populate a few rows. Shipped as scaffold until
// the full wiring + seed helpers land (the fixture primitives already
// exist, this just needs the describe cases).

describe('CustomerCRM', () => {
  it('module exports the component', () => {
    expect(typeof CustomerCRM).toBe('function');
  });

  it.todo('lists customers pulled from the vault');
  it.todo('submit form creates a customer + clears the inputs');
  it.todo('duplicate phone number is rejected with a visible error');
  it.todo('delete with confirmDelete=true prompts before removing');
  it.todo('watchChanges triggers refresh on external writes');
});
