import { describe, it, expect } from 'vitest';
import { jwtVerify, importJWK } from 'jose';
import { JwtSigner, generateKeypair, issueTokens, mintRefreshToken } from '../jwt.mjs';

describe('generateKeypair', () => {
  it('returns a well-formed PKCS8 + SPKI PEM pair', () => {
    const { privatePem, publicPem } = generateKeypair();
    expect(privatePem).toMatch(/-----BEGIN PRIVATE KEY-----/);
    expect(privatePem).toMatch(/-----END PRIVATE KEY-----/);
    expect(publicPem).toMatch(/-----BEGIN PUBLIC KEY-----/);
    expect(publicPem).toMatch(/-----END PUBLIC KEY-----/);
  });

  it('each call yields independent keys', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(a.privatePem).not.toBe(b.privatePem);
    expect(a.publicPem).not.toBe(b.publicPem);
  });
});

describe('JwtSigner', () => {
  function makeSigner(kid = 'test-kid') {
    const { privatePem, publicPem } = generateKeypair();
    return { signer: new JwtSigner({ privatePem, publicPem, kid }), privatePem, publicPem };
  }

  it('signs + is verifiable with the matching public key', async () => {
    const { signer } = makeSigner();
    const { jwt, exp } = await signer.signAccessToken({ sub: 'user-1', email: 'a@b' });

    const jwks = await signer.jwks();
    const publicKey = await importJWK(jwks.keys[0], 'RS256');
    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey, {
      issuer: 'tricho-auth',
      audience: 'couchdb',
    });

    expect(protectedHeader.alg).toBe('RS256');
    expect(protectedHeader.kid).toBe('test-kid');
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('a@b');
    expect(payload.exp).toBe(exp);
  });

  it('JWKS shape matches RFC 7517 with kid + alg + use', async () => {
    const { signer } = makeSigner('tricho-2026');
    const jwks = await signer.jwks();
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0];
    expect(key.kty).toBe('RSA');
    expect(key.alg).toBe('RS256');
    expect(key.use).toBe('sig');
    expect(key.kid).toBe('tricho-2026');
    expect(typeof key.n).toBe('string');
    expect(typeof key.e).toBe('string');
  });

  it('kid in the JWT protectedHeader matches the signer kid', async () => {
    const { signer } = makeSigner('signer-kid-A');
    const { jwt } = await signer.signAccessToken({ sub: 'u' });
    const decoded = JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8'));
    expect(decoded.kid).toBe('signer-kid-A');
  });

  it('verification with a DIFFERENT key rejects the token', async () => {
    const a = makeSigner();
    const b = makeSigner();
    const { jwt } = await a.signer.signAccessToken({ sub: 'u' });
    const jwksB = await b.signer.jwks();
    const pubB = await importJWK(jwksB.keys[0], 'RS256');
    await expect(
      jwtVerify(jwt, pubB, { issuer: 'tricho-auth', audience: 'couchdb' }),
    ).rejects.toThrow();
  });
});

describe('mintRefreshToken', () => {
  it('returns a 43-char base64url string (256 bits of entropy)', () => {
    const t = mintRefreshToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it('never collides across calls', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(mintRefreshToken());
    expect(seen.size).toBe(100);
  });
});

describe('issueTokens', () => {
  it('emits both a JWT and a refresh token with the matching exp', async () => {
    const { privatePem, publicPem } = generateKeypair();
    const signer = new JwtSigner({ privatePem, publicPem, kid: 'k' });
    const { jwt, jwtExp, refreshToken } = await issueTokens(signer, { sub: 's', email: 'e' });
    expect(jwt).toMatch(/^ey/);
    expect(typeof jwtExp).toBe('number');
    expect(jwtExp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(refreshToken.length).toBeGreaterThan(20);
  });
});
