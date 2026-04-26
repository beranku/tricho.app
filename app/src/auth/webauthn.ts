/**
 * Minimal WebAuthn + PRF helper
 *
 * Registers a passkey and retrieves the PRF-extension output for KEK derivation.
 * All challenges are generated locally — this module is designed for Layer A
 * (offline unlock), which does not require server-side challenge verification.
 *
 * Limitations (accepted tradeoffs for a local, zero-knowledge PWA):
 * - PRF availability depends on browser + authenticator (iCloud Keychain on Safari,
 *   platform authenticator on Chrome/Edge, most hardware keys). Caller must be
 *   prepared to fall back to Recovery Secret if `getPrfOutput` throws.
 */

import { encodeBase64url, decodeBase64url } from '../crypto/envelope';

const RP_ID = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
const RP_NAME = 'TrichoApp';
const USER_DISPLAY_NAME = 'TrichoApp vault';
const PRF_EVAL_INFO = 'tricho-prf-eval-v1';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * Deterministic PRF eval input for a given vault. Using the vault id keeps the
 * PRF output stable across devices that share the same passkey/PRF keychain.
 */
function prfEvalForVault(vaultId: string): Uint8Array {
  const bytes = new TextEncoder().encode(`${PRF_EVAL_INFO}:${vaultId}`);
  return bytes;
}

export interface RegisterPasskeyResult {
  credentialId: string;
  prfSupported: boolean;
  prfOutput: Uint8Array | null;
}

/**
 * Creates a new passkey with the PRF extension requested. Returns the base64url
 * credential ID and, when the authenticator actually produced a PRF result on
 * creation, the 32-byte PRF output (some browsers only return PRF on assertion).
 */
export async function registerPasskey(vaultId: string, userId: string): Promise<RegisterPasskeyResult> {
  const challenge = randomBytes(32);
  const prfEval = prfEvalForVault(vaultId);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { id: RP_ID, name: RP_NAME },
      user: {
        id: new TextEncoder().encode(userId) as BufferSource,
        name: userId,
        displayName: USER_DISPLAY_NAME,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      extensions: {
        prf: { eval: { first: prfEval as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey creation returned no credential.');

  const exts = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  const prfOutputBuffer = exts.prf?.results?.first;
  const prfOutput = prfOutputBuffer ? new Uint8Array(prfOutputBuffer) : null;

  return {
    credentialId: encodeBase64url(new Uint8Array(credential.rawId)),
    prfSupported: Boolean(exts.prf?.enabled),
    prfOutput,
  };
}

/**
 * Performs an assertion against the stored credential and returns the 32-byte
 * PRF output. Throws if the authenticator doesn't yield a PRF result.
 */
export async function getPrfOutput(credentialId: string, vaultId: string): Promise<Uint8Array> {
  const challenge = randomBytes(32);
  const prfEval = prfEvalForVault(vaultId);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as BufferSource,
      rpId: RP_ID,
      allowCredentials: [
        {
          type: 'public-key',
          id: decodeBase64url(credentialId) as BufferSource,
          transports: ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
        },
      ],
      userVerification: 'preferred',
      extensions: {
        prf: { eval: { first: prfEval as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Passkey assertion returned no credential.');

  const exts = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const buf = exts.prf?.results?.first;
  if (!buf) {
    throw new Error(
      'Authenticator did not return a PRF result. Use Recovery Secret to unlock, or try a PRF-capable authenticator.',
    );
  }
  return new Uint8Array(buf);
}

export function isWebAuthnAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}
