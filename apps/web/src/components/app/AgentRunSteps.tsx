'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { WriteResult } from '@/components/app/WriteResult';
import { StatusLabel } from '@/components/StatusLabel';
import { LOCAL_KEY_LABEL } from '@/lib/status-labels';
import { Verdict } from '@/components/Verdict';
import type { SnapshotRule } from '@/lib/account-contract';
import {
  NO_FOOTPRINT_YET,
  agentRepeats,
  agentRevokes,
  agentSpends,
  agentSpendsOver,
  ownerRevokes,
  prepareRun,
  type PermittedCall,
} from '@/lib/chain-actions';
import { decimalise } from '@/lib/format';
import { useLastRead } from '@/lib/use-last-read';
import { useLocalKeyPublics, useLocalKeyRawPublics, useSigners } from '@/lib/use-local-keys';
import { useWriteLog, type WriteState } from '@/lib/use-write';
import { verdictFor } from '@/lib/verdict';

/**
 * The part that is actually the product: an agent inside its boundary, outside
 * it, and after it is taken away.
 *
 * Five transactions, in an order where each one's meaning depends on the one
 * before it:
 *
 *  1. **Permitted.** The agent spends under the cap. Signed by the agent's key
 *     and paid for by the agent's own account — no owner signature is anywhere
 *     near it, and the separation is visible in the fee source as well as in the
 *     auth entry.
 *  2. **Over the cap.** The same call with one argument changed. It is *refused
 *     on a ledger*, not in simulation, which costs a fee and is the whole point:
 *     an attempt with no hash is this repository's word for what would have
 *     happened.
 *  3. **The agent tries to revoke its own boundary.** Refused by the contract,
 *     not by this application declining to offer a button — `remove_context_rule`
 *     requires the account to authorize itself, and the agent's rule is
 *     `CallContract(token)`, which does not match a call to the account. The
 *     owner's Default rule does. This is the direct answer to *"the agent holds
 *     a key, so what stops it?"*
 *  4. **The owner revokes.**
 *  5. **The agent repeats step 1.** It now fails — and fails *differently*.
 *
 * ## The borrowed footprint, and why steps 2, 3 and 5 need one
 *
 * A failed simulation yields no footprint, so a call the boundary refuses cannot
 * be assembled into a transaction on its own. Each of those three borrows a
 * footprint from a call that touches the same contracts and does not fail.
 * Without that they would never reach a ledger, would have no hash, and would
 * appear on this screen as an assertion.
 *
 * ## Step 5 is not a refusal
 *
 * After the revoke, the call fails `ContextRuleNotFound#3000`, which is
 * deliberately not in `BOUNDARY_REFUSAL_CODES`. "The boundary refused you" and
 * "the boundary is gone" are different claims, and rendering the second as the
 * first would count a rule that no longer exists as a rule that did its job. It
 * gets its own verdict state, drawn in the neutral ramp.
 */

export function AgentRunSteps({
  contractId,
  rule: readRule,
  reading,
  onWritten,
}: {
  contractId: string;
  /**
   * The rule as last read, or `null` while a read is in flight and after the
   * revoke has removed it. This component stays mounted through both — see
   * {@link useLastRead} for why, and for what it cost to find out.
   */
  rule: SnapshotRule | null;
  /** True while the chain is being read, to tell "not yet" from "not there". */
  reading: boolean;
  onWritten: () => void;
}) {
  const rule = useLastRead(readRule);
  const publics = useLocalKeyPublics();
  const raws = useLocalKeyRawPublics();
  const signers = useSigners();
  const log = useWriteLog();

  /**
   * What the permitted call produced, kept for the two attempts that cannot
   * produce it themselves.
   *
   * A ref rather than state: nothing renders from it, and re-rendering when it
   * is filled would be a render caused by bookkeeping. It is cleared by a
   * reload, which is correct — the footprint belongs to a specific enforcing
   * simulation and reusing one across a page load would be borrowing from a call
   * this session never made.
   */
  const permitted = useRef<PermittedCall | null>(null);

  const requirePermitted = (): PermittedCall => {
    if (permitted.current === null) throw new Error(NO_FOOTPRINT_YET);
    return permitted.current;
  };

  const owner = publics?.OWNER;
  const agent = publics?.AGENT;

  const cap = rule?.policies[0]?.limit?.limit ?? null;
  const token = rule?.contract ?? null;

  // The agent this rule was installed for is the one named in its signers. A
  // browser holding some other agent key can read this screen and sign nothing
  // under this rule, which is the correct outcome and worth rendering as one.
  //
  // Compared in hex, for the reason spelled out in `AccountWriteSteps`: a rule's
  // `External` signer is the raw 32 bytes the contract stores, and `agent` is
  // the `G…` a person reads. Comparing the two made this false for every rule
  // this browser had just installed.
  //
  // `agent` is narrowed here as well as `agentRaw`. The hex decides the
  // question; the StrKey is what the badges below render, and this branch is
  // what makes both defined by the time they are used.
  const agentRaw = raws?.AGENT;
  const boundedByThisBrowser =
    agent !== undefined &&
    agentRaw !== undefined &&
    rule !== null &&
    rule.signers.some((signer) => signer.kind === 'External' && signer.publicKey === agentRaw);

  const ownsThisAccount = owner !== undefined;

  /** Everything the five steps share, resolved once per click. */
  const prepare = () => prepareRun({ keys: signers(), contractId, rule });

  const runPermitted = async () => {
    const ctx = await prepare();
    if (ctx === null) return;

    await log.run(
      'permitted',
      `The agent spends ${decimalise(ctx.permittedAmount.toString())} — inside the cap, signed and paid for by the agent`,
      () =>
        agentSpends(ctx, {
          onPermitted: (call) => {
            permitted.current = call;
          },
        }),
    );
    onWritten();
  };

  const runOverLimit = async () => {
    const ctx = await prepare();
    if (ctx === null) return;
    const over = ctx.cap * 2n;

    await log.run(
      'over-limit',
      `The agent tries to spend ${decimalise(over.toString())} — over the cap`,
      () => agentSpendsOver(ctx, requirePermitted(), { amount: over }),
    );
    onWritten();
  };

  const runAgentRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null || ctx.ownerSigns === null) return;
    // Bound before the closure: narrowing on a property does not survive into
    // an async callback, and the alternative is a non-null assertion on the one
    // value that decides who is allowed to sign.
    const ownerSigns = ctx.ownerSigns;

    await log.run('agent-revoke', 'The agent tries to remove the boundary that binds it', () =>
      agentRevokes(ctx, { ownerSigns }),
    );
    onWritten();
  };

  const runRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null || ctx.ownerSigns === null) return;
    const ownerSigns = ctx.ownerSigns;

    await log.run('revoke', 'The owner removes the boundary', () =>
      ownerRevokes(ctx, { ownerSigns }),
    );
    onWritten();
  };

  const runPostRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null) return;

    await log.run(
      'post-revoke',
      'The agent repeats the call that worked — the amount is unchanged and still inside the cap',
      () => agentRepeats(ctx, requirePermitted()),
    );
    onWritten();
  };

  if (publics === undefined) return null;

  // Never read, and still being read, are different answers and get different
  // words. This branch is only reachable before the first successful read —
  // once a rule has been seen, `useLastRead` holds it through every subsequent
  // reload, including the one after the revoke that removes it.
  if (rule === null) {
    return (
      <p className="measure text-[13px] leading-relaxed text-muted-dim">
        {reading
          ? 'Waiting for the rule to be read from the chain.'
          : 'There is no rule here to exercise.'}
      </p>
    );
  }

  if (!ownsThisAccount || !boundedByThisBrowser) {
    return (
      <div className="panel" data-tone="pending">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow text-muted-dim">read-only from this browser</span>
          <StatusLabel name={LOCAL_KEY_LABEL} />
        </div>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          {owner === undefined
            ? 'This browser holds no keys, so this boundary can be read here and exercised nowhere.'
            : 'This rule names a different agent key than the one in this browser. Everything above is readable; nothing here can be signed under this rule.'}
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          <Link href="/app/accounts/new" className="link">
            Create an account
          </Link>{' '}
          to run this end to end with keys of your own.
        </p>
      </div>
    );
  }

  if (cap === null || token === null) {
    return (
      <div className="panel" data-tone="unproven">
        <span className="eyebrow text-unproven">nothing to exercise</span>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          This rule has no readable spending cap, or authorizes any context rather than one
          contract. The steps below need both to mean anything, so they are not offered.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusLabel name="NOT AUDITED" weight="loud" />
        <p className="text-[12.5px] text-muted-dim">
          Each step below is a real testnet transaction and costs a real testnet fee. Run them in
          order — each one&rsquo;s meaning depends on the one before it.
        </p>
      </div>

      <Step
        index="01"
        title="Inside the boundary"
        role="AGENT"
        publicKey={agent}
        state={log.stateOf('permitted')}
        busy={log.busy}
        action="Spend inside the cap"
        onRun={() => void runPermitted()}
        verdict={verdictFor(log.stateOf('permitted'), 'permit')}
      >
        Signed by the agent&rsquo;s key and paid for by the agent&rsquo;s own account. No owner
        signature is anywhere near this transaction.
      </Step>

      <Step
        index="02"
        title="Outside it"
        role="AGENT"
        publicKey={agent}
        state={log.stateOf('over-limit')}
        busy={log.busy}
        action="Try to spend over the cap"
        onRun={() => void runOverLimit()}
        verdict={verdictFor(log.stateOf('over-limit'), 'deny')}
      >
        The same call with one argument changed, submitted with a footprint borrowed from the
        permitted one so that it reaches a ledger and is refused there rather than in simulation.
        The fee is spent to be told no, which is the point.
      </Step>

      <Step
        index="03"
        title="The agent tries to remove its own boundary"
        role="AGENT"
        publicKey={agent}
        state={log.stateOf('agent-revoke')}
        busy={log.busy}
        action="Try to revoke as the agent"
        onRun={() => void runAgentRevoke()}
        verdict={verdictFor(log.stateOf('agent-revoke'), 'deny')}
      >
        Refused by the contract, not by this page withholding a button.{' '}
        <span className="value">remove_context_rule</span>{' '}
        requires the account to authorize itself, and this rule&rsquo;s context is a call to the
        token — which does not match a call to the account. The owner&rsquo;s Default rule matches
        any context, so the owner can.
      </Step>

      <Step
        index="04"
        title="The owner takes it back"
        role="OWNER"
        publicKey={owner}
        state={log.stateOf('revoke')}
        busy={log.busy}
        action="Revoke the boundary"
        onRun={() => void runRevoke()}
        verdict={verdictFor(log.stateOf('revoke'), 'permit')}
      >
        The same key that installed the boundary removes it. Afterwards the rule is re-read from the
        chain rather than assumed gone — the block at the top of this screen is the ledger&rsquo;s
        answer, not this page&rsquo;s.
      </Step>

      <Step
        index="05"
        title="The same call, now"
        role="AGENT"
        publicKey={agent}
        state={log.stateOf('post-revoke')}
        busy={log.busy}
        action="Repeat the permitted call"
        onRun={() => void runPostRevoke()}
        verdict={verdictFor(log.stateOf('post-revoke'), 'deny')}
      >
        The amount is unchanged and still inside the cap that used to apply. It fails because the
        rule is gone, not because a limit was reached — which is why step 01 deliberately spent less
        than the cap. Those are different claims and this screen does not merge them.
      </Step>
    </div>
  );
}

function Step({
  index,
  title,
  role,
  publicKey,
  state,
  busy,
  action,
  onRun,
  verdict,
  children,
}: {
  index: string;
  title: string;
  role: 'OWNER' | 'AGENT';
  publicKey: string;
  state: WriteState;
  busy: boolean;
  action: string;
  onRun: () => void;
  verdict: ReturnType<typeof verdictFor>;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="col-head text-muted-dim">{index}</span>
          <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
        </div>
        {verdict !== null && <Verdict state={verdict.state} />}
      </div>

      <p className="measure text-[12.5px] leading-relaxed text-muted">{children}</p>

      {/* Which key is signing, at the moment it signs, rather than once at the
          top of the flow. The claim is that the agent's key cannot exceed a
          boundary the owner's key installed, and a person who cannot see which
          of the two is acting has been asked to take that on trust. */}
      <LocalKeyBadge role={role} publicKey={publicKey} />

      <button
        type="button"
        disabled={busy}
        onClick={onRun}
        className="btn self-start"
        data-variant={role === 'AGENT' ? 'secondary' : 'primary'}
      >
        {action}
      </button>

      <WriteResult state={state} />

      {verdict !== null && (
        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">{verdict.note}</p>
      )}
    </div>
  );
}
