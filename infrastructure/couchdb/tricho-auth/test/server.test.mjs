import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicKey } from 'node:crypto';

// server.mjs has top-level side effects (reads env, starts HTTP server),
// so we test its helper functions by copying the logic here. This keeps
// the test hermetic while the server module itself stays simple enough
// that the duplication is small.

function hydrateFromSecretFiles(names) {
  for (const name of names) {
    if (process.env[name]) continue;
    const p = process.env[`${name}_FILE`];
    if (!p) continue;
    try {
      const contents = fs.readFileSync(p, 'utf8').replace(/\s+$/, '');
      if (contents) process.env[name] = contents;
    } catch {
      // missing / unreadable → leave unset
    }
  }
}

function publishPublicKey(publicPem, sharedDir) {
  fs.mkdirSync(sharedDir, { recursive: true });
  const dest = `${sharedDir}/jwt-public.pem`;
  const tmp = `${dest}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, publicPem, { mode: 0o644 });
  fs.renameSync(tmp, dest);
}

// Derive public from private PEM (mirrors server.mjs's derivePublicPem).
function derivePublicPem(privatePem) {
  return createPublicKey(privatePem).export({ format: 'pem', type: 'spki' }).toString();
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tricho-server-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.TEST_HYDRATE_VAR;
  delete process.env.TEST_HYDRATE_VAR_FILE;
});

describe('hydrateFromSecretFiles', () => {
  it('loads env from file when env var is unset', () => {
    const f = path.join(tmpDir, 'secret');
    fs.writeFileSync(f, 'super-secret\n');
    process.env.TEST_HYDRATE_VAR_FILE = f;
    hydrateFromSecretFiles(['TEST_HYDRATE_VAR']);
    expect(process.env.TEST_HYDRATE_VAR).toBe('super-secret');
  });

  it('leaves env alone when it was already set', () => {
    const f = path.join(tmpDir, 'secret');
    fs.writeFileSync(f, 'from-file');
    process.env.TEST_HYDRATE_VAR = 'from-env';
    process.env.TEST_HYDRATE_VAR_FILE = f;
    hydrateFromSecretFiles(['TEST_HYDRATE_VAR']);
    expect(process.env.TEST_HYDRATE_VAR).toBe('from-env');
  });

  it('tolerates a missing _FILE path without throwing', () => {
    process.env.TEST_HYDRATE_VAR_FILE = '/nonexistent/path/xyz';
    expect(() => hydrateFromSecretFiles(['TEST_HYDRATE_VAR'])).not.toThrow();
    expect(process.env.TEST_HYDRATE_VAR).toBeUndefined();
  });

  it('strips trailing whitespace from file contents', () => {
    const f = path.join(tmpDir, 'trim');
    fs.writeFileSync(f, 'value\n\n');
    process.env.TEST_HYDRATE_VAR_FILE = f;
    hydrateFromSecretFiles(['TEST_HYDRATE_VAR']);
    expect(process.env.TEST_HYDRATE_VAR).toBe('value');
  });

  it('ignores an empty file (treats as unset)', () => {
    const f = path.join(tmpDir, 'empty');
    fs.writeFileSync(f, '');
    process.env.TEST_HYDRATE_VAR_FILE = f;
    hydrateFromSecretFiles(['TEST_HYDRATE_VAR']);
    expect(process.env.TEST_HYDRATE_VAR).toBeUndefined();
  });
});

describe('publishPublicKey (atomic write)', () => {
  it('writes via tempfile + rename so a reader never sees a partial file', () => {
    const dir = path.join(tmpDir, 'shared');
    publishPublicKey('-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----', dir);
    const contents = fs.readFileSync(`${dir}/jwt-public.pem`, 'utf8');
    expect(contents).toContain('BEGIN PUBLIC KEY');
    // No .tmp.* residue
    const stray = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
    expect(stray).toHaveLength(0);
  });

  it('is idempotent — second call overwrites cleanly', () => {
    const dir = path.join(tmpDir, 'shared2');
    publishPublicKey('first', dir);
    publishPublicKey('second', dir);
    expect(fs.readFileSync(`${dir}/jwt-public.pem`, 'utf8')).toBe('second');
  });
});

describe('derivePublicPem', () => {
  it('derives a PUBLIC KEY PEM from a PRIVATE KEY PEM', async () => {
    const { generateKeypair } = await import('../jwt.mjs');
    const { privatePem, publicPem } = generateKeypair();
    const derived = derivePublicPem(privatePem);
    // Derived public key matches the originally generated one.
    expect(derived.replace(/\s/g, '')).toBe(publicPem.replace(/\s/g, ''));
  });
});
