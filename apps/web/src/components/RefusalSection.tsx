'use client';

import type { ReactNode } from 'react';

/**
 * Refusal, rendered as a result rather than as a crash.
 *
 * `synthesize` throws when a flow needs more policies than a context rule holds,
 * or when a constraint cannot be expressed by composing audited primitives. The
 * extractor throws when a transfer happened that it could not read. Both are the
 * system declining to guess, and a reviewer who watches Limen refuse cleanly
 * learns more about whether to trust it than one who only ever watches it
 * succeed.
 *
 * So this component states three things, in order: what was attempted, why
 * Limen refused, and — the part that turns a failure into evidence — what it
 * specifically did NOT do instead.
 */

/** Written explanations, keyed by the code the thrower supplied. */
const EXPLANATIONS: Record<string, string> = {
  policy_limit_exceeded:
    'This flow needs more policies than an OpenZeppelin context rule can hold. A context rule carries at most five. Limen will not merge two spending limits into one looser limit to make them fit, because a merged limit permits transactions that neither original limit permitted — it would buy a rendering convenience with real permission.',
  not_expressible:
    'This flow implies a constraint that cannot be expressed as a configuration of an existing audited primitive. Limen composes `spending_limit` and function allowlists; it does not generate policy code. A constraint that needs something else is refused rather than approximated by the nearest primitive that happens to fit.',
  invalid_amount:
    'An amount in this transaction is not an integer in the asset’s smallest unit. Coercing it — rounding, truncating, or parsing it as a float — is how a non-integer gets into the amount path, and every cap downstream would inherit the error.',
  invalid_window:
    'The requested spending window is longer than the context rule’s own lifetime. That is a limit that never resets inside the period it governs: the rule expires before the window rolls, so a “rolling” cap would really be a one-shot lifetime allowance wearing the wrong name.',
  invalid_headroom:
    'The requested headroom would derive a cap below the observed outflow, so the resulting policy would refuse the very transaction it was derived from.',
  no_invocations:
    'This transaction contains no contract invocations. A permission boundary is derived from what an agent called and what moved as a result; a transaction with no calls has no flow to bound.',
  unreadable_movement:
    'This transaction contains a token transfer whose amount could not be established. Limen will not record the transfers it could read and drop the one it could not: the resulting cap would be derived from a flow that never happened, and every number on this page would be quietly wrong rather than loudly absent.',
  unreadable_meta:
    'This transaction’s Soroban metadata could not be read, so the token movements it contains cannot be established. A policy derived from an unknown set of movements is not a conservative policy — it is a fictional one.',
  mainnet_out_of_scope:
    'Mainnet is out of scope for this MVP. It is refused explicitly rather than silently treated as testnet, because a policy derived under one network’s assumptions and installed under another’s is exactly the class of mistake this project exists to prevent.',
};

const FALLBACK =
  'Limen could not derive a policy it can stand behind for this transaction, and refused rather than emitting one it cannot justify.';

export function RefusalSection({
  code,
  message,
  detail,
  attempted,
}: {
  code: string;
  message: string;
  detail?: string;
  /** What was being asked for — the flow, or the hash that was looked up. */
  attempted: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 rounded-[5px] border border-deny-line bg-deny-dim/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="col-head rounded-[3px] border border-deny-line bg-deny-dim px-2 py-1 text-deny">
          REFUSED
        </span>
        <span className="value text-muted-dim">{code}</span>
      </div>

      <Block title="What was attempted">{attempted}</Block>

      <Block title="Why Limen refused">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-foreground">
          {EXPLANATIONS[code] ?? FALLBACK}
        </p>
        <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-dim">
          <span className="col-head mr-2 text-muted-dim">detail</span>
          <span className="value break-words">{message}</span>
          {detail !== undefined && detail.length > 0 && (
            <>
              {' '}
              <span className="value break-words text-faint">({detail})</span>
            </>
          )}
        </p>
      </Block>

      {/* The load-bearing part. Without this, a refusal reads as a failure. */}
      <Block title="What it did not do">
        <ul className="flex max-w-[80ch] flex-col gap-2">
          <DidNot>approximate the constraint with the nearest primitive that fits</DidNot>
          <DidNot>drop the part it could not express and emit the rest</DidNot>
          <DidNot>widen a cap, a window, or an allowlist to make the flow fit</DidNot>
        </ul>
        <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted">
          A policy Limen cannot derive exactly is not emitted at all. Silence here is the
          conservative outcome; a policy that looked plausible would not be.
        </p>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h4 className="col-head text-muted">{title}</h4>
      {children}
    </div>
  );
}

function DidNot({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 text-[13px] leading-relaxed text-muted">
      <span aria-hidden="true" className="value shrink-0 text-deny">
        ✕
      </span>
      <span>{children}</span>
    </li>
  );
}

/** The observed flow, summarised for the "what was attempted" block. */
export function AttemptedFlow({
  contracts,
  functions,
  assets,
  ledger,
}: {
  contracts: number;
  functions: number;
  assets: number;
  ledger: number;
}) {
  return (
    <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2 text-[13px]">
      <dt className="col-head text-muted-dim">contracts</dt>
      <dd className="value text-foreground">{contracts}</dd>
      <dt className="col-head text-muted-dim">functions</dt>
      <dd className="value text-foreground">{functions}</dd>
      <dt className="col-head text-muted-dim">assets out</dt>
      <dd className="value text-foreground">{assets}</dd>
      <dt className="col-head text-muted-dim">ledger</dt>
      <dd className="value text-foreground">{ledger}</dd>
    </dl>
  );
}
