/**
 * §4.4 on the client: row two never borrows row three's badge.
 *
 * The server-side half is `apps/runtime/test/tools.test.ts`, which asserts that
 * the `refused_by_limen` arm of `ToolResult` has no `evidence` property to fill.
 * This is the other end — the renderer that would have to invent one, and does
 * not.
 *
 * Two kinds of assertion, because the property has two halves:
 *
 *   1. **`parseToolResult` is exercised directly**, including against results
 *      that lie. It reads `unknown` that crossed two processes and a JSONB
 *      column, so a Limen refusal carrying a stray `evidence` is a shape it has
 *      to survive rather than one it can assume away.
 *   2. **The source is scanned**, in the style `design-system.test.ts` uses for
 *      `Verdict.tsx`. Some of what matters here is about which JSX exists at
 *      all — a `TxHash` reachable from the Limen branch would be a bug no
 *      unit test of a pure function could see.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseToolResult } from '@/components/app/TurnResult';

const source = readFileSync(
  fileURLToPath(new URL('../src/components/app/TurnResult.tsx', import.meta.url)),
  'utf8',
);

describe('a refusal by Limen', () => {
  it('is parsed with a constraint and a ledger opinion', () => {
    const parsed = parseToolResult({
      outcome: 'refused_by_limen',
      summary: 'over the per-transaction cap',
      constraint: 'max_amount',
      ledgerWould: 'permit',
      reachedLedger: false,
    });

    expect(parsed).toEqual({
      kind: 'refused_by_limen',
      summary: 'over the per-transaction cap',
      constraint: 'max_amount',
      ledgerWould: 'permit',
    });
  });

  it('drops an evidence hash even when one is present in the result', () => {
    // The case that matters. Nothing should ever send this, and if something
    // does, the answer is not to render it — a Limen refusal never reached a
    // ledger, so a hash on one is wrong rather than extra.
    const parsed = parseToolResult({
      outcome: 'refused_by_limen',
      summary: 'over the cap',
      constraint: 'max_amount',
      ledgerWould: 'refuse',
      evidence: { hash: 'deadbeef', status: 'FAILED', opResult: 'trapped' },
    });

    expect(JSON.stringify(parsed)).not.toContain('deadbeef');
    expect(parsed).not.toHaveProperty('hash');
  });

  it('has no branch in the component that could draw a hash for it', () => {
    // A structural check: the only `TxHash` in this file sits inside the
    // `refused_by_network` block. If a second one appears, this fails and the
    // reviewer has to say which outcome it is for.
    expect(source.match(/<TxHash/g) ?? []).toHaveLength(1);
    const networkBlock = source.slice(source.indexOf("parsed.kind === 'refused_by_network' &&"));
    expect(networkBlock).toContain('<TxHash');
  });
});

describe('a refusal by the network', () => {
  it('is denied when it reached a ledger', () => {
    const parsed = parseToolResult({
      outcome: 'refused_by_network',
      summary: 'the boundary refused this',
      codes: [3001],
      boundaryRefusal: true,
      revokedRule: false,
      evidence: { hash: 'abc123', status: 'FAILED', opResult: 'invokeHostFunctionTrapped' },
    });

    expect(parsed).toMatchObject({ kind: 'refused_by_network', hash: 'abc123', revokedRule: false });
  });

  it('keeps the stated reason when there is no hash', () => {
    const parsed = parseToolResult({
      outcome: 'refused_by_network',
      summary: 'refused in simulation',
      codes: [3001],
      boundaryRefusal: true,
      revokedRule: false,
      evidence: null,
      whyNoEvidence: 'the enforcing simulation failed, so nothing was submitted',
    });

    expect(parsed).toMatchObject({
      kind: 'refused_by_network',
      hash: null,
      whyNoEvidence: 'the enforcing simulation failed, so nothing was submitted',
    });
  });

  it('carries the revoked-rule flag, which is a different claim from a refusal', () => {
    const parsed = parseToolResult({
      outcome: 'refused_by_network',
      summary: 'there is no rule',
      codes: [3000],
      boundaryRefusal: false,
      revokedRule: true,
      evidence: { hash: 'f00d', status: 'FAILED', opResult: 'trapped' },
    });

    expect(parsed).toMatchObject({ kind: 'refused_by_network', revokedRule: true });
  });
});

describe('the two outcomes that are not verdicts', () => {
  it('parses an infrastructure error with the stage it stopped at', () => {
    expect(parseToolResult({ outcome: 'infra_error', summary: 'RPC timed out', stage: 'submit' })).toEqual(
      { kind: 'infra_error', summary: 'RPC timed out', stage: 'submit' },
    );
  });

  it('parses an agent error', () => {
    expect(
      parseToolResult({ outcome: 'agent_error', summary: 'could not tell', detail: 'no address' }),
    ).toEqual({ kind: 'agent_error', summary: 'could not tell', detail: 'no address' });
  });

  it('gives neither of them a verdict badge', () => {
    // `verdictFor` returns null for both by falling through its switch. The
    // structural claim is that `Verdict` is rendered conditionally at all —
    // an unconditional badge would put a refusal-shaped thing on screen for an
    // event where the boundary was never consulted.
    expect(source).toContain('{verdict !== null && <Verdict state={verdict} />}');
  });
});

describe('a result this screen cannot read', () => {
  it('is unreadable rather than silently empty', () => {
    for (const bad of [null, undefined, 'a string', 42, {}, { outcome: 'something_new' }]) {
      expect(parseToolResult(bad).kind).toBe('unreadable');
    }
  });

  it('says it is a bug here rather than a verdict', () => {
    // Whitespace-insensitive: this asserts the sentence, not the line wrapping,
    // so a formatter reflowing the JSX does not fail an unrelated test.
    expect(source.replace(/\s+/g, ' ')).toContain('a bug here rather than a verdict');
  });
});

describe('Verdict states', () => {
  it('uses only the four that exist', () => {
    // A fifth state for "nothing happened" is the error this guards against.
    // `design-system.test.ts` pins the four in `Verdict.tsx`; this pins that
    // nothing here invents another.
    const used = [...source.matchAll(/return '([a-z-]+)';/g)].map((match) => match[1]);
    const states = new Set(['permitted', 'denied', 'refused-at-simulation', 'rule-revoked']);
    for (const state of used) {
      if (state !== undefined && /^(permitted|denied|refused|rule)/.test(state)) {
        expect(states).toContain(state);
      }
    }
  });
});
