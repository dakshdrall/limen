'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { isBoundaryRefusal, isRevokedRule } from '@limen/chain/errors';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { WriteResult } from '@/components/app/WriteResult';
import { StatusLabel } from '@/components/StatusLabel';
import { LOCAL_KEY_LABEL } from '@/lib/status-labels';
import { Verdict } from '@/components/Verdict';
import type { SnapshotRule } from '@/lib/account-contract';
import { ED25519_VERIFIER, RPC_URL } from '@/lib/chain-config';
import { loadChain, type ChainBrowser } from '@/lib/chain-write';
import { decimalise } from '@/lib/format';
import { NETWORK_PASSPHRASE } from '@/lib/network';
import { useLastRead } from '@/lib/use-last-read';
import { useLocalKeyPublics, useLocalKeyRawPublics, useSigners } from '@/lib/use-local-keys';
import { useWriteLog, type WriteState } from '@/lib/use-write';

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

/** Ledgers of validity for each signed auth entry. ~10 minutes. */
const AUTH_VALIDITY_LEDGERS = 200;

/**
 * The artifacts of the permitted call, which steps 02 and 05 borrow.
 *
 * Typed off the chain module rather than by importing the SDK's XDR types, so
 * this file names them without pulling the SDK into its own module graph.
 */
type SubmitLedgerResult = Extract<
  Awaited<ReturnType<ChainBrowser['submitAuthorized']>>,
  { stage: 'ledger' }
>;

interface PermittedCall {
  amount: bigint;
  transactionData: SubmitLedgerResult['transactionData'];
  signedAuth: SubmitLedgerResult['signedAuth'];
}

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
    if (permitted.current === null) {
      throw new Error(
        'run step 01 first: this attempt is refused by the network, so it cannot produce a footprint of its own and has to borrow one from the call that works',
      );
    }
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

  /**
   * Everything the five steps share, resolved once per click.
   *
   * The auth-entry signers are built here rather than in each step because they
   * must name the same rule and the same expiry across all five — a step that
   * quietly signed under a different rule would produce a refusal that looked
   * like the boundary working and was not.
   */
  const prepare = async () => {
    const keys = signers();
    // `rule` is retained across the revoke on purpose — step 05 submits under a
    // rule id that no longer exists, which is the only way to produce
    // `ContextRuleNotFound` — so it is checked here rather than assumed.
    if (keys === null || rule === null || token === null || cap === null) return null;

    const chain = await loadChain();
    const { rpc, xdr } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(RPC_URL);
    const latest = await server.getLatestLedger();
    const expiry = latest.sequence + AUTH_VALIDITY_LEDGERS;

    const rules = await chain.readAllContextRules(
      { rpcUrl: RPC_URL, simulationSource: keys.owner.publicKey },
      contractId,
    );
    const defaultRule = rules.find((r) => r.contextType === 'Default');

    return {
      chain,
      xdr,
      keys,
      expiry,
      // Carried on the context rather than read off `rule` at each call site.
      // `rule` is nullable now that this component outlives the revoke, and the
      // one place that has already established it is not null is here.
      ruleId: rule.id,
      defaultRuleId: defaultRule?.id ?? null,
      agentSigns: chain.signAs({
        signer: keys.agent.signer,
        verifier: ED25519_VERIFIER,
        contextRuleIds: [rule.id],
        expirationLedger: expiry,
        passphrase: NETWORK_PASSPHRASE,
      }),
      ownerSigns:
        defaultRule === undefined
          ? null
          : chain.signAs({
              signer: keys.owner.signer,
              verifier: ED25519_VERIFIER,
              contextRuleIds: [defaultRule.id],
              expirationLedger: expiry,
              passphrase: NETWORK_PASSPHRASE,
            }),
      // The permitted call, and the one every later step is a variation of.
      // Spending less than the cap on purpose: step 5 has to fail because the
      // rule is gone, and if the permitted amount had exhausted the cap it
      // would fail for two reasons at once and prove neither.
      permittedAmount: BigInt(cap) / 2n,
      token,
      transfer: (amount: bigint) =>
        chain.transferFunction({
          token,
          from: contractId,
          to: keys.owner.publicKey,
          amount,
        }),
    };
  };

  const runPermitted = async () => {
    const ctx = await prepare();
    if (ctx === null) return;

    await log.run(
      'permitted',
      `The agent spends ${decimalise(ctx.permittedAmount.toString())} — inside the cap, signed and paid for by the agent`,
      async () => {
        const result = await ctx.chain.submitAuthorized({
          rpcUrl: RPC_URL,
          passphrase: NETWORK_PASSPHRASE,
          feeSource: ctx.keys.agent.publicKey,
          signEnvelope: ctx.keys.agent.signEnvelope,
          func: ctx.transfer(ctx.permittedAmount),
          signAuthEntry: ctx.agentSigns,
          label: 'permitted',
        });

        // Steps 02 and 05 are attempts the network refuses, so neither can
        // produce a footprint of its own. Both borrow this one — the enforcing
        // simulation of the call that *does* work, which is the only thing that
        // lets a refusal reach a ledger and have a hash worth showing.
        if (result.stage === 'ledger' && result.ok) {
          permitted.current = {
            amount: ctx.permittedAmount,
            transactionData: result.transactionData,
            signedAuth: result.signedAuth,
          };
        }
        return result;
      },
    );
    onWritten();
  };

  const runOverLimit = async () => {
    const ctx = await prepare();
    if (ctx === null || cap === null) return;
    const over = BigInt(cap) * 2n;

    await log.run(
      'over-limit',
      `The agent tries to spend ${decimalise(over.toString())} — over the cap`,
      async () => {
        const borrowed = requirePermitted();
        const permittedFunc = ctx.transfer(borrowed.amount);

        // The entry the permitted call produces, with one argument changed. The
        // agent signs the modified entry, so this is a real attempt by the
        // agent's key rather than a malformed transaction.
        const [recorded] = await ctx.chain.recordAuthEntries({
          rpcUrl: RPC_URL,
          passphrase: NETWORK_PASSPHRASE,
          feeSource: ctx.keys.agent.publicKey,
          func: permittedFunc,
        });
        if (recorded === undefined) throw new Error('the permitted call produced no auth entry');

        const overEntry = ctx.xdr.SorobanAuthorizationEntry.fromXDR(recorded.toXDR());
        overEntry.rootInvocation().function().contractFn().args()[2] = ctx.chain.i128(over);

        return ctx.chain.submitWithBorrowedFootprint({
          rpcUrl: RPC_URL,
          passphrase: NETWORK_PASSPHRASE,
          feeSource: ctx.keys.agent.publicKey,
          signEnvelope: ctx.keys.agent.signEnvelope,
          func: ctx.transfer(over),
          transactionData: borrowed.transactionData,
          auth: [await ctx.agentSigns(overEntry)],
          label: 'over-limit',
        });
      },
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

    await log.run('agent-revoke', 'The agent tries to remove the boundary that binds it', async () => {
      const revokeFunc = ctx.chain.removeContextRuleFunction(contractId, ctx.ruleId);

      // Borrowed from the *owner's* revoke, which simulates cleanly. The
      // agent's own attempt does not, which is the finding.
      const footprint = await ctx.chain.enforcingFootprint({
        rpcUrl: RPC_URL,
        passphrase: NETWORK_PASSPHRASE,
        feeSource: ctx.keys.owner.publicKey,
        func: revokeFunc,
        signAuthEntry: ownerSigns,
      });

      const [entry] = await ctx.chain.recordAuthEntries({
        rpcUrl: RPC_URL,
        passphrase: NETWORK_PASSPHRASE,
        feeSource: ctx.keys.agent.publicKey,
        func: revokeFunc,
      });
      if (entry === undefined) throw new Error('the revoke call produced no auth entry');

      return ctx.chain.submitWithBorrowedFootprint({
        rpcUrl: RPC_URL,
        passphrase: NETWORK_PASSPHRASE,
        feeSource: ctx.keys.agent.publicKey,
        signEnvelope: ctx.keys.agent.signEnvelope,
        func: revokeFunc,
        transactionData: footprint,
        auth: [await ctx.agentSigns(entry)],
        label: 'agent-revoke',
      });
    });
    onWritten();
  };

  const runRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null || ctx.ownerSigns === null) return;
    const ownerSigns = ctx.ownerSigns;

    await log.run('revoke', 'The owner removes the boundary', () =>
      ctx.chain.submitAuthorized({
        rpcUrl: RPC_URL,
        passphrase: NETWORK_PASSPHRASE,
        feeSource: ctx.keys.owner.publicKey,
        signEnvelope: ctx.keys.owner.signEnvelope,
        func: ctx.chain.removeContextRuleFunction(contractId, ctx.ruleId),
        signAuthEntry: ownerSigns,
        label: 'revoke',
      }),
    );
    onWritten();
  };

  const runPostRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null) return;

    await log.run(
      'post-revoke',
      'The agent repeats the call that worked — the amount is unchanged and still inside the cap',
      async () => {
        // Byte for byte what step 01 submitted: the same host function, the
        // same borrowed footprint, and the *same signed auth entry*. Nothing
        // about the agent's attempt has changed — the account has. That is what
        // makes the different outcome attributable to the revoke and to nothing
        // else, and it is why neither is rebuilt here.
        const borrowed = requirePermitted();

        return ctx.chain.submitWithBorrowedFootprint({
          rpcUrl: RPC_URL,
          passphrase: NETWORK_PASSPHRASE,
          feeSource: ctx.keys.agent.publicKey,
          signEnvelope: ctx.keys.agent.signEnvelope,
          func: ctx.transfer(borrowed.amount),
          transactionData: borrowed.transactionData,
          auth: borrowed.signedAuth,
          label: 'post-revoke',
        });
      },
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

/**
 * The verdict for a settled step, or `null` while there is nothing to judge.
 *
 * `expected` is what a *successful* run of this step looks like: step 01 should
 * be permitted, steps 02, 03 and 05 should be refused. It is not used to decide
 * the verdict — the codes are — but to keep an on-ledger success from rendering
 * as a permit on a step where success would mean the boundary failed.
 */
function verdictFor(
  state: WriteState,
  expected: 'permit' | 'deny',
): { state: 'permitted' | 'denied' | 'rule-revoked'; note: string } | null {
  if (state.status !== 'onLedger') return null;

  if (state.ok) {
    return expected === 'permit'
      ? { state: 'permitted', note: 'The network ran it and it succeeded.' }
      : {
          state: 'permitted',
          note: 'This succeeded, and on this step that means the boundary did not hold. It is reported as it happened.',
        };
  }

  if (isRevokedRule(state.codes)) {
    return {
      state: 'rule-revoked',
      note: 'The rule is gone, so nothing refused this — there was no boundary left to consult. Not counted as a refusal.',
    };
  }

  if (isBoundaryRefusal(state.codes)) {
    return { state: 'denied', note: 'Refused by the policy contract, executed by the host.' };
  }

  return {
    state: 'denied',
    note: 'It failed on a ledger, but no code identifying a boundary refusal was decoded — so it is not attributable to the boundary.',
  };
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
