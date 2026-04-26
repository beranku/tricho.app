import { describe, it, expect } from 'vitest';
import { userDbUrlFor, getCouchdbUrl } from './couch-auth';

describe('couch-auth helpers', () => {
  it('userDbUrlFor hex-encodes the username into the userdb- prefix', () => {
    const url = userDbUrlFor('v_abc');
    expect(url).toBe(`${getCouchdbUrl()}/userdb-765f616263`);
  });
});
