/**
 * Does this signature verify against this address — and if so, over *what*?
 *
 * The server half of `/app/dev/freighter`, and the reason the probe exists at
 * all. `@stellar/freighter-api` is a relay: it contains no signing code, no
 * ed25519, no SHA-256, and its own unit test mocks the signature as the string
 * `"foo"`. The bytes Freighter signs are decided by the extension, so the only
 * way to learn the envelope is to obtain a real signature and test it.
 *
 * ## It tries several envelopes, not one, and that is the measurement
 *
 * A route that only checked SEP-53 could answer *"no"* and leave the actual
 * scheme unknown — which is exactly the position that tempts somebody to invent
 * one. So every plausible envelope is tried and the route reports **which**
 * verified. A `false` on all of them is also a real result: it means the
 * signature is over something none of these describe, and the next step is to
 * ask Freighter's authors rather than to guess again.
 *
 * The candidates:
 *
 * | name | what is signed |
 * |---|---|
 * | `sep53` | `SHA-256("Stellar Signed Message:\n" ‖ message)`, via the SDK's own `verifyMessage` |
 * | `sep53-manual` | the same bytes, assembled here and checked with raw `verify` |
 * | `raw-utf8` | the message's UTF-8 bytes, signed directly |
 * | `sha256-message` | `SHA-256(message)`, with no prefix |
 *
 * `sep53` and `sep53-manual` must agree. They are both here because agreement
 * is itself a check: it proves the SDK helper does what its doc comment says,
 * so a `true` from it is evidence about Freighter rather than about the SDK.
 *
 * ## Why the answer is computed here rather than in the page
 *
 * A probe whose verdict is produced by the same browser that produced the
 * signature is a browser agreeing with itself. The point of piece 4 is whether
 * a **server** holding only a `G…` can verify what a wallet signed, so the
 * check runs where that claim would live.
 *
 * ## Not available in production
 *
 * `probesEnabled` fails closed. This route is a 404 anywhere it cannot prove it
 * is not production — it takes an address and a signature from an untrusted
 * caller and does cryptography with them, which is fine in development and is
 * not a thing to leave switched on.
 */

import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { probesEnabled } from '@/lib/dev-probe';

export const runtime = 'nodejs';

/** The prefix SEP-53 fixes, and the SDK's `MESSAGE_PREFIX`, written out once. */
const SEP53_PREFIX = Buffer.from('Stellar Signed Message:\n', 'utf8');

/** An ed25519 signature is 64 bytes. Anything else is worth reporting as-is. */
const SIGNATURE_BYTES = 64;

interface Candidate {
  name: string;
  describes: string;
  ok: boolean;
  error: string | null;
}

interface Body {
  message?: unknown;
  signerAddress?: unknown;
  /** The signature, base64. The page normalises whatever Freighter returned. */
  signature?: unknown;
  /** `base64` or `hex`. Tried both when the caller does not say. */
  encoding?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (!probesEnabled()) return new Response('Not Found', { status: 404 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'bad_request', message: 'Body must be JSON.' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message : '';
  const signerAddress = typeof body.signerAddress === 'string' ? body.signerAddress.trim() : '';
  const raw = typeof body.signature === 'string' ? body.signature.trim() : '';

  if (message.length === 0 || signerAddress.length === 0 || raw.length === 0) {
    return Response.json(
      { error: 'bad_request', message: 'message, signerAddress and signature are all required.' },
      { status: 400 },
    );
  }

  // The address first, on its own. A malformed `G…` would otherwise make every
  // candidate fail identically and read as "Freighter signs something strange".
  let pub: Keypair;
  try {
    pub = Keypair.fromPublicKey(signerAddress);
  } catch (error) {
    return Response.json(
      {
        error: 'bad_address',
        message: `${signerAddress} is not a Stellar public key.`,
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  // Both encodings, because v3 of the extension returned a Buffer and v4 a
  // string, and "which string encoding" is precisely the kind of thing this
  // probe should not assume.
  const decodings = decodeCandidates(raw, typeof body.encoding === 'string' ? body.encoding : null);

  const results = decodings.map(({ encoding, signature, error }) => {
    if (signature === null) {
      return { encoding, signatureBytes: 0, candidates: [] as Candidate[], error };
    }
    return {
      encoding,
      signatureBytes: signature.length,
      error: null as string | null,
      candidates: verifyAll(pub, message, signature),
    };
  });

  // The one line a reader needs. Null when nothing verified, which is a
  // finding and is reported as one rather than as a failure of this route.
  const winner = results.flatMap((result) =>
    result.candidates.filter((candidate) => candidate.ok).map((candidate) => ({
      encoding: result.encoding,
      scheme: candidate.name,
      describes: candidate.describes,
    })),
  );

  return Response.json(
    {
      message,
      signerAddress,
      verified: winner.length > 0,
      // Plural on purpose: two envelopes verifying the same signature would be
      // a result worth seeing rather than one worth hiding behind a `find`.
      verifiedBy: winner,
      expectedSignatureBytes: SIGNATURE_BYTES,
      results,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

function decodeCandidates(
  raw: string,
  stated: string | null,
): { encoding: string; signature: Buffer | null; error: string | null }[] {
  const wanted = stated === 'base64' || stated === 'hex' ? [stated] : ['base64', 'hex'];

  return wanted.map((encoding) => {
    try {
      const signature = Buffer.from(raw, encoding as BufferEncoding);
      // Node's base64 decoder never throws; it drops what it cannot read. A
      // zero-length result is the only signal that the input was not this
      // encoding at all, and a length that is not 64 is worth surfacing rather
      // than treating as a decode failure — an extension returning 32 or 96
      // bytes is a finding.
      if (signature.length === 0) {
        return { encoding, signature: null, error: `not decodable as ${encoding}` };
      }
      return { encoding, signature, error: null };
    } catch (error) {
      return {
        encoding,
        signature: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function verifyAll(pub: Keypair, message: string, signature: Buffer): Candidate[] {
  const utf8 = Buffer.from(message, 'utf8');
  const sha256 = (input: Buffer): Buffer => createHash('sha256').update(input).digest();

  const attempts: { name: string; describes: string; run: () => boolean }[] = [
    {
      name: 'sep53',
      describes: 'SHA-256("Stellar Signed Message:\\n" ‖ message), via Keypair.verifyMessage',
      run: () => pub.verifyMessage(message, signature),
    },
    {
      name: 'sep53-manual',
      describes: 'SHA-256("Stellar Signed Message:\\n" ‖ message), assembled here',
      run: () => pub.verify(sha256(Buffer.concat([SEP53_PREFIX, utf8])), signature),
    },
    {
      name: 'raw-utf8',
      describes: 'the message’s UTF-8 bytes, signed directly with no prefix or hash',
      run: () => pub.verify(utf8, signature),
    },
    {
      name: 'sha256-message',
      describes: 'SHA-256(message), with no prefix',
      run: () => pub.verify(sha256(utf8), signature),
    },
  ];

  return attempts.map(({ name, describes, run }) => {
    try {
      return { name, describes, ok: run(), error: null };
    } catch (error) {
      // A throw is not a "no". `verify` can reject a malformed signature
      // outright, and that is different from a signature that is well formed
      // and over different bytes.
      return {
        name,
        describes,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
