// Vitest environment setup shared across all test suites.
// jsdom doesn't bring a structuredClone implementation on older versions and
// some PouchDB plumbing uses it — polyfill defensively.

import 'fake-indexeddb/auto';

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (value: unknown) => JSON.parse(JSON.stringify(value));
}
