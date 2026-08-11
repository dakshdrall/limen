'use client';

import Link from 'next/link';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { WriteResult } from '@/components/app/WriteResult';
import { StatusLabel } from '@/components/StatusLabel';
import { LOCAL_KEY_LABEL } from '@/lib/status-labels';
import { ED25519_VERIFIER, RPC_URL } from '@/lib/chain-config';
import { loadChain } from '@/lib/chain-write';
import { NETWORK_PASSPHRASE } from '@/lib/network';
import type { SnapshotRule } from '@/lib/account-contract';
import { decimalise } from '@/lib/format';
import { useLastRead } from '@/lib/use-last-read';
import { useLocalKeyPublics, useLocalKeyRawPublics, useSigners } from '@/lib/use-local-keys';
import { useWriteLog } from '@/lib/use-write';

/**
 * The two transactions that turn a fresh account into something with a history.
 *
 * PLAN-V4 §1 makes a point of the second one: **the observed transaction is the
 * person's own.** The boundary installed on the next screen is derived from a
 * transfer this account just made, read back off the ledger — not from a shipped
 * fixture and not from the constant this code sent. That is the product's
 * sentence, *"a user performs a transaction once"*, executed rather than
 * illustrated.
 *
 * Which is also why the amount is read back rather than remembered. The
 * derivation on `/app/policies/new` starts from `/api/ingest`, which reads the
 * transaction from the network and refuses metadata it cannot fully parse. If
 * this component passed its own `amount` forward instead of a hash, the cap
 * would be derived from this application's intent, and the one claim the whole
 * product makes is that it is not.
 *
 * ## Why these two are separate transactions
 *
 * The first is the owner's classic account paying the smart account: ordinary
 * `G→C`, authorized by an envelope signature. The second is the smart account
 * paying out: `C→G`, authorized through `__check_auth` under the constructor's
 * Default rule. Only the second exercises the smart account as a signer, and
 * only the second is worth deriving a boundary from.
 */

/** 100 XLM in stroops, enough to fund several agent runs and their fees. */
const SEED_AMOUNT = 1_000_000_000n;

/** 0.1 XLM. The flow the boundary is derived from — deliberately small. */
const OBSERVED_AMOUNT = 1_000_000n;

/** Ledgers of validity given to the owner's auth entry. ~10 minutes. */
const AUTH_VALIDITY_LEDGERS = 200;

export function AccountWriteSteps({
  contractId,
  rules: readRules,
  onWritten,
}: {
  contractId: string;
  /**
   * The rules as last read. `null` while the read is still in flight — which now
   * includes every re-read this component's own writes trigger, because it stays
   * mounted through them. {@link useLastRead} is what keeps the Default rule
   * known across that gap, so the buttons below do not disappear and reappear
   * after each transaction.
   */
  rules: SnapshotRule[] | null;
  /** Re-read the chain. Called after every write that lands. */
  onWritten: () => void;
}) {
  const rules = useLastRead(readRules);
  const publics = useLocalKeyPublics();
  const raws = useLocalKeyRawPublics();
  const signers = useSigners();
  const log = useWriteLog();

  const owner = publics?.OWNER;
  const agent = publics?.AGENT;
  const ownerRaw = raws?.OWNER;

  // The constructor's Default rule, read back off the account rather than
  // assumed to be 0. Its id comes from the same on-chain counter every other
  // rule's does; it happens to be 0 on a fresh account and nothing here relies
  // on that.
  const defaultRule = rules?.find((rule) => rule.contextType === 'Default') ?? null;

  // Owning this account means holding the key its Default rule names. A browser
  // that merely pasted the address can read everything and sign nothing, which
  // is correct and is what this check renders.
  //
  // In hex, and not in the `G…` above it. A rule's `External` signer carries the
  // raw 32 bytes the contract stores, which `read.ts` hands back as hex; `owner`
  // is the StrKey a person reads. The two are the same key and never the same
  // string, so comparing them made this branch permanently false — every account
  // created in this browser rendered as somebody else's, and everything below
  // was unreachable. See `useLocalKeyRawPublics`.
  const ownsThisAccount =
    ownerRaw !== undefined &&
    defaultRule !== null &&
    defaultRule.signers.some(
      (signer) => signer.kind === 'External' && signer.publicKey === ownerRaw,
    );

  const observed = log.stateOf('observe');
  const observedHash = observed.status === 'onLedger' && observed.ok ? observed.hash : null;

  const seed = async () => {
    const keys = signers();
    if (keys === null) return;

    await log.run(
      'seed',
      `Funding the smart account — ${describeAmount(SEED_AMOUNT)} from the owner’s classic account`,
      async () => {
        const chain = await loadChain();
        return chain.submitAuthorized({
          rpcUrl: RPC_URL,
          passphrase: NETWORK_PASSPHRASE,
          feeSource: keys.owner.publicKey,
          signEnvelope: keys.owner.signEnvelope,
          func: chain.transferFunction({
            token: chain.nativeTokenId(NETWORK_PASSPHRASE),
            from: keys.owner.publicKey,
            to: contractId,
            amount: SEED_AMOUNT,
          }),
          // No `signAuthEntry`: this is the owner's own classic account paying
          // out, authorized by the envelope signature. The smart account is
          // only the recipient and authorizes nothing.
          label: 'seed',
        });
      },
    );
    onWritten();
  };

  const observe = async () => {
    const keys = signers();
    if (keys === null || defaultRule === null) return;

    await log.run(
      'observe',
      `The account’s own transaction — ${describeAmount(OBSERVED_AMOUNT)} out, authorized by its owner under the Default rule`,
      async () => {
        const chain = await loadChain();
        const { rpc } = await import('@stellar/stellar-sdk');
        const latest = await new rpc.Server(RPC_URL).getLatestLedger();

        return chain.submitAuthorized({
          rpcUrl: RPC_URL,
          passphrase: NETWORK_PASSPHRASE,
          feeSource: keys.owner.publicKey,
          signEnvelope: keys.owner.signEnvelope,
          func: chain.transferFunction({
            token: chain.nativeTokenId(NETWORK_PASSPHRASE),
            from: contractId,
            to: keys.agent.publicKey,
            amount: OBSERVED_AMOUNT,
          }),
          // This is the half that makes it the account's transaction rather
          // than the owner's: the smart account is the `from`, so the host
          // calls `__check_auth` on it, and the owner's signature has to arrive
          // as a signed auth entry naming the rule it is signing under.
          signAuthEntry: chain.signAs({
            signer: keys.owner.signer,
            verifier: ED25519_VERIFIER,
            contextRuleIds: [defaultRule.id],
            expirationLedger: latest.sequence + AUTH_VALIDITY_LEDGERS,
            passphrase: NETWORK_PASSPHRASE,
          }),
          label: 'observe',
        });
      },
    );
    onWritten();
  };

  if (publics === undefined) return null;

  if (owner === undefined || agent === undefined) {
    return (
      <div className="panel">
        <span className="eyebrow text-muted-dim">read-only from this browser</span>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          This browser holds no keys, so everything above is readable and nothing here is signable.
          That is the correct state for an account someone else owns.
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          <Link href="/app/accounts/new" className="link">
            Create an account
          </Link>{' '}
          to get a disposable owner key in this browser.
        </p>
      </div>
    );
  }

  if (!ownsThisAccount) {
    return (
      <div className="panel">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow text-muted-dim">not this browser&rsquo;s account</span>
          <StatusLabel name={LOCAL_KEY_LABEL} />
        </div>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          {defaultRule === null
            ? 'This account has no Default rule, so there is no signer this browser could act as.'
            : 'This account’s Default rule names a different signer than the owner key in this browser. It can be read here and signed for nowhere.'}
        </p>
        <LocalKeyBadge role="OWNER" publicKey={owner} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          Give this account something to derive a boundary from
        </h3>
        <p className="measure text-[13px] leading-relaxed text-muted">
          A boundary is derived from a transaction that already happened. These two produce one: the
          account is funded, then it makes a transfer of its own, authorized by the owner key in
          this browser.
        </p>
      </div>

      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="col-head text-muted">01 · fund the account</span>
          <LocalKeyBadge role="OWNER" publicKey={owner} />
        </div>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          {describeAmount(SEED_AMOUNT)} from the owner&rsquo;s classic account to this contract.
          Ordinary <span className="value">G→C</span>: the smart account is the recipient and
          authorizes nothing.
        </p>
        <button
          type="button"
          disabled={log.busy}
          onClick={() => void seed()}
          className="btn"
          data-variant="secondary"
        >
          Fund the account
        </button>
        <WriteResult state={log.stateOf('seed')} />
      </div>

      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="col-head text-muted">02 · the observed transaction</span>
          <LocalKeyBadge role="OWNER" publicKey={owner} />
        </div>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          {describeAmount(OBSERVED_AMOUNT)} from this account to the agent&rsquo;s address. This one
          runs <span className="value">__check_auth</span> on the smart account under context rule{' '}
          <span className="value">{defaultRule.id}</span>, so it is the account acting rather than
          the owner acting beside it.
        </p>
        <button
          type="button"
          disabled={log.busy}
          onClick={() => void observe()}
          className="btn"
          data-variant="primary"
        >
          Make the transaction
        </button>
        <WriteResult state={log.stateOf('observe')} />

        {observedHash !== null && <DeriveFromIt hash={observedHash} contractId={contractId} />}
      </div>
    </div>
  );
}

function DeriveFromIt({ hash, contractId }: { hash: string; contractId: string }) {
  return (
    // `border-border-subtle`, and it is a fix rather than a restatement. This
    // divider and the one in `NewAccountScreen` both asked for
    // `border-border-faint` — a token that has never existed. The palette has
    // `--border-subtle`, `--border` and `--border-bright`, exposed as
    // `border-subtle`, `border-default` and `border-bright`; `faint` is a *text*
    // step. Tailwind emits nothing for an unknown colour, so both rules were
    // silently no-ops and both separators had been invisible since they were
    // written. Nothing looked broken, which is why it survived four versions.
    <div className="flex flex-col gap-2.5 border-t border-border-subtle pt-4">
      <p className="measure text-[12.5px] leading-relaxed text-foreground/90">
        Derive a boundary from this transaction. It is read back from the network there — the cap
        comes from what the ledger recorded, not from what this screen sent.
      </p>
      <Link
        href={`/app/policies/new?tx=${hash}&account=${contractId}`}
        className="btn self-start"
        data-variant="primary"
      >
        Derive a boundary from it
      </Link>
    </div>
  );
}

/**
 * Stroops as XLM, for a sentence a person reads.
 *
 * Display only, and never fed back into anything: every amount that reaches a
 * transaction or a policy stays a `bigint` in stroops, per design rule 5.
 * `decimalise` is the one place that inserts a decimal point, so this adds the
 * unit and nothing else rather than becoming a second implementation of it.
 */
function describeAmount(stroops: bigint): string {
  return `${decimalise(stroops.toString())} XLM`;
}
