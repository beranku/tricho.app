import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrfOutput, isWebAuthnAvailable, registerPasskey } from './webauthn';
import { encodeBase64url } from '../crypto/envelope';

function makeFakeCredential(opts: {
  rawId: Uint8Array;
  prfEnabled?: boolean;
  prfOutput?: Uint8Array | null;
}): PublicKeyCredential {
  return {
    rawId: opts.rawId.buffer.slice(
      opts.rawId.byteOffset,
      opts.rawId.byteOffset + opts.rawId.byteLength,
    ),
    getClientExtensionResults: () => ({
      prf: {
        enabled: opts.prfEnabled ?? false,
        results: opts.prfOutput ? { first: opts.prfOutput.buffer } : undefined,
      },
    }),
  } as unknown as PublicKeyCredential;
}

beforeEach(() => {
  // Navigator.credentials isn't a natural part of jsdom — stub fresh every time.
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create: vi.fn(), get: vi.fn() },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isWebAuthnAvailable', () => {
  it('true when window.PublicKeyCredential is defined', () => {
    (globalThis as Record<string, unknown>).PublicKeyCredential = function () {};
    // jsdom window === globalThis in vitest
    (window as unknown as Record<string, unknown>).PublicKeyCredential = (
      globalThis as Record<string, unknown>
    ).PublicKeyCredential;
    expect(isWebAuthnAvailable()).toBe(true);
  });

  it('false when PublicKeyCredential is absent', () => {
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    expect(isWebAuthnAvailable()).toBe(false);
  });
});

describe('registerPasskey', () => {
  it('passes challenge + PRF eval to credentials.create and decodes result', async () => {
    const rawId = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const prfOutput = new Uint8Array(32).fill(7);
    (navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeFakeCredential({ rawId, prfEnabled: true, prfOutput }),
    );

    const result = await registerPasskey('vault-abc', 'user-xyz');

    expect(result.credentialId).toBe(encodeBase64url(rawId));
    expect(result.prfSupported).toBe(true);
    expect(result.prfOutput).toEqual(prfOutput);

    const [args] = (navigator.credentials.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args.publicKey.rp.name).toBe('TrichoApp');
    // Cross-realm Uint8Array — check by shape rather than instanceof.
    expect(args.publicKey.extensions.prf.eval.first.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(args.publicKey.extensions.prf.eval.first)).toContain(
      'tricho-prf-eval-v1:vault-abc',
    );
    expect(new TextDecoder().decode(args.publicKey.user.id)).toBe('user-xyz');
  });

  it('returns prfOutput=null when the authenticator did not surface one', async () => {
    (navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeFakeCredential({ rawId: new Uint8Array([9]), prfEnabled: true, prfOutput: null }),
    );
    const result = await registerPasskey('v', 'u');
    expect(result.prfOutput).toBeNull();
    expect(result.prfSupported).toBe(true);
  });

  it('throws when the credential API returns null (cancel / NotAllowed)', async () => {
    (navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(registerPasskey('v', 'u')).rejects.toThrow(/no credential/i);
  });

  it('propagates DOM exceptions from the authenticator', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    (navigator.credentials.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(registerPasskey('v', 'u')).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('deterministic PRF eval input per vaultId', async () => {
    type CreateOptsWithPrf = {
      publicKey: { extensions: { prf: { eval: { first: Uint8Array } } } };
    };
    const capture = vi.fn(async (..._args: unknown[]) =>
      makeFakeCredential({ rawId: new Uint8Array([1]), prfEnabled: true, prfOutput: new Uint8Array(32) }),
    );
    (navigator.credentials.create as ReturnType<typeof vi.fn>).mockImplementation(capture);
    const prfFirst = (call: number): Uint8Array =>
      (capture.mock.calls[call]?.[0] as CreateOptsWithPrf).publicKey.extensions.prf.eval.first;
    await registerPasskey('vault-A', 'u');
    await registerPasskey('vault-A', 'u');
    const first = prfFirst(0);
    const second = prfFirst(1);
    expect(first).toEqual(second);
    await registerPasskey('vault-B', 'u');
    const third = prfFirst(2);
    expect(third).not.toEqual(first);
  });
});

describe('getPrfOutput', () => {
  it('returns PRF bytes from the assertion', async () => {
    const prf = new Uint8Array(32).fill(42);
    (navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeFakeCredential({ rawId: new Uint8Array([1]), prfEnabled: true, prfOutput: prf }),
    );

    await expect(getPrfOutput('AQID', 'vault-a')).resolves.toEqual(prf);
  });

  it('throws a descriptive error when the authenticator yields no PRF', async () => {
    (navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeFakeCredential({ rawId: new Uint8Array([1]), prfEnabled: false, prfOutput: null }),
    );
    await expect(getPrfOutput('AQID', 'v')).rejects.toThrow(/PRF/);
  });

  it('throws when assertion returns null', async () => {
    (navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getPrfOutput('AQID', 'v')).rejects.toThrow(/no credential/i);
  });
});
