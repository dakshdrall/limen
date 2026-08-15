'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_SYNTHESIS_OPTIONS,
  SynthesisError,
  synthesize,
  type ObservedTransaction,
  type PolicyProposal,
} from '@limen/core';
import { Address } from '@/components/Address';
import { InstallPlanTable } from '@/components/app/InstallPlanTable';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { Pending, ReadFailure } from '@/components/app/ScreenState';
import { WriteResult } from '@/components/app/WriteResult';
import { NotEnforceable } from '@/components/NotEnforceable';
import { ObservedSection } from '@/components/ObservedSection';
import { PolicyTable } from '@/components/PolicyTable';
import { StatusLabel } from '@/components/StatusLabel';
import { Verdict } from '@/components/Verdict';
import type { SnapshotRule } from '@/lib/account-contract';
import {
  NO_FOOTPRINT_YET,
  OBSERVED_AMOUNT,
  SEED_AMOUNT,
  agentRepeats,
  agentRevokes,
  agentSpends,
  agentSpendsOver,
  deployAccount,
  fundSmartAccount,
  installBoundary,
  observedTransfer,
  ownerRevokes,
  prepareRun,
  type PermittedCall,
} from '@/lib/chain-actions';
import { fundFromFriendbot, type WriteOutcome } from '@/lib/chain-write';
import { decimalise } from '@/lib/format';
import type { IngestError } from '@/lib/ingest-contract';
import { NOT_EXPORTABLE, PASSKEY_STILL_LOCAL } from '@/lib/key-roles';
import { createLocalKeys } from '@/lib/local-key';
import { listAccounts, rememberAccount, rememberObserved, rememberProvenance } from '@/lib/store';
import { LOCAL_KEY_LABEL, PASSKEY_LABEL } from '@/lib/status-labels';
import { useAccountSnapshot } from '@/lib/use-account-snapshot';
import { useLastRead } from '@/lib/use-last-read';
import { useLocalKeyPublics, useLocalKeyRawPublics, useSigners } from '@/lib/use-local-keys';
import { PasskeyOwnerControl, type OwnerKind } from '@/components/app/PasskeyOwnerControl';
import { usePasskeySigner } from '@/lib/use-passkey';
import { WEBAUTHN_VERIFIER } from '@/lib/chain-config';
import { useLowering } from '@/lib/use-lowering';
import { useStored } from '@/lib/use-store';
import { useWriteLog } from '@/lib/use-write';
import { verdictFor } from '@/lib/verdict';

/**
 * The whole product as one path, in the order it makes sense in.
 *
 * PLAN-V7 §3. Everything here was already reachable — create an account, give it
 * a history, derive a boundary, install it, run an agent against it, take it
 * back — across four screens, at each of whose boundaries a person had to work
 * out what happened next for themselves. The capability was there and the
 * wayfinding was not.
 *
 * ## This owns no transaction
 *
 * Every write below is a call into `lib/chain-actions.ts`, which is the same
 * function the corresponding reference screen calls. That is the point of the
 * seam: the four screens stay as the reference view — read any account, inspect
 * any policy — and this is the path, and if the two held separate copies of the
 * write logic one of them would start lying. What this file owns is order,
 * gating and captions.
 *
 * The captions are its own, because a guided flow and a reference screen are
 * different registers. Any *claim*, though, is imported rather than paraphrased:
 * {@link NO_FOOTPRINT_YET}, the step-05 distinction in `lib/verdict.ts`, and the
 * sentence about there being no form here that accepts a secret key.
 *
 * ## One action at a time, and how the flow knows where it is
 *
 * Step *n+1* renders only once step *n* has landed, so there are never six
 * buttons. Where the flow has got to is **read from the chain** rather than from
 * a stored cursor: `useAccountSnapshot` answers whether the account exists,
 * whether a boundary is installed, what its cap is and whether it has been
 * revoked, and steps 4, 5 and 6 resume entirely from that.
 *
 * The one thing the chain cannot answer is *which* transaction this flow
 * observed, between steps 2 and 3. That is bookmarked in `store.ts` as
 * `observedTxHash` — and it is a bookmark, not an answer: on resume the hash goes
 * back through `/api/ingest` and the cap is derived from what the ledger
 * recorded. The stored value never reaches a cap.
 *
 * ## A failed step is a state, not a dead end
 *
 * `WriteResult` verbatim, which already draws the distinction that matters more
 * than a friendlier message would: `stage: 'browser'` versus `stage: 'ledger'` —
 * *was the network even asked*. Step 1's button says **retry from here** rather
 * than "start over", and means it: the sub-steps that already succeeded are
 * skipped on a retry, because re-funding a funded account reports success for a
 * request that did nothing.
 */

/** The six steps, as a person reads them. */
const STEPS = 6;

const STORAGE_REFUSED =
  'This browser refused to store the keys — private mode, or a full storage quota. Without storage the owner key would vanish on reload and the account would be stranded, so nothing was created.';

export function TryFlow() {
  const publics = useLocalKeyPublics();
  const raws = useLocalKeyRawPublics();
  const signers = useSigners();
  const log = useWriteLog();

  const [keyProblem, setKeyProblem] = useState<string | null>(null);

  /**
   * Which sub-steps of step 1 have already succeeded in this session.
   *
   * A ref rather than state: nothing renders from it, and it exists so that
   * "retry from here" is true. It is deliberately not persisted — on a reload,
   * step 1's completion is judged by the chain, which is the better answer.
   */
  const settled = useRef<Set<string>>(new Set());

  /**
   * What the permitted call produced, for the two attempts that cannot produce a
   * footprint of their own. The same ref `AgentRunSteps` keeps, for the same
   * reason, and cleared by a reload for the same reason.
   */
  const permitted = useRef<PermittedCall | null>(null);

  /* --- where the flow is, read from the chain ----------------------------- */

  // The account this flow is working on: the last one this browser recorded.
  // `undefined` while storage has not been read — the server render and the
  // hydration pass both land there, and it must not be confused with "none".
  const stored = useStored(() => listAccounts().at(-1) ?? null, []);
  const accountId = stored?.contractId ?? null;

  const { state: snapshot, reload } = useAccountSnapshot(accountId);
  const readRules = snapshot.status === 'ok' ? snapshot.snapshot.rules : null;

  // Held across re-reads. Every write below ends in `reload()`, which swaps the
  // snapshot back to pending, and a flow whose steps vanished for a second after
  // each transaction would be unusable. See `useLastRead` — this is the same
  // problem it was written for.
  const defaultRule = useLastRead(readRules?.find((r) => r.contextType === 'Default') ?? null);
  const boundaryRead = readRules?.find((r) => r.contextType !== 'Default') ?? null;
  const rule = useLastRead(boundaryRead);

  const owner = publics?.OWNER;
  const agent = publics?.AGENT;
  const ownerRaw = raws?.OWNER;

  const passkeySigner = usePasskeySigner();
  const passkey = passkeySigner();

  /**
   * Whether the account this flow is on is owned by the passkey, **read from
   * the chain** rather than from what this browser chose.
   *
   * The flow resumes from the chain and stores no cursor, and the owner kind is
   * no exception: a reload would lose a React state, and signing step 4 with
   * the local owner key on a passkey-owned account would be refused for a
   * reason nobody could see. The Default rule names its verifier, so the
   * account says which of the two it is.
   */
  const passkeyOwnsAccount =
    defaultRule !== null &&
    defaultRule.signers.some((s) => s.kind === 'External' && s.verifier === WEBAUTHN_VERIFIER);

  // Owning this account means holding the key its Default rule names, compared
  // in hex — the bytes the contract stores, not the `G…` a person reads. See
  // `AccountWriteSteps` for what comparing the wrong two cost. For a passkey the
  // stored value is the whole `key_data`, credential id included, which is why
  // `hexKeyData` exists beside `hexPublicKey`.
  const ownsAccount =
    defaultRule !== null &&
    defaultRule.signers.some(
      (s) =>
        s.kind === 'External' &&
        (s.publicKey === ownerRaw || (passkey !== undefined && s.publicKey === passkey.hexKeyData)),
    );

  /**
   * Which owner path a *new* account will take. Only consulted before one
   * exists; once it does, `passkeyOwnsAccount` is the answer.
   */
  const [chosenOwner, setChosenOwner] = useState<OwnerKind>('local');
  const ownerKind: OwnerKind = accountId === null ? chosenOwner : passkeyOwnsAccount ? 'passkey' : 'local';

  /**
   * The keys every write below signs with.
   *
   * `owner` is on both paths and does the same two jobs either way — fee source
   * and envelope signature. Only the owner *signer* moves, and it moves for the
   * whole flow rather than per step, because the account's owner is fixed at
   * creation.
   */
  const keysNow = () => {
    const base = signers();
    if (base === null) return null;
    if (ownerKind === 'local') return base;
    const held = passkeySigner();
    if (held === undefined) return null;
    return {
      ...base,
      passkey: { keyData: held.keyData, hexPublicKey: held.hexPublicKey, signer: held.signer },
    };
  };

  const observedHash = stored?.observedTxHash ?? null;

  /* --- step 3's derivation, re-read rather than remembered ---------------- */

  const [observed, setObserved] = useState<ObservedTransaction | null>(null);
  const [ingestProblem, setIngestProblem] = useState<IngestError['error'] | null>(null);
  const ingestRequested = useRef<string | null>(null);

  useEffect(() => {
    if (observedHash === null || ingestRequested.current === observedHash) return;
    ingestRequested.current = observedHash;
    setIngestProblem(null);

    void (async () => {
      try {
        const response = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hash: observedHash, network: 'testnet' }),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          setIngestProblem((body as IngestError).error);
          return;
        }
        setObserved(body as ObservedTransaction);
      } catch (error) {
        setIngestProblem({
          code: 'rpc_failed',
          message: 'the lookup could not be sent from this browser',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [observedHash]);

  // Derived on every render from what the ledger returned, never stored. This is
  // what makes it impossible for a cap from a previous transaction to survive.
  let proposal: PolicyProposal | null = null;
  let synthesisRefusal: string | null = null;
  if (observed !== null) {
    try {
      proposal = synthesize(observed, DEFAULT_SYNTHESIS_OPTIONS);
    } catch (error) {
      if (error instanceof SynthesisError) synthesisRefusal = error.message;
      else throw error;
    }
  }

  const lowered = useLowering(proposal);

  /* --- gating -------------------------------------------------------------- */

  const landed = (key: string) => log.stateOf(key).status === 'onLedger';
  const succeeded = (key: string) => {
    const state = log.stateOf(key);
    return state.status === 'onLedger' && state.ok;
  };

  // The rule was there and the chain now says it is not. Distinguished from "not
  // read yet" so a reload mid-flow does not present itself as a completed revoke.
  const revoked = rule !== null && boundaryRead === null && snapshot.status === 'ok';

  /**
   * Whether step 1 has been attempted, which decides whether its button offers
   * to start or to retry.
   *
   * Read off the write log rather than off `settled`, and not only because a ref
   * cannot be read during render: the log is what re-renders. A label derived
   * from the ref would still say "Set everything up" after a sub-step failed,
   * because nothing would have told React to look again.
   */
  const SETUP_STEPS = ['fund:OWNER', 'fund:AGENT', 'deploy', 'seed'];
  const setupAttempted = SETUP_STEPS.some((key) => log.stateOf(key).status !== 'idle');

  /**
   * Step 2 tried and did not land, which is the one case that reopens step 1.
   *
   * The flow judges step 1 complete from the chain — the account exists and this
   * browser owns it — and the chain cannot say whether the smart account holds a
   * balance. So an account created on `/app/accounts/new`, which deploys but does
   * not seed, resumes here at step 2 and step 2 fails for want of funds.
   *
   * That failure is already a state rather than a dead end, because `WriteResult`
   * says what happened and at which stage. It was still a dead *end*: the only
   * thing that would fix it lives in step 1, and step 1 had no control on screen.
   * This is the narrow condition that puts one back, and it is deliberately not
   * "step 1 is always retryable" — that would be six buttons wearing a disguise.
   */
  const observeFailed = (() => {
    const state = log.stateOf('observe');
    if (state.status === 'failed') return true;
    return state.status === 'onLedger' && !state.ok;
  })();

  let current = 1;
  if (ownsAccount) current = 2;
  if (ownsAccount && observedHash !== null) current = 3;
  if (current === 3 && lowered.status === 'lowered') current = 4;
  if (rule !== null) current = 5;
  if (rule !== null && (landed('agent-revoke') || revoked)) current = 6;

  /* --- step 1 -------------------------------------------------------------- */

  const friendbot = async (key: string, role: 'owner' | 'agent', publicKey: string) => {
    const what = `Friendbot funding the ${role}’s classic account`;

    // `track`, not `run`: friendbot is not a transaction this application built
    // and signed, and `toWriteOutcome` has nothing to say about one. It still
    // takes the same guard, so the button is shut for the length of the call.
    const outcome = await log.track(key, what, async (): Promise<WriteOutcome> => {
      const result = await fundFromFriendbot(publicKey);
      return result.ok
        ? {
            status: 'onLedger',
            what,
            // Friendbot does not always hand back a hash, and an already-funded
            // account never does. Empty renders without a link rather than with
            // one that 404s.
            hash: result.hash ?? '',
            ok: true,
            codes: [],
            opResult: 'friendbot',
            ledgerStatus: 'SUCCESS',
          }
        : { status: 'failed', what, stage: 'submit', message: result.message, code: null };
    });

    if (outcome?.status === 'onLedger' && outcome.ok) {
      settled.current.add(key);
      return true;
    }
    return false;
  };

  const runSetup = async () => {
    setKeyProblem(null);

    let keys = keysNow();
    if (keys === null) {
      if (createLocalKeys() === undefined) {
        setKeyProblem(STORAGE_REFUSED);
        return;
      }
      keys = keysNow();
      if (keys === null) {
        setKeyProblem(STORAGE_REFUSED);
        return;
      }
    }
    const k = keys;

    if (!settled.current.has('fund:OWNER') && !(await friendbot('fund:OWNER', 'owner', k.owner.publicKey))) return;
    if (!settled.current.has('fund:AGENT') && !(await friendbot('fund:AGENT', 'agent', k.agent.publicKey))) return;

    let contract = accountId;
    if (!settled.current.has('deploy') && contract === null) {
      let deployed: string | null = null;

      const outcome = await log.run(
        'deploy',
        'Creating the smart account — createCustomContract, with the owner signer as its only signer',
        () =>
          deployAccount({
            keys: k,
            onDeployed: (created) => {
              deployed = created;
            },
          }),
      );

      if (outcome?.status !== 'onLedger' || !outcome.ok || deployed === null) return;
      settled.current.add('deploy');
      contract = deployed;
      rememberAccount(deployed, outcome.hash);
    }
    if (contract === null) return;
    const target = contract;

    if (!settled.current.has('seed')) {
      const outcome = await log.run(
        'seed',
        `Funding the smart account — ${describeAmount(SEED_AMOUNT)} from the owner’s classic account`,
        () => fundSmartAccount({ keys: k, contractId: target }),
      );
      if (outcome?.status !== 'onLedger' || !outcome.ok) return;
      settled.current.add('seed');
    }

    reload();
  };

  /* --- step 2 -------------------------------------------------------------- */

  const runObserve = async () => {
    const keys = keysNow();
    if (keys === null || accountId === null || defaultRule === null) return;

    const outcome = await log.run(
      'observe',
      `The account’s own transaction — ${describeAmount(OBSERVED_AMOUNT)} out, authorized by its owner under the Default rule`,
      () => observedTransfer({ keys, contractId: accountId, defaultRuleId: defaultRule.id }),
    );

    // The hash, and only the hash. The cap is derived from what the ledger
    // recorded when this is read back, never from the amount just sent.
    if (outcome?.status === 'onLedger' && outcome.ok) rememberObserved(accountId, outcome.hash);
    reload();
  };

  /* --- step 4 -------------------------------------------------------------- */

  const runInstall = async () => {
    const keys = keysNow();
    if (keys === null || accountId === null || observed === null) return;
    if (lowered.status !== 'lowered') return;
    const plan = lowered.plan;
    const planned = plan.rules[0];

    let ruleId: number | null = null;

    const outcome = await log.run(
      'install',
      `Installing the boundary — add_context_rule on ${accountId}`,
      () =>
        installBoundary({
          keys,
          accountId,
          plan,
          onInstalled: (id) => {
            ruleId = id;
          },
        }),
    );

    if (outcome?.status === 'onLedger' && outcome.ok && ruleId !== null) {
      // Provenance is this application's history and exists nowhere on chain.
      // The rule itself is always re-read from the ledger.
      rememberProvenance(accountId, {
        observedTxHash: observed.hash,
        observedLedger: observed.ledger,
        headroomBps: DEFAULT_SYNTHESIS_OPTIONS.headroomBps,
        windowLedgers: planned?.policies[0]?.windowLedgers ?? 0,
        validityLedgers: planned?.validUntilLedger ?? 0,
        installTxHash: outcome.hash,
        contextRuleId: ruleId,
        recordedAt: new Date().toISOString(),
      });
    }
    reload();
  };

  /* --- steps 5 and 6 ------------------------------------------------------- */

  const prepare = () =>
    accountId === null ? Promise.resolve(null) : prepareRun({ keys: keysNow(), contractId: accountId, rule });

  const requirePermitted = (): PermittedCall => {
    if (permitted.current === null) throw new Error(NO_FOOTPRINT_YET);
    return permitted.current;
  };

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
    reload();
  };

  const runOverLimit = async () => {
    const ctx = await prepare();
    if (ctx === null) return;
    const over = ctx.cap * 2n;

    await log.run('over-limit', `The agent tries to spend ${decimalise(over.toString())} — over the cap`, () =>
      agentSpendsOver(ctx, requirePermitted(), { amount: over }),
    );
    reload();
  };

  const runAgentRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null || ctx.ownerSigns === null) return;
    // Bound before the closure: narrowing on a property does not survive into an
    // async callback, and the alternative is a non-null assertion on the one
    // value that decides who is allowed to sign.
    const ownerSigns = ctx.ownerSigns;

    await log.run('agent-revoke', 'The agent tries to remove the boundary that binds it', () =>
      agentRevokes(ctx, { ownerSigns }),
    );
    reload();
  };

  const runRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null || ctx.ownerSigns === null) return;
    const ownerSigns = ctx.ownerSigns;

    await log.run('revoke', 'The owner removes the boundary', () => ownerRevokes(ctx, { ownerSigns }));
    reload();
  };

  const runPostRevoke = async () => {
    const ctx = await prepare();
    if (ctx === null) return;

    await log.run(
      'post-revoke',
      'The agent repeats the call that worked — the amount is unchanged and still inside the cap',
      () => agentRepeats(ctx, requirePermitted()),
    );
    reload();
  };

  /* --- render -------------------------------------------------------------- */

  if (publics === undefined || stored === undefined) {
    return <Pending what="Reading what this browser holds." />;
  }

  // An account in storage that this browser cannot sign for. Reachable by
  // clearing keys without clearing accounts, and it must not silently resume
  // onto a flow where every button is dead.
  if (accountId !== null && defaultRule !== null && !ownsAccount) {
    return <NotThisBrowsersAccount contractId={accountId} owner={owner} />;
  }

  return (
    <div className="flex flex-col gap-12">
      <Step
        n={1}
        current={current}
        title="Get set up"
        caption="Five things, one button: two disposable keys generated in this browser, friendbot funding each of their classic accounts, the smart account deployed, and then the smart account funded — which can only happen after it exists."
      >
        <div className="flex flex-col gap-4">
          {owner !== undefined && agent !== undefined ? (
            <div className="panel">
              <div className="flex flex-col gap-4">
                {ownerKind === 'passkey' && (
                  // Which signer owns, above the two local keys rather than
                  // instead of them: on this path the OWNER key below still
                  // pays every fee and the AGENT key is still what the boundary
                  // is installed against.
                  //
                  // The limit sentence renders here as well as in the control,
                  // because §5.4 asks for it wherever a passkey account is
                  // created *and wherever one is used* — and a person resuming
                  // onto an existing passkey account never sees the control.
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                        owner
                      </span>
                      <StatusLabel name={PASSKEY_LABEL} />
                    </div>
                    <p className="measure text-[12.5px] leading-relaxed text-muted">
                      {PASSKEY_STILL_LOCAL}
                    </p>
                  </div>
                )}
                <LocalKeyBadge role="OWNER" publicKey={owner} weight="loud" showDisposability />
                <LocalKeyBadge role="AGENT" publicKey={agent} />
              </div>
            </div>
          ) : (
            <div className="panel" data-tone="pending">
              <div className="flex flex-wrap items-center gap-3">
                <span className="eyebrow text-muted-dim">nothing generated yet</span>
                <StatusLabel name={LOCAL_KEY_LABEL} weight="loud" />
              </div>
              <p className="measure text-[13px] leading-relaxed text-foreground/90">
                Two disposable ed25519 keypairs, generated here and kept in this browser&rsquo;s
                storage. They are not a wallet and they never reach a Limen server.
              </p>
              <p className="measure text-[12.5px] leading-relaxed text-muted">{NOT_EXPORTABLE}</p>
            </div>
          )}

          {/* The choice is offered only while there is no account. Once one
              exists its owner is fixed at creation, and `ownerKind` comes off
              the chain rather than off this control. */}
          {accountId === null && (
            <PasskeyOwnerControl
              value={chosenOwner}
              onChange={setChosenOwner}
              disabled={log.busy}
            />
          )}

          {(current === 1 || observeFailed) && (
            <div className="flex flex-col gap-2">
              {observeFailed && current > 1 && (
                <p className="measure text-[12.5px] leading-relaxed text-muted">
                  Step 2 did not land. If this account was created somewhere that deploys without
                  funding it, the transfer below has nothing to spend — running this again funds
                  what is unfunded and skips what already worked.
                </p>
              )}
              <button
                type="button"
                disabled={log.busy}
                onClick={() => void runSetup()}
                className="btn self-start"
                data-variant={current === 1 ? 'primary' : 'secondary'}
              >
                {setupAttempted || current > 1 ? 'Retry from here' : 'Set everything up'}
              </button>
            </div>
          )}

          {keyProblem !== null && (
            <p role="alert" className="text-[12.5px] leading-relaxed text-deny">
              {keyProblem}
            </p>
          )}

          <WriteResult state={log.stateOf('fund:OWNER')} />
          <WriteResult state={log.stateOf('fund:AGENT')} />
          <WriteResult state={log.stateOf('deploy')} />
          <WriteResult state={log.stateOf('seed')} />

          {accountId !== null && ownsAccount && (
            <div className="panel" data-tone="permitted">
              <div className="flex flex-wrap items-center gap-3">
                <span className="eyebrow text-permit">the account exists</span>
                <StatusLabel name="ON-CHAIN" />
              </div>
              <dl className="flex flex-col gap-0.5">
                <dt className="col-head text-muted-dim">smart account</dt>
                <dd className="text-[13px]">
                  <Address value={accountId} />
                </dd>
              </dl>
              <p className="measure text-[12.5px] leading-relaxed text-muted">
                Read out of the creation transaction&rsquo;s return value rather than derived from
                the deployer and salt, and confirmed here by reading the account back off the
                ledger.
              </p>
            </div>
          )}
        </div>
      </Step>

      <Step
        n={2}
        current={current}
        title="Do something worth bounding"
        caption="A boundary is derived from a transaction that already happened, so there has to be one first. This is the account's own transfer out — it runs __check_auth on the smart account under the Default rule, which is what makes it the account acting rather than the owner acting beside it."
      >
        <div className="flex flex-col gap-4">
          <div className="panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="col-head text-muted">the transaction the boundary comes from</span>
              {owner !== undefined && <LocalKeyBadge role="OWNER" publicKey={owner} />}
            </div>
            <p className="measure text-[12.5px] leading-relaxed text-muted">
              {describeAmount(OBSERVED_AMOUNT)}{' '}
              from this account to the agent&rsquo;s address
              {defaultRule !== null && (
                <>
                  , under context rule <span className="value">{defaultRule.id}</span>
                </>
              )}
              . What gets derived from it is read back off the ledger in the next step — never the
              amount this page just sent.
            </p>
            {current === 2 && (
              <button
                type="button"
                disabled={log.busy || defaultRule === null}
                onClick={() => void runObserve()}
                className="btn self-start"
                data-variant="primary"
              >
                Make the transaction
              </button>
            )}
          </div>

          <WriteResult state={log.stateOf('observe')} />
        </div>
      </Step>

      <Step
        n={3}
        current={current}
        title="See the boundary"
        caption="Read the transaction back from the network, derive the least-permissive boundary that still permits it, and lower that onto primitives an OpenZeppelin smart account can actually hold. Nothing is written here."
      >
        <div className="flex flex-col gap-6">
          {ingestProblem !== null && (
            <ReadFailure message={ingestProblem.message} detail={ingestProblem.detail} />
          )}

          {observed === null && ingestProblem === null && (
            <Pending what="Reading the transaction back from the network." />
          )}

          {observed !== null && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="col-head text-muted">what the ledger recorded</span>
                <StatusLabel name="ON-CHAIN" />
              </div>
              <ObservedSection observed={observed} />
            </div>
          )}

          {observed !== null && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="col-head text-muted">what Limen derived</span>
                <StatusLabel name="COMPUTED LOCALLY" />
              </div>
              {proposal === null ? (
                <RefusedToDerive message={synthesisRefusal ?? 'synthesis refused'} />
              ) : (
                <>
                  <PolicyTable proposal={proposal} />
                  <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                    Which means: from now on that key may move this token, up to this much, in this
                    window, and nothing else. Anything adjacent to the flow above — a larger amount,
                    a different token, a call to another contract — stops being possible for it.
                  </p>
                </>
              )}
            </div>
          )}

          {proposal !== null && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="col-head text-muted">what would be written</span>
                <StatusLabel name="COMPUTED LOCALLY" />
              </div>
              {lowered.status === 'pending' && (
                <Pending what="Lowering the proposal onto OpenZeppelin primitives." />
              )}
              {lowered.status === 'lowered' && <InstallPlanTable plan={lowered.plan} />}
              {lowered.status === 'refused' && (
                <NotEnforceable constraint={lowered.constraint} message={lowered.message} />
              )}
              {lowered.status === 'failed' && <ReadFailure message={lowered.message} />}
            </div>
          )}
        </div>
      </Step>

      <Step
        n={4}
        current={current}
        title="Install it"
        caption="One signed call. The owner key writes the plan above to the account as a context rule; the rule id comes out of what add_context_rule returned, not out of a guess."
      >
        <div className="flex flex-col gap-4">
          <div className="panel">
            <div className="flex flex-wrap items-center gap-3">
              <StatusLabel name="NOT AUDITED" weight="loud" />
              <StatusLabel name="COMPOSITION ONLY" />
            </div>

            {owner !== undefined && agent !== undefined && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="col-head text-muted-dim">signs this install</span>
                  <LocalKeyBadge role="OWNER" publicKey={owner} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="col-head text-muted-dim">bounded by it</span>
                  <LocalKeyBadge role="AGENT" publicKey={agent} />
                </div>
              </div>
            )}

            <p className="measure text-[12.5px] leading-relaxed text-muted">
              There is no form here that accepts a secret key, and there will not be one. A boundary
              installed here can be taken back — step 6 does exactly that.
            </p>

            {current === 4 && (
              <button
                type="button"
                disabled={log.busy || lowered.status !== 'lowered'}
                onClick={() => void runInstall()}
                className="btn self-start"
                data-variant="primary"
              >
                Install this boundary
              </button>
            )}
          </div>

          <WriteResult state={log.stateOf('install')} />

          {rule !== null && (
            <InstalledRule rule={rule} revoked={revoked} removedHere={succeeded('revoke')} />
          )}
        </div>
      </Step>

      <Step
        n={5}
        current={current}
        title="Watch the agent"
        caption="Three transactions by the agent's key, signed and paid for by the agent's own account. Each is real, each costs a testnet fee, and the second and third are meant to fail — on a ledger, with a hash, rather than as this page's word for what would have happened."
      >
        <div className="flex flex-col gap-5">
          <Action
            index="01"
            title="Inside the boundary"
            role="AGENT"
            publicKey={agent}
            state={log.stateOf('permitted')}
            verdict={verdictFor(log.stateOf('permitted'), 'permit')}
            action="Spend inside the cap"
            enabled={current === 5 && !log.busy}
            onRun={() => void runPermitted()}
          >
            No owner signature is anywhere near this transaction, and the separation is visible in
            the fee source as well as in the auth entry. It deliberately spends less than the cap —
            step 6 needs a call that failed for one reason only.
          </Action>

          {succeeded('permitted') && (
            <Action
              index="02"
              title="Outside it"
              role="AGENT"
              publicKey={agent}
              state={log.stateOf('over-limit')}
              verdict={verdictFor(log.stateOf('over-limit'), 'deny')}
              action="Try to spend over the cap"
              enabled={current === 5 && !log.busy}
              onRun={() => void runOverLimit()}
            >
              The same call with one argument changed, submitted with a footprint borrowed from the
              permitted one so that it reaches a ledger and is refused there rather than in
              simulation. The fee is spent to be told no, which is the point.
            </Action>
          )}

          {landed('over-limit') && (
            <Action
              index="03"
              title="The agent tries to remove its own boundary"
              role="AGENT"
              publicKey={agent}
              state={log.stateOf('agent-revoke')}
              verdict={verdictFor(log.stateOf('agent-revoke'), 'deny')}
              action="Try to revoke as the agent"
              enabled={current === 5 && !log.busy}
              onRun={() => void runAgentRevoke()}
            >
              This is the direct answer to &ldquo;the agent holds a key, so what stops it?&rdquo;.
              Refused by the contract rather than by this page withholding a button:{' '}
              <span className="value">remove_context_rule</span>{' '}
              requires the account to authorize itself, and this rule&rsquo;s context is a call to
              the token, which does not match a call to the account.
            </Action>
          )}
        </div>
      </Step>

      <Step
        n={6}
        current={current}
        title="Take it back"
        caption="The owner removes the boundary, and then the agent repeats the exact call that worked in step 5 — same host function, same footprint, same signed auth entry. Nothing about the agent's attempt changes. The account does."
      >
        <div className="flex flex-col gap-5">
          <Action
            index="04"
            title="The owner takes it back"
            role="OWNER"
            publicKey={owner}
            state={log.stateOf('revoke')}
            verdict={verdictFor(log.stateOf('revoke'), 'permit')}
            action="Revoke the boundary"
            enabled={current === 6 && !log.busy}
            onRun={() => void runRevoke()}
          >
            The same key that installed the boundary removes it. Afterwards the rule is re-read from
            the chain rather than assumed gone.
          </Action>

          {succeeded('revoke') && (
            <Action
              index="05"
              title="The same call, now"
              role="AGENT"
              publicKey={agent}
              state={log.stateOf('post-revoke')}
              verdict={verdictFor(log.stateOf('post-revoke'), 'deny')}
              action="Repeat the permitted call"
              enabled={current === 6 && !log.busy}
              onRun={() => void runPostRevoke()}
            >
              It fails because the rule is gone, not because a limit was reached — which is why step
              5 spent less than the cap. Those are different claims and this flow does not merge
              them: <span className="value">ContextRuleNotFound#3000</span>{' '}
              is deliberately outside the boundary-refusal codes and gets its own verdict.
            </Action>
          )}
        </div>
      </Step>
    </div>
  );
}

/**
 * One step, and the reason step *n+1* is not on screen yet.
 *
 * A step past the current one renders nothing at all rather than a disabled
 * version of itself. A disabled control claims the action exists and something
 * is temporarily wrong with it, which is not what "you have not got here yet"
 * means.
 */
function Step({
  n,
  current,
  title,
  caption,
  children,
}: {
  n: number;
  current: number;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  if (n > current) return null;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="col-head text-muted-dim">
            step {n} of {STEPS}
          </span>
          {n < current && <span className="eyebrow text-permit">done</span>}
        </div>
        <h2 className="text-[17px] font-semibold tracking-[-0.012em] text-foreground">{title}</h2>
        <p className="measure text-[13px] leading-relaxed text-muted">{caption}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * One transaction inside a step: what it will do, which key does it, what
 * happened, and what that means.
 *
 * The key badge renders beside every signature rather than once at the top of
 * the flow, for the reason `LocalKeyBadge` states: the claim is that the
 * agent's key cannot exceed a boundary the owner's key installed, and a person
 * who cannot see which of the two is acting has been asked to take it on trust.
 */
function Action({
  index,
  title,
  role,
  publicKey,
  state,
  verdict,
  action,
  enabled,
  onRun,
  children,
}: {
  index: string;
  title: string;
  role: 'OWNER' | 'AGENT';
  publicKey: string | undefined;
  state: ReturnType<ReturnType<typeof useWriteLog>['stateOf']>;
  verdict: ReturnType<typeof verdictFor>;
  action: string;
  enabled: boolean;
  onRun: () => void;
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

      {publicKey !== undefined && <LocalKeyBadge role={role} publicKey={publicKey} />}

      <button
        type="button"
        disabled={!enabled}
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

/** The boundary as the chain currently answers it, which is the only authority. */
/**
 * What step 4 says about its rule, including after step 6 has taken it away.
 *
 * The revoked branch is read **out of order**: a person who has just finished
 * step 6 scrolls back up and meets this panel sitting directly under step 4's
 * install hash. In that position "the rule is gone" is ambiguous in the worst
 * available direction — it pairs with a successful install and reads as *the
 * install did not stick*.
 *
 * Three things fix that, and all three are about the reading rather than the
 * facts, which were already correct:
 *
 *   - **`pending` was the wrong tone.** It is the token this app uses for *not
 *     done yet* — it is on "nothing generated yet" — so step 4 was wearing the
 *     same border as an unstarted step. A deliberately removed boundary is
 *     settled, not pending, and it is neither a permit nor a denial, so it takes
 *     no tone at all.
 *   - **The cause leads.** The revoke was in the second sentence, subordinate to
 *     a point about re-reading the chain. It is now the first thing said.
 *   - **The install is affirmed.** "The install above did land" answers the
 *     misreading directly, for the reader who arrived here without step 6 in
 *     mind.
 *
 * `removedHere` is why this can say *you*. The chain reports that a rule which
 * was there is not there now; it does not report who removed it or why. This
 * flow knows only whether **its own** step 6 landed, so the confident sentence
 * is gated on that, and a rule that vanished some other way — an expiry, a
 * revoke from `/app/policies/[id]` in another tab — gets the careful wording
 * instead. Naming a cause the chain did not state is the same error as reading
 * a refusal off an absence.
 */
function InstalledRule({
  rule,
  revoked,
  removedHere,
}: {
  rule: SnapshotRule;
  revoked: boolean;
  /** Whether *this flow's* step 6 is what removed it. */
  removedHere: boolean;
}) {
  return (
    <div className="panel" data-tone={revoked ? undefined : 'permitted'}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`eyebrow ${revoked ? 'text-muted' : 'text-permit'}`}>
          {revoked
            ? removedHere
              ? 'you took this back in step 6'
              : 'the rule is gone'
            : 'the boundary is installed'}
        </span>
        <StatusLabel name="ON-CHAIN" />
      </div>
      <p className="measure text-[13px] leading-relaxed text-foreground/90">
        {revoked ? (
          removedHere ? (
            <>
              You removed this in step 6, so context rule{' '}
              <span className="value">{rule.id}</span>{' '}
              is no longer on the account. The install above did land: the chain was re-read after
              the revoke rather than this page assuming what it did.
            </>
          ) : (
            <>
              Context rule <span className="value">{rule.id}</span>{' '}
              is no longer on the account, and this flow is not what removed it. The install above
              did land. The chain was re-read rather than this page assuming what happened.
            </>
          )
        ) : (
          <>
            Context rule <span className="value">{rule.id}</span>{' '}
            is on the account, read back from the ledger. The id came out of what{' '}
            <span className="value">add_context_rule</span>{' '}
            returned.
          </>
        )}
      </p>
    </div>
  );
}

function RefusedToDerive({ message }: { message: string }) {
  return (
    <div className="panel" data-tone="unproven">
      <div className="flex items-center gap-3">
        <span className="eyebrow text-unproven">refused to derive</span>
        <StatusLabel name="COMPUTED LOCALLY" />
      </div>
      <p className="measure text-[13px] leading-relaxed text-foreground/90">{message}</p>
      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        Refusing is the designed outcome, not a failure of the flow. A synthesizer that guessed here
        would produce a boundary nobody reviewed.
      </p>
    </div>
  );
}

function NotThisBrowsersAccount({
  contractId,
  owner,
}: {
  contractId: string;
  owner: string | undefined;
}) {
  return (
    <div className="panel" data-tone="pending">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow text-muted-dim">not this browser&rsquo;s account</span>
        <StatusLabel name={LOCAL_KEY_LABEL} />
      </div>
      <p className="measure text-[13px] leading-relaxed text-foreground/90">
        The most recent account here is <Address value={contractId} tone="dim" />, and its Default
        rule names a different owner than the key in this browser. This flow signs every step, so it
        has nothing to resume onto.
      </p>
      {owner !== undefined && <LocalKeyBadge role="OWNER" publicKey={owner} />}
      <p className="measure text-[12.5px] leading-relaxed text-muted">
        <Link href="/app/accounts" className="link">
          Accounts
        </Link>{' '}
        reads any account without signing for it.
      </p>
    </div>
  );
}

/**
 * Stroops as XLM, for a sentence a person reads.
 *
 * Display only, and never fed back into anything: every amount that reaches a
 * transaction or a policy stays a `bigint` in stroops, per design rule 5.
 */
function describeAmount(stroops: bigint): string {
  return `${decimalise(stroops.toString())} XLM`;
}
