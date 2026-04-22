// JWT signing + JWKS publishing.
//
// Uses RS256 — CouchDB's jwt_authentication_handler validates with the matching
// public key registered in local.ini. The private key lives only in tricho-auth.
// JWKS is exposed publicly so infra can reconfigure CouchDB keys from a single
// source of truth during key rotation.

import crypto from 'node:crypto';
import { SignJWT, importPKCS8, importSPKI, exportJWK } from 'jose';

const JWT_ALG = 'RS256';
const JWT_ISS = 'tricho-auth';
const JWT_AUD = 'couchdb';

/**
 * Generates an RS256 keypair in PKCS8/SPKI PEM form. Intended for first-run
 * setup; operators persist the private key as a secret and register the public
 * key with CouchDB.
 */
export function generateKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privatePem: privateKey, publicPem: publicKey };
}

export class JwtSigner {
  constructor({ privatePem, publicPem, kid, accessTtlSec }) {
    this.kid = kid;
    this.accessTtlSec = accessTtlSec ?? 60 * 60;
    this._privateKeyPromise = importPKCS8(privatePem, JWT_ALG);
    this._publicKeyPromise = importSPKI(publicPem, JWT_ALG);
    this._publicPem = publicPem;
  }

  async signAccessToken({ sub, email }) {
    const privateKey = await this._privateKeyPromise;
    const issuedAt = Math.floor(Date.now() / 1000);
    const exp = issuedAt + this.accessTtlSec;
    const jwt = await new SignJWT({ email: email ?? null })
      .setProtectedHeader({ alg: JWT_ALG, kid: this.kid })
      .setIssuer(JWT_ISS)
      .setAudience(JWT_AUD)
      .setSubject(sub)
      .setIssuedAt(issuedAt)
      .setExpirationTime(exp)
      .sign(privateKey);
    return { jwt, exp };
  }

  async jwks() {
    const publicKey = await this._publicKeyPromise;
    const jwk = await exportJWK(publicKey);
    jwk.kid = this.kid;
    jwk.alg = JWT_ALG;
    jwk.use = 'sig';
    return { keys: [jwk] };
  }

  /**
   * Returns the PEM public key suitable for copy-paste into CouchDB's
   * [jwt_keys] section.
   */
  publicPem() {
    return this._publicPem;
  }
}

/**
 * Opaque, URL-safe refresh token. Not a JWT — just a bearer string whose hash
 * is stored in tricho_meta for revocation.
 */
export function mintRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Issues both access and refresh in one go. */
export async function issueTokens(signer, { sub, email }) {
  const { jwt, exp } = await signer.signAccessToken({ sub, email });
  const refreshToken = mintRefreshToken();
  return { jwt, jwtExp: exp, refreshToken };
}
