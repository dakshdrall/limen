'use client';

import { useState } from 'react';
import { NETWORK_PASSPHRASE } from '@/lib/network';

/**
 * What Freighter actually returns from `signMessage`, and whether a server can
 * verify it.
 *
 * A probe, not a feature. It exists to settle one question that no amount of
 * reading can: `@stellar/freighter-api` holds no signing code — no ed25519, no
 * SHA-256, no `Keypair`, and its own unit test mocks the signature as the
 * string `"foo"` — so the envelope is the extension's, and the extension is not
 * in this repository. The only way to learn it is to get one real signature and
 * test it.
 *
 * ## It calls the API directly rather than going through `lib/freighter.ts`
 *
 * Deliberate. `lib/freighter.ts` is the production wrapper and it normalises
 * things — it throws on `result.error`, it returns just the address from
 * `connect`. A probe that went through it would be reporting what our wrapper
 * makes of the answer, and the whole point is to see the answer. So this
 * imports the extension client itself and renders what comes back without
 * interpretation, including the shapes we do not expect.
 *
 * ## The verdict is computed on the server, and that is not a formality
 *
 * The question piece 4 turns on is whether a **server** holding only a `G…` can
 * verify what a wallet signed. A check run in this page would be the browser
 * that produced the signature agreeing with itself, which is worth nothing. So
 * the signature goes to `/api/dev/freighter-verify`, which tries four envelopes
 * with `@stellar/stellar-sdk` and reports which — if any — verified.
 *
 * ## `signedMessage` has had two shapes and this reports whichever it gets
 *
 * v3 of the extension returned a `Buffer`, v4 a base64 `string`, and a value
 * crossing `postMessage` can arrive as a `Uint8Array` or as Node's serialised
 * `{ type: 'Buffer', data: number[] }`. All four are handled and the raw type
 * is displayed, because *which* one arrived is part of the answer.
 */

/** Fixed, so two runs on two machines are comparable. */
const MESSAGE = 'limen-test-123';

interface Described {
  kind: string;
  base64: string | null;
  byteLength: number | null;
  preview: string;
}

/**
 * Whatever `signedMessage` is, said plainly and turned into base64 for
 * transport — without ever guessing that an unrecognised shape is a signature.
 */
function describeSigned(value: unknown): Described {
  if (value === null || value === undefined) {
    return { kind: String(value), base64: null, byteLength: null, preview: String(value) };
  }

  if (typeof value === 'string') {
    // v4. Reported as a string, and the server tries both base64 and hex rather
    // than this page deciding which it is.
    return {
      kind: `string (length ${value.length})`,
      base64: value,
      byteLength: null,
      preview: value,
    };
  }

  if (value instanceof Uint8Array) {
    const base64 = btoa(String.fromCharCode(...value));
    return {
      kind: `${value.constructor.name} (${value.length} bytes)`,
      base64,
      byteLength: value.length,
      preview: base64,
    };
  }

  // Node's `Buffer` after a structured-clone or a JSON round trip.
  if (
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    const bytes = Uint8Array.from((value as { data: number[] }).data);
    const base64 = btoa(String.fromCharCode(...bytes));
    return {
      kind: `serialised Buffer (${bytes.length} bytes)`,
      base64,
      byteLength: bytes.length,
      preview: base64,
    };
  }

  // Unrecognised. Shown in full and NOT forwarded as a signature — sending a
  // guess would produce a verification result about something invented here.
  return {
    kind: `unrecognised (${typeof value})`,
    base64: null,
    byteLength: null,
    preview: JSON.stringify(value, null, 2),
  };
}

interface Step {
  label: string;
  value: string;
}

type Verdict =
  | { kind: 'idle' }
  | { kind: 'running'; at: string }
  | { kind: 'failed'; at: string; detail: string }
  | { kind: 'done'; steps: Step[]; signed: Described; verification: unknown };

export function FreighterProbe() {
  const [verdict, setVerdict] = useState<Verdict>({ kind: 'idle' });

  async function run() {
    const steps: Step[] = [];
    const at = (label: string) => label;

    try {
      setVerdict({ kind: 'running', at: at('importing @stellar/freighter-api') });
      const freighter = await import('@stellar/freighter-api');

      setVerdict({ kind: 'running', at: at('isConnected()') });
      const connected = await freighter.isConnected();
      steps.push({ label: 'isConnected()', value: JSON.stringify(connected) });
      if (connected.error !== undefined || !connected.isConnected) {
        setVerdict({
          kind: 'failed',
          at: 'isConnected()',
          detail:
            'Freighter did not answer. Is the extension installed and enabled for this origin? ' +
            JSON.stringify(connected),
        });
        return;
      }

      setVerdict({ kind: 'running', at: at('requestAccess()') });
      const access = await freighter.requestAccess();
      steps.push({ label: 'requestAccess()', value: JSON.stringify(access) });
      if (access.error !== undefined || access.address === '') {
        setVerdict({
          kind: 'failed',
          at: 'requestAccess()',
          detail: `Access was not granted: ${JSON.stringify(access)}`,
        });
        return;
      }

      // Reported, not enforced. A probe that refused on the wrong network would
      // hide the very thing somebody might be trying to find out.
      setVerdict({ kind: 'running', at: at('getNetwork()') });
      const network = await freighter.getNetwork();
      steps.push({ label: 'getNetwork()', value: JSON.stringify(network) });

      setVerdict({ kind: 'running', at: at(`signMessage(${JSON.stringify(MESSAGE)})`) });
      const result = await freighter.signMessage(MESSAGE, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: access.address,
      });

      const asRecord = result as unknown as Record<string, unknown>;
      steps.push({ label: 'signMessage() keys', value: Object.keys(asRecord).join(', ') });
      steps.push({ label: 'signerAddress', value: String(asRecord.signerAddress ?? '(absent)') });

      if (asRecord.error !== undefined) {
        setVerdict({
          kind: 'failed',
          at: 'signMessage()',
          detail: `Freighter returned an error: ${JSON.stringify(asRecord.error)}`,
        });
        return;
      }

      const signed = describeSigned(asRecord.signedMessage);
      const signerAddress = String(asRecord.signerAddress ?? '');

      if (signed.base64 === null || signerAddress === '') {
        setVerdict({
          kind: 'done',
          steps,
          signed,
          verification: {
            skipped:
              'Nothing was sent to the server: the signature was not in a shape this page could ' +
              'forward without guessing at it. The raw value is above, and that is the finding.',
          },
        });
        return;
      }

      setVerdict({ kind: 'running', at: 'verifying on the server' });
      const response = await fetch('/api/dev/freighter-verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: MESSAGE,
          signerAddress,
          signature: signed.base64,
        }),
      });
      const verification: unknown = await response.json();

      setVerdict({ kind: 'done', steps, signed, verification });
    } catch (error) {
      setVerdict({
        kind: 'failed',
        at: 'the probe itself',
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel" data-tone="pending">
        <span className="eyebrow text-muted">dev probe — not part of the product</span>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          This page asks Freighter to sign the fixed message{' '}
          <span className="value">{MESSAGE}</span>{' '}
          and reports exactly what came back. It is here to answer one question — whether a server
          holding only a{' '}
          <span className="value">G…</span>{' '}
          address can verify a Freighter signature — and it will be deleted once that question has
          an answer.
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          Nothing is stored, nothing is submitted to a network, and no transaction is built. The
          signature is sent to this deployment&rsquo;s own server so the verdict is computed
          somewhere other than the browser that produced it.
        </p>
      </div>

      <div>
        <button
          type="button"
          className="button"
          onClick={() => void run()}
          disabled={verdict.kind === 'running'}
        >
          {verdict.kind === 'running' ? 'Running…' : 'Connect Freighter and sign the message'}
        </button>
      </div>

      {verdict.kind === 'running' && (
        <div role="status" className="panel">
          <span className="eyebrow text-muted">waiting</span>
          <p className="text-[13px] leading-relaxed text-muted">{verdict.at}</p>
        </div>
      )}

      {verdict.kind === 'failed' && (
        <div role="alert" className="panel" data-tone="refused">
          <span className="eyebrow text-deny">stopped at {verdict.at}</span>
          <p className="scroll-x measure font-mono text-[12px] leading-relaxed break-words text-foreground/90">
            {verdict.detail}
          </p>
        </div>
      )}

      {verdict.kind === 'done' && (
        <>
          <div className="panel">
            <span className="eyebrow text-muted">what the extension said</span>
            <dl className="flex flex-col gap-3">
              {verdict.steps.map((step) => (
                <div key={step.label} className="flex flex-col gap-1">
                  <dt className="col-head text-muted-dim">{step.label}</dt>
                  <dd className="scroll-x font-mono text-[12px] break-words text-foreground/90">
                    {step.value}
                  </dd>
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <dt className="col-head text-muted-dim">typeof signedMessage</dt>
                <dd className="font-mono text-[12px] text-foreground/90">{verdict.signed.kind}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="col-head text-muted-dim">signedMessage</dt>
                <dd className="scroll-x font-mono text-[12px] break-words text-foreground/90">
                  {verdict.signed.preview}
                </dd>
              </div>
            </dl>
          </div>

          <div className="panel">
            <span className="eyebrow text-muted">
              what the server made of it — /api/dev/freighter-verify
            </span>
            <pre className="scroll-x font-mono text-[11.5px] leading-relaxed text-foreground/90">
              {JSON.stringify(verdict.verification, null, 2)}
            </pre>
            <p className="measure text-[12.5px] leading-relaxed text-muted">
              <span className="value">verified</span> and <span className="value">verifiedBy</span>{' '}
              are the answer. If <span className="value">verified</span>{' '}
              is false, every envelope tried is listed with its result — which is a finding about
              what Freighter signs, not a failure of this page.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
