/**
 * The probe's server half, checked against signatures whose envelope is known.
 *
 * `/api/dev/freighter-verify` exists to answer a question about a third party,
 * and a probe that cannot tell two envelopes apart would answer it wrongly with
 * complete confidence. So this feeds it signatures made four different ways —
 * each one produced here, so the correct answer is known in advance — and
 * requires it to name the right envelope every time.
 *
 * The case that matters most is the last: a signature over bytes none of the
 * candidates describe must come back `verified: false` with every candidate
 * listed. That is the shape of a real finding about Freighter, and it has to be
 * distinguishable from the route being broken.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { POST } from '@/app/api/dev/freighter-verify/route';

const MESSAGE = 'limen-test-123';
const sha256 = (input: Buffer): Buffer => createHash('sha256').update(input).digest();

function post(body: unknown): Request {
  return new Request('http://localhost/api/dev/freighter-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface Verdict {
  verified: boolean;
  verifiedBy: { encoding: string; scheme: string }[];
  results: { encoding: string; signatureBytes: number; candidates: { name: string; ok: boolean }[] }[];
  error?: string;
}

async function verdictFor(signature: Buffer, signerAddress: string, encoding: 'base64' | 'hex' = 'base64') {
  const response = await POST(
    post({ message: MESSAGE, signerAddress, signature: signature.toString(encoding) }),
  );
  return { status: response.status, body: (await response.json()) as Verdict };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('it names the envelope a signature was actually made over', () => {
  it('recognises SEP-53, and by both the helper and the hand-assembled check', async () => {
    const kp = Keypair.random();
    const { body } = await verdictFor(kp.signMessage(MESSAGE), kp.publicKey());

    expect(body.verified).toBe(true);
    const schemes = body.verifiedBy.map((entry) => entry.scheme).sort();
    // Both, not one. They check the same bytes by different routes, and their
    // agreement is what makes a `true` evidence about the signature rather
    // than about the SDK helper.
    expect(schemes).toEqual(['sep53', 'sep53-manual']);
  });

  it('recognises a signature over the raw UTF-8 message, with no prefix', async () => {
    const kp = Keypair.random();
    const { body } = await verdictFor(kp.sign(Buffer.from(MESSAGE, 'utf8')), kp.publicKey());

    expect(body.verified).toBe(true);
    expect(body.verifiedBy.map((entry) => entry.scheme)).toEqual(['raw-utf8']);
  });

  it('recognises a signature over SHA-256(message) with no prefix', async () => {
    const kp = Keypair.random();
    const { body } = await verdictFor(kp.sign(sha256(Buffer.from(MESSAGE, 'utf8'))), kp.publicKey());

    expect(body.verified).toBe(true);
    expect(body.verifiedBy.map((entry) => entry.scheme)).toEqual(['sha256-message']);
  });

  it('reports every candidate as failing when the envelope is none of them', async () => {
    // A prefix nobody uses. This is what a genuine surprise from Freighter
    // would look like, and it must not be reported as an error — the route
    // worked perfectly and the answer is "not one of these".
    const kp = Keypair.random();
    const odd = sha256(Buffer.concat([Buffer.from('Some Other Prefix:\n', 'utf8'), Buffer.from(MESSAGE, 'utf8')]));
    const { status, body } = await verdictFor(kp.sign(odd), kp.publicKey());

    expect(status).toBe(200);
    expect(body.verified).toBe(false);
    expect(body.verifiedBy).toEqual([]);
    const base64 = body.results.find((result) => result.encoding === 'base64');
    expect(base64?.candidates.map((candidate) => candidate.name).sort()).toEqual([
      'raw-utf8',
      'sep53',
      'sep53-manual',
      'sha256-message',
    ]);
    expect(base64?.candidates.every((candidate) => !candidate.ok)).toBe(true);
  });

  it('refuses a signature made by a different key, whatever the envelope', async () => {
    const signer = Keypair.random();
    const stranger = Keypair.random();
    const { body } = await verdictFor(signer.signMessage(MESSAGE), stranger.publicKey());
    expect(body.verified).toBe(false);
  });
});

describe('it reads whichever encoding the extension used', () => {
  it('verifies the same signature presented as hex', async () => {
    const kp = Keypair.random();
    const { body } = await verdictFor(kp.signMessage(MESSAGE), kp.publicKey(), 'hex');

    expect(body.verified).toBe(true);
    // v3 returned a Buffer and v4 a base64 string; which encoding a hex-looking
    // value really is cannot be assumed, so both are tried and the winner says
    // which one worked.
    expect(body.verifiedBy.map((entry) => entry.encoding)).toContain('hex');
  });

  it('reports the signature length rather than insisting on 64 bytes', async () => {
    // An extension returning the wrong number of bytes is a finding worth
    // seeing. The route must surface the length, not reject the input.
    const kp = Keypair.random();
    const { body } = await verdictFor(Buffer.alloc(32, 1), kp.publicKey());
    expect(body.verified).toBe(false);
    expect(body.results.find((result) => result.encoding === 'base64')?.signatureBytes).toBe(32);
  });
});

describe('it fails closed and says why', () => {
  it('is a 404 in production, because a probe is a development affordance', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const kp = Keypair.random();
    const response = await POST(
      post({
        message: MESSAGE,
        signerAddress: kp.publicKey(),
        signature: kp.signMessage(MESSAGE).toString('base64'),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('refuses a malformed address as a bad address, not as a failed verification', async () => {
    // The distinction is the point: "this is not a Stellar key" and "this key
    // did not sign this" send a reader to different places.
    const response = await POST(
      post({ message: MESSAGE, signerAddress: 'not-a-key', signature: 'AAAA' }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as Verdict).error).toBe('bad_address');
  });

  it('requires all three fields', async () => {
    const response = await POST(post({ message: MESSAGE }));
    expect(response.status).toBe(400);
  });
});
