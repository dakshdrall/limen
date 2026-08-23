'use client';

import { Verdict, type VerdictState } from '@/components/Verdict';
import { TxHash } from '@/components/ExplorerLink';

/**
 * What one turn did, drawn from the tool's own five-way outcome.
 *
 * This is the client half of §4.4, and the whole file is about one rule:
 * **row two never borrows row three's badge.** A refusal by Limen and a refusal
 * by the network are different claims with different evidence, and the way this
 * component keeps them apart is structural rather than careful — `parse` below
 * reads a discriminated union, and the arm for a Limen refusal has no field
 * that could hold a hash even if the server sent one.
 *
 * ## Two of the five outcomes get no verdict at all
 *
 * `infra_error` and `agent_error` are not verdicts. Nothing decided anything —
 * the RPC timed out, or the model could not work out what was meant. Giving
 * either a badge would put a refusal-shaped thing on screen for an event where
 * the boundary was never consulted, which is the same error as a missing hash
 * rendered as a placeholder: it makes an absence look like a finding.
 *
 * So they are drawn as a plain panel with no `Verdict`. `Verdict` has exactly
 * four states and `design-system.test.ts` pins that; a fifth for "nothing
 * happened" would be a category error wearing a colour.
 *
 * ## Why a Limen refusal is `denied` and not `refused-at-simulation`
 *
 * `refused-at-simulation` means the *boundary* refused something that never
 * reached a ledger — the contract's verdict, with nothing on chain to point at.
 * A Limen refusal never consulted the contract at all. `Verdict`'s own comment
 * settles which to use: `denied` deliberately does not assert where the verdict
 * came from, because Limen's evaluator produces DENY rows too, and provenance
 * is carried by the enclosing section. That is what the eyebrow and the
 * `ledgerWould` sentence below are for.
 */

/** The arms of `ToolResult`, as the client needs them. */
type Parsed =
  | { kind: 'succeeded'; summary: string; hash: string | null }
  | { kind: 'refused_by_limen'; summary: string; constraint: string; ledgerWould: string }
  | {
      kind: 'refused_by_network';
      summary: string;
      codes: number[];
      revokedRule: boolean;
      hash: string | null;
      whyNoEvidence: string | null;
    }
  | { kind: 'infra_error'; summary: string; stage: string }
  | { kind: 'agent_error'; summary: string; detail: string }
  | { kind: 'unreadable' };

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

function evidenceHash(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const hash = (value as { hash?: unknown }).hash;
  return typeof hash === 'string' && hash.length > 0 ? hash : null;
}

/**
 * `result` arrives as `unknown` — it crossed two processes and a database
 * column to get here. Every field is re-derived rather than trusted, and an
 * outcome word this component does not know becomes `unreadable` instead of
 * rendering a blank panel that looks like a successful turn.
 */
export function parseToolResult(result: unknown): Parsed {
  if (typeof result !== 'object' || result === null) return { kind: 'unreadable' };
  const raw = result as Record<string, unknown>;
  const summary = str(raw.summary, 'The tool returned no summary.');

  switch (raw.outcome) {
    case 'succeeded':
      return { kind: 'succeeded', summary, hash: evidenceHash(raw.evidence) };

    case 'refused_by_limen':
      // No `hash`, and no place to put one. The server-side union has no
      // `evidence` field on this arm; this mirrors that so the two cannot
      // drift into agreement about a hash that should not exist.
      return {
        kind: 'refused_by_limen',
        summary,
        constraint: str(raw.constraint, 'a limit you set'),
        ledgerWould: str(raw.ledgerWould, 'unknown'),
      };

    case 'refused_by_network':
      return {
        kind: 'refused_by_network',
        summary,
        codes: Array.isArray(raw.codes) ? raw.codes.filter((c): c is number => typeof c === 'number') : [],
        revokedRule: raw.revokedRule === true,
        hash: evidenceHash(raw.evidence),
        whyNoEvidence: typeof raw.whyNoEvidence === 'string' ? raw.whyNoEvidence : null,
      };

    case 'infra_error':
      return { kind: 'infra_error', summary, stage: str(raw.stage, 'unknown') };

    case 'agent_error':
      return { kind: 'agent_error', summary, detail: str(raw.detail) };

    default:
      return { kind: 'unreadable' };
  }
}

/** Which of the four states this outcome is, or none — see the header. */
function verdictFor(parsed: Parsed): VerdictState | null {
  switch (parsed.kind) {
    case 'succeeded':
      return 'permitted';
    case 'refused_by_limen':
      return 'denied';
    case 'refused_by_network':
      if (parsed.revokedRule) return 'rule-revoked';
      // A refusal with a hash reached a ledger; one without never did. That is
      // the distinction the third state exists for, and it is read off the
      // evidence rather than asserted by the caller.
      return parsed.hash === null ? 'refused-at-simulation' : 'denied';
    default:
      return null;
  }
}

export function TurnResult({ result }: { result: unknown }) {
  const parsed = parseToolResult(result);
  const verdict = verdictFor(parsed);

  if (parsed.kind === 'unreadable') {
    return (
      <div className="panel" data-tone="refused">
        <span className="eyebrow text-muted">unreadable result</span>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          The turn finished but its result is not in a shape this screen knows how to read. That is
          a bug here rather than a verdict — nothing about what the agent did should be inferred
          from this panel.
        </p>
      </div>
    );
  }

  return (
    <div className="panel" data-tone={verdict === 'permitted' ? undefined : 'refused'}>
      <div className="flex flex-wrap items-center gap-2.5">
        {verdict !== null && <Verdict state={verdict} />}
        <span className="eyebrow text-muted">{eyebrow(parsed)}</span>
      </div>

      <p className="measure text-[13px] leading-relaxed text-foreground/90">{parsed.summary}</p>

      {parsed.kind === 'refused_by_limen' && (
        <>
          <p className="text-[12.5px] leading-relaxed text-muted">
            Refused by Limen, before anything was sent. The constraint was{' '}
            <span className="value">{parsed.constraint}</span>, and this attempt never reached the
            ledger — so there is no transaction to look up, and none is missing.
          </p>
          {/* §4.4's requirement, stated rather than implied: a Limen refusal
              says what the ledger would have done. Without it a user cannot
              tell a limit Limen enforces from one the network would have. */}
          <p className="text-[12.5px] leading-relaxed text-muted">
            The ledger would have{' '}
            <span className="value">{describeLedgerWould(parsed.ledgerWould)}</span>.
          </p>
        </>
      )}

      {parsed.kind === 'refused_by_network' && (
        <>
          {parsed.codes.length > 0 && (
            <p className="text-[12.5px] leading-relaxed text-muted">
              The contract reported{' '}
              <span className="value">{parsed.codes.map((c) => `#${c}`).join(', ')}</span>.
            </p>
          )}
          {parsed.hash !== null ? (
            <p className="text-[12.5px] leading-relaxed text-muted">
              This reached a ledger and is checkable by anyone: <TxHash hash={parsed.hash} />
            </p>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-muted">
              There is no transaction to point at.{' '}
              {parsed.whyNoEvidence ?? 'The attempt was refused before it could be submitted.'} A
              missing hash here is a finding, not a blank field.
            </p>
          )}
        </>
      )}

      {parsed.kind === 'infra_error' && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          This did not reach the network — it stopped at{' '}
          <span className="value">{parsed.stage}</span>. It is not a refusal, and nothing about the
          agent&rsquo;s limits should be read from it.
        </p>
      )}

      {parsed.kind === 'agent_error' && parsed.detail.length > 0 && (
        <p className="text-[12.5px] leading-relaxed text-muted">{parsed.detail}</p>
      )}
    </div>
  );
}

function eyebrow(parsed: Parsed): string {
  switch (parsed.kind) {
    case 'succeeded':
      return 'done';
    case 'refused_by_limen':
      return 'refused by Limen';
    case 'refused_by_network':
      return parsed.revokedRule ? 'no rule to enforce' : 'refused by the network';
    case 'infra_error':
      return 'did not reach the network';
    case 'agent_error':
      return 'the agent could not act';
    default:
      return '';
  }
}

/** `LedgerWould`'s words, in a sentence a person reads once. */
function describeLedgerWould(value: string): string {
  switch (value) {
    case 'permit':
      return 'permitted this — the limit is Limen’s, not the network’s';
    case 'refuse':
      return 'refused this too';
    default:
      return 'not been asked';
  }
}
