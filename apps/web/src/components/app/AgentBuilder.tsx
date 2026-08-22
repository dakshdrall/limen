'use client';

import { useState } from 'react';
import { EmptyState, Pending } from '@/components/app/ScreenState';
import { AgentConfigForm } from '@/components/app/AgentConfigForm';
import {
  MAX_DESCRIPTION_LENGTH,
  emptyDraft,
  validate,
  type AgentConfigDraft,
  type FieldProblem,
} from '@/lib/agent-config';
import { useIdentity } from '@/lib/use-identity';
import { PASSKEY_LABEL } from '@limen/shared/status-labels';
import { StatusLabel } from '@/components/StatusLabel';
import {
  AgentApiError,
  ConfigRejected,
  NotEnforceableRefusal,
  beginDeployment,
  configureAgent,
  generateDraft,
  recordDeployment,
  recordDeploymentFailed,
  saveDraft,
  type ConfiguredAgent,
  type VerifiedDeployment,
} from '@/lib/agent-api';
import { WriteResult } from '@/components/app/WriteResult';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { Address } from '@/components/Address';
import {
  SEED_AMOUNT,
  STORAGE_REFUSED,
  deployAccount,
  fundSmartAccount,
  installBoundary,
} from '@/lib/chain-actions';
import { describeAmount } from '@/lib/format';
import { fundFromFriendbot, type WriteOutcome } from '@/lib/chain-write';
import { LOCAL_KEY_LABEL } from '@limen/shared/status-labels';
import { createLocalKeys } from '@/lib/local-key';
import { useLocalKeyPublics, useSigners } from '@/lib/use-local-keys';
import { useWriteLog } from '@/lib/use-write';
import { InstallPlanTable } from '@/components/app/InstallPlanTable';
import { NotEnforceable } from '@/components/NotEnforceable';
import { OffChainSummary } from '@/components/app/OffChainSummary';
import type { GenerationNote } from '@/lib/agent-generation';

/**
 * The four steps, and the one that is not automation.
 *
 * Describe → Generate → Review → Deploy. Three of those are the product being
 * convenient. The third is the product being safe, and it is the reason the
 * other three are allowed to exist: a model reads a sentence and proposes
 * numbers, and a person reads the numbers before anything is installed.
 *
 * ## The model is untrusted, and that is a property of this file's structure
 *
 * There is no path from a generated draft to a deployment that does not pass
 * through {@link AgentConfigForm} and {@link validate}. The generate step
 * writes into the same `draft` state a person types into — it has no privileged
 * channel — so a field the model filled and a field a person typed are
 * indistinguishable by the time anything acts on them, and both are validated
 * by the same function.
 *
 * That is deliberate and it is the cheap version of the guarantee. The
 * expensive version is on the chain: whatever this screen gets wrong, the
 * installed context rule is what bounds the agent, and it bounds it whether
 * this screen was right or not.
 *
 * ## Steps go backwards here, which is why this does not reuse `TryFlow`'s step
 *
 * `/app/try` walks six transactions in one direction — a submitted transaction
 * cannot be un-submitted, so its steps are one-way and a step past the current
 * one renders nothing. Editing a configuration is the opposite: the review step
 * exists to be returned to, and the describe step stays reachable so a person
 * can rewrite the sentence and regenerate. Sharing one component between two
 * flows with opposite rules about revisiting would mean a flag that means
 * "actually the other kind of step".
 */

/**
 * This screen is gated on a passkey, so it names the label for one.
 *
 * `test/local-key-label.test.ts` requires it of every file that imports a
 * module on the passkey path, and `use-identity.ts` is one. It is not
 * ceremony here: this is the only screen in the application that cannot be used
 * without registering or signing in, so it is where a person most needs to be
 * told what the credential they are about to create is and is not. It renders
 * in the signed-out state below rather than only being named in this constant.
 */
export const AGENT_BUILDER_PASSKEY_LABEL = PASSKEY_LABEL;

/**
 * The keys that deploy the account are generated in this browser, so this
 * screen names their label too.
 *
 * Required by `test/local-key-label.test.ts` of anything importing the key
 * modules, and it is the substantive claim on this screen rather than a
 * formality: the agent's key on this path is a **browser** key, not one Limen
 * holds. `LIMEN HOLDS THE AGENT KEY` is deliberately absent from this file and
 * from this application, because it is not true yet.
 */
export const AGENT_BUILDER_KEY_LABEL = LOCAL_KEY_LABEL;

/** Where the flow has got to. Not a step number — a state with a name. */
type Stage = 'describe' | 'review' | 'configured' | 'deployed';

const PLACEHOLDER = 'an agent that can pay approved suppliers up to 50 USDC';

export function AgentBuilder() {
  const identity = useIdentity();

  const [stage, setStage] = useState<Stage>('describe');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<AgentConfigDraft>(emptyDraft);
  const [problems, setProblems] = useState<FieldProblem[]>([]);

  /**
   * The `DRAFT` row this flow is working on, once there is one.
   *
   * Held so that rewriting the description updates the agent rather than
   * creating a second one. Three attempts at describing the same agent are one
   * agent — see `/api/agents/[id]`.
   */
  const [agentId, setAgentId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<GenerationNote[]>([]);
  /** Why the draft came back empty. Not an error — the ordinary unkeyed case. */
  const [degraded, setDegraded] = useState<string | null>(null);
  /** A route refused. Distinct from `degraded`: this one means try again. */
  const [refusal, setRefusal] = useState<string | null>(null);

  /** The stored boundary, once the server has derived and written one. */
  const [configured, setConfigured] = useState<ConfiguredAgent | null>(null);

  /**
   * Limen understood the limits completely and declined to install them.
   *
   * Its own state rather than a message, because it is not a mistake to
   * correct — it is the composition-only rule doing its job, and it renders
   * through `NotEnforceable` like every other refusal of the kind.
   */
  const [notEnforceable, setNotEnforceable] = useState<{
    constraint: string;
    message: string;
  } | null>(null);

  /** What the ledger said when the deployment was checked against it. */
  const [verified, setVerified] = useState<VerifiedDeployment | null>(null);
  const [smartAccount, setSmartAccount] = useState<string | null>(null);

  const log = useWriteLog();
  const publics = useLocalKeyPublics();
  const signers = useSigners();

  /**
   * `unknown` is the server render and the first client frame — reading a
   * cookie is a request-time API, so this component tree cannot know yet. It
   * says what it is waiting for rather than rendering the signed-out state and
   * flipping a frame later.
   */
  if (identity.status === 'unknown') {
    return <Pending what="Checking whether this browser is signed in" />;
  }

  /**
   * No database in this deployment, so there is nowhere to put an agent.
   *
   * A distinct state rather than an error, and it offers no controls, for the
   * reason `SessionControl` gives: this application does not present a control
   * for something it cannot do. The rest of the site is unaffected — every
   * other screen keeps its state in the browser.
   */
  if (identity.status === 'unavailable') {
    return (
      <EmptyState title="This deployment cannot store agents">
        <p>
          An agent is a row in a database with an owner, and this build has no{' '}
          <span className="value">DATABASE_URL</span>. Every other screen here works without one —
          they keep what they know in this browser — but an agent that nobody owns is an agent
          nobody can revoke, so this screen refuses rather than deploying something it cannot
          record.
        </p>
      </EmptyState>
    );
  }

  if (identity.status === 'signed-out') {
    return (
      <EmptyState title="Sign in to deploy an agent">
        <p>
          Use the passkey control in the header. It is the only thing on this site that asks you to
          sign in, and it asks because an agent has an owner: the row that records this agent
          records who may pause and revoke it.
        </p>
        <p>
          Registering creates a passkey for this site on testnet. It is not the key that owns the
          smart account and it cannot move funds.
        </p>
        <p>
          <StatusLabel name={AGENT_BUILDER_PASSKEY_LABEL} />
        </p>
      </EmptyState>
    );
  }

  /**
   * Generate, then record, then review.
   *
   * The order matters in one direction only: the row is written *after* the
   * model answers, because the proposed name is what names it and a row named
   * "Untitled agent" for every abandoned attempt is a worse artefact than no
   * row. It is written before the review step rather than after, because a
   * person who closes the tab mid-review should find the agent waiting rather
   * than having to describe it again.
   *
   * A failure to record is fatal to the step and says so. Reviewing limits for
   * an agent that was never written would end at a deploy button that could not
   * work, which is the shape of dead control this application does not offer.
   */
  const generate = async () => {
    const written = description.trim();
    if (written.length === 0) return;

    setBusy(true);
    setRefusal(null);
    setDegraded(null);
    setNotes([]);

    try {
      const result = await generateDraft(written);
      const agent = await saveDraft({ agentId, name: result.draft.name, description: written });

      setAgentId(agent.id);
      // The stored name wins over the proposed one: `cleanAgentName` may have
      // replaced an empty proposal, and the form must show what was actually
      // written rather than what was asked for.
      setDraft({ ...result.draft, name: agent.name, description: written });
      setNotes(result.notes);
      setDegraded(result.degraded ?? null);
      setProblems([]);
      setStage('review');
    } catch (error) {
      setRefusal(
        error instanceof AgentApiError
          ? error.message
          : 'That did not go through. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onDraftChange = (next: AgentConfigDraft) => {
    setDraft(next);
    // Problems are cleared on edit rather than recomputed. Re-validating on
    // every keystroke means refusing a field a person is halfway through
    // typing, which trains them to ignore the messages.
    if (problems.length > 0) setProblems([]);

    /**
     * A derived boundary belongs to the fields it was derived from.
     *
     * Editing a limit while last derivation's install plan is still on screen
     * would put a cap on the chain-facing table that no longer matches the cap
     * in the input above it — the boundary and the numbers it came from
     * disagreeing, with nothing saying so. So the boundary goes away on the
     * first keystroke and has to be derived again.
     *
     * The stored `policies` row is untouched by this. It still holds the last
     * configuration that was actually accepted, which is the correct thing for
     * it to hold until another one is.
     */
    if (configured !== null) {
      setConfigured(null);
      setNotEnforceable(null);
      setStage('review');
    }
  };

  /**
   * Accept the reviewed limits: derive the boundary, and store it.
   *
   * `validate` runs here first so the ordinary case — a field still empty —
   * shows a message without a round trip. It is **not** the gate. The server
   * re-validates the same draft and derives everything from its own result, for
   * the reason B8.1 gives about checks that live only in a frontend: this
   * function is a convenience, and `/api/agents/[id]/configure` is the check.
   *
   * A local pass is therefore not permission to skip the request, and a local
   * failure is only a shortcut past one.
   */
  const accept = async () => {
    if (agentId === null) return;

    const local = validate(draft);
    if (!local.ok) {
      setProblems(local.problems);
      return;
    }

    setBusy(true);
    setProblems([]);
    setRefusal(null);
    setNotEnforceable(null);

    try {
      const result = await configureAgent(agentId, draft);
      setConfigured(result);
      setDraft((current) => ({ ...current, name: result.agent.name }));
      setStage('configured');
    } catch (error) {
      if (error instanceof ConfigRejected) {
        // The server disagreed with the form. Its answer wins and lands on the
        // fields, which is the only way a person can act on it.
        setProblems(error.problems);
      } else if (error instanceof NotEnforceableRefusal) {
        setNotEnforceable({ constraint: error.constraint, message: error.message });
      } else {
        setRefusal(
          error instanceof AgentApiError
            ? error.message
            : 'That did not go through. Check your connection and try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Deploy: the same four writes `/app/try` makes, in the same order, through
   * the same functions.
   *
   * Nothing about the write path is new here and nothing about it should be.
   * `deployAccount`, `fundSmartAccount` and `installBoundary` are
   * `lib/chain-actions.ts` unchanged — the module whose header says every write
   * this product makes lives there as functions rather than as screens, so that
   * two screens cannot hold two copies of the one claim this product makes.
   *
   * ## The plan is fetched, not held
   *
   * `beginDeployment` returns the boundary out of `policies.install_plan_json`.
   * The in-memory `configured.plan` is *not* used, even though it is right
   * there and would be identical. Installing the stored one means the rule that
   * reaches `add_context_rule` is the rule the review step wrote down, and
   * makes that true by construction rather than by the two happening to agree.
   *
   * ## The agent key is the server's, and this screen only knows its address
   *
   * `keys.agent` is **not** the agent here, and that is the difference between
   * this flow and `/app/try`. The local keys still do two jobs — the owner
   * signs the boundary into place and pays for the four writes below — but the
   * key the boundary is installed *around* is generated on a Limen server and
   * arrives as `started.agentPublicKey`, a `G…` and nothing more.
   *
   * So the friendbot call funds that address rather than `k.agent`, because the
   * account that will pay the agent's fees is the one that will submit its
   * transactions. Funding the local agent key here would fund an account
   * nothing in this flow ever uses again, and the agent would be unable to pay
   * for its first turn.
   *
   * ## What is not here
   *
   * `assertDistinctSigners` and `assertTestnet` are not called. They fire
   * inside `chain-actions.ts` and `submitAuthorized` already, and calling them
   * again here would read as the fence living on this screen — which would make
   * it deletable from this screen.
   */
  const deploy = async () => {
    if (agentId === null) return;

    setRefusal(null);

    let keys = signers();
    if (keys === null) {
      if (createLocalKeys() === undefined) {
        setRefusal(STORAGE_REFUSED);
        return;
      }
      keys = signers();
      if (keys === null) {
        setRefusal(STORAGE_REFUSED);
        return;
      }
    }
    const k = keys;

    let started;
    try {
      started = await beginDeployment(agentId);
    } catch (error) {
      setRefusal(
        error instanceof AgentApiError
          ? error.message
          : 'The deployment could not be started. Nothing was created.',
      );
      return;
    }

    /** Friendbot is `track`, not `run`: this application did not build it. */
    const friendbot = async (key: string, role: 'owner' | 'agent', publicKey: string) => {
      const what = `Friendbot funding the ${role}\u2019s classic account`;
      const outcome = await log.track(key, what, async (): Promise<WriteOutcome> => {
        const result = await fundFromFriendbot(publicKey);
        return result.ok
          ? {
              status: 'onLedger',
              what,
              // Friendbot does not always hand back a hash, and an
              // already-funded account never does.
              hash: result.hash ?? '',
              ok: true,
              codes: [],
              opResult: 'friendbot',
              ledgerStatus: 'SUCCESS',
            }
          : { status: 'failed', what, stage: 'submit', message: result.message, code: null };
      });
      return outcome?.status === 'onLedger' && outcome.ok;
    };

    const failed = async (message: string) => {
      setRefusal(message);
      // Best-effort, and deliberately not awaited for its result: a failure to
      // report a failure must not replace the message above with its own.
      await recordDeploymentFailed(agentId).catch(() => undefined);
    };

    if (!(await friendbot('fund:OWNER', 'owner', k.owner.publicKey))) {
      await failed('The owner\u2019s account could not be funded, so nothing was created.');
      return;
    }
    // The server-held agent, not `k.agent`. See this function's header.
    if (!(await friendbot('fund:AGENT', 'agent', started.agentPublicKey))) {
      await failed('The agent\u2019s account could not be funded, so nothing was created.');
      return;
    }

    let contractId: string | null = null;
    const deployed = await log.run(
      'deploy',
      'Creating the smart account \u2014 createCustomContract, with the owner key as its only signer',
      () =>
        deployAccount({
          keys: k,
          agentPublicKey: started.agentPublicKey,
          onDeployed: (created) => (contractId = created),
        }),
    );
    if (deployed?.status !== 'onLedger' || !deployed.ok || contractId === null) {
      await failed('The smart account was not created.');
      return;
    }
    const account: string = contractId;
    setSmartAccount(account);

    const seeded = await log.run(
      'seed',
      `Funding the smart account \u2014 ${describeAmount(SEED_AMOUNT)} from the owner\u2019s classic account`,
      () => fundSmartAccount({ keys: k, contractId: account }),
    );
    if (seeded?.status !== 'onLedger' || !seeded.ok) {
      await failed('The smart account was created but could not be funded, so no boundary was installed.');
      return;
    }

    let ruleId: number | null = null;
    const installed = await log.run(
      'install',
      `Installing the boundary \u2014 add_context_rule on ${account}`,
      () =>
        installBoundary({
          keys: k,
          accountId: account,
          plan: started.plan,
          agentPublicKey: started.agentPublicKey,
          onInstalled: (id) => (ruleId = id),
        }),
    );
    if (installed?.status !== 'onLedger' || !installed.ok || ruleId === null) {
      await failed('The boundary was not installed, so this agent can do nothing.');
      return;
    }

    try {
      const recorded = await recordDeployment(agentId, {
        smartAccountContractId: account,
        deployTxHash: deployed.hash,
        installTxHash: installed.hash,
        contextRuleId: ruleId,
        ownerPublicKey: k.owner.publicKey,
        agentPublicKey: started.agentPublicKey,
      });
      setVerified(recorded.verified);
      setStage('deployed');
    } catch (error) {
      // The chain did the work and Limen could not write it down, or the
      // ledger disagreed with what this browser reported. Both leave a real
      // account with a real rule on it, so the message says so rather than
      // implying nothing happened.
      setRefusal(
        `${
          error instanceof AgentApiError
            ? error.message
            : 'The deployment could not be recorded.'
        } The smart account ${account} exists and the boundary was installed \u2014 this is Limen\u2019s record of it that is missing.`,
      );
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <Stage
        n={1}
        title="Describe the agent"
        caption="One sentence about what it should be able to do. Name the asset and the amount if you know them — anything you leave out becomes a field you fill in on the next step."
        done={stage !== 'describe'}
      >
        <div className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="agent-description">
            What the agent should be able to do
          </label>
          <textarea
            id="agent-description"
            className="field"
            rows={3}
            maxLength={MAX_DESCRIPTION_LENGTH}
            placeholder={PLACEHOLDER}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <button
            type="button"
            className="btn self-start"
            data-variant={stage === 'describe' ? 'primary' : 'secondary'}
            disabled={busy || description.trim().length === 0}
            onClick={() => void generate()}
          >
            {busy
              ? 'Reading the description…'
              : stage === 'describe'
                ? 'Generate the limits'
                : 'Generate again'}
          </button>

          {refusal !== null && (
            <p role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
              {refusal}
            </p>
          )}

          <p className="measure text-[12.5px] leading-relaxed text-muted">
            A description is not a permission. Whatever it says, the agent ends up bounded by the
            fields on the next step and by nothing else.
          </p>
        </div>
      </Stage>

      {stage !== 'describe' && (
        <Stage
          n={2}
          title="Review the limits"
          caption="These are the fields that become the boundary. Correct anything that is wrong — this step is where a proposal becomes a permission, and it is the only place that happens."
          done={stage === 'configured'}
        >
          {degraded !== null && (
            <div className="panel" data-tone="unproven">
              <span className="col-head text-muted">nothing was generated</span>
              <p className="measure text-[13px] leading-relaxed text-muted">{degraded}</p>
              <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                This is a working path rather than a broken one. The limits below are what bind the
                agent, and they bind it the same whether a model proposed them or you typed them.
              </p>
            </div>
          )}

          {notes.length > 0 && (
            <div className="panel" data-tone="unproven">
              <span className="col-head text-muted">what Limen changed on the way in</span>
              <ul className="flex flex-col gap-1">
                {notes.map((note) => (
                  <li key={note.message} className="measure text-[12.5px] leading-relaxed text-muted">
                    {note.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <AgentConfigForm
            draft={draft}
            problems={problems}
            onChange={onDraftChange}
            disabled={busy}
          />

          {notEnforceable !== null && (
            <NotEnforceable
              constraint={notEnforceable.constraint}
              message={notEnforceable.message}
            />
          )}

          {refusal !== null && (
            <p role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
              {refusal}
            </p>
          )}

          <button
            type="button"
            className="btn self-start"
            data-variant="primary"
            disabled={busy}
            onClick={() => void accept()}
          >
            {busy ? 'Deriving the boundary…' : 'Accept these limits'}
          </button>
        </Stage>
      )}

      {stage === 'configured' && configured !== null && (
        <Stage
          n={3}
          title="The boundary"
          caption="Derived from the limits above by the same deterministic synthesizer that derives one from a transaction that already happened, and lowered onto primitives an OpenZeppelin smart account can hold. This is what deploying writes."
          done={false}
        >
          <div className="flex flex-col gap-8">
            <InstallPlanTable plan={configured.plan} />

            <OffChainSummary
              perTransactionCap={configured.config.enforcedOffChain.perTransactionCap}
              recipients={configured.config.enforcedOffChain.recipients}
              assetLabel={configured.config.display.assetLabel}
              assetDecimals={configured.config.display.assetDecimals}
            />

            <p className="measure text-[12.5px] leading-relaxed text-muted">
              Editing anything above derives this again. The boundary that gets installed is this
              one — Limen stores what you reviewed rather than re-deriving it at deploy time, so
              the rule written to the chain is the rule on this screen.
            </p>
          </div>
        </Stage>
      )}

      {(stage === 'configured' || stage === 'deployed') && (
        <Stage
          n={4}
          title="Deploy"
          caption="Creates the smart account, funds it, and installs the boundary above as a context rule. Four transactions on Stellar testnet, signed by keys generated in this browser."
          done={stage === 'deployed'}
        >
          <div className="flex flex-col gap-5">
            <div className="panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="col-head text-muted">the keys that sign</span>
                <StatusLabel name={AGENT_BUILDER_KEY_LABEL} weight="loud" />
              </div>
              <p className="measure text-[12.5px] leading-relaxed text-muted">
                Both are generated in this browser and stay in it. The owner key creates the
                account and installs the boundary; the agent key is what the boundary is installed{' '}
                <em>for</em>, and it never signs here.
              </p>
              <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                Because the agent&rsquo;s key lives in this browser, this agent can only act while
                this browser is open. An agent that acts on its own needs a key Limen holds, and
                Limen does not hold one yet.
              </p>
              {publics?.OWNER !== undefined && publics.AGENT !== undefined && (
                <div className="flex flex-wrap gap-3">
                  <LocalKeyBadge role="OWNER" publicKey={publics.OWNER} />
                  <LocalKeyBadge role="AGENT" publicKey={publics.AGENT} />
                </div>
              )}
            </div>

            <WriteResult state={log.stateOf('fund:OWNER')} />
            <WriteResult state={log.stateOf('fund:AGENT')} />
            <WriteResult state={log.stateOf('deploy')} />
            <WriteResult state={log.stateOf('seed')} />
            <WriteResult state={log.stateOf('install')} />

            {refusal !== null && stage === 'configured' && (
              <p role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
                {refusal}
              </p>
            )}

            {stage === 'configured' && (
              <button
                type="button"
                className="btn self-start"
                data-variant="primary"
                disabled={log.busy}
                onClick={() => void deploy()}
              >
                {log.busy ? 'Deploying…' : 'Deploy this agent'}
              </button>
            )}

            {stage === 'deployed' && verified !== null && smartAccount !== null && (
              <div className="panel" data-tone="permitted">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="eyebrow text-permit">deployed, and read back</span>
                  <StatusLabel name="ON-CHAIN" />
                </div>
                <p className="measure text-[12.5px] leading-relaxed text-muted">
                  Limen did not take this browser&rsquo;s word for it. Before recording the
                  deployment, the server re-read the account&rsquo;s context rules from the network
                  and checked the rule id, its contract, its cap and its expiry against the
                  boundary you reviewed. The numbers below are the ledger&rsquo;s, not this
                  page&rsquo;s.
                </p>
                <dl className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <dt className="col-head text-muted-dim">smart account</dt>
                    <dd className="text-[13px]">
                      <Address value={smartAccount} />
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="col-head text-muted-dim">context rule</dt>
                    <dd className="text-[13px]">
                      <span className="value">{verified.contextRuleId}</span>
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="col-head text-muted-dim">cap, as the policy contract holds it</dt>
                    <dd className="text-[13px]">
                      <span className="value">{verified.limit}</span>{' '}
                      <span className="text-muted-dim">
                        per {verified.periodLedgers.toLocaleString('en-US')} ledgers
                      </span>
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="col-head text-muted-dim">valid until ledger</dt>
                    <dd className="text-[13px]">
                      <span className="value">
                        {verified.validUntilLedger?.toLocaleString('en-US') ?? 'no expiry'}
                      </span>
                    </dd>
                  </div>
                </dl>
                <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                  The cap is in the asset&rsquo;s smallest unit, as the contract stores it. Nothing
                  about this rule is cached — reading this account again asks the network.
                </p>
              </div>
            )}
          </div>
        </Stage>
      )}
    </div>
  );
}

/**
 * One stage of the flow, with its number and its caption.
 *
 * `done` marks a stage that has been passed rather than hiding it: unlike
 * `/app/try`, every stage here stays on screen and stays editable, because
 * changing your mind about a limit before deploying is the normal case rather
 * than a recovery from a mistake.
 */
function Stage({
  n,
  title,
  caption,
  done,
  children,
}: {
  n: number;
  title: string;
  caption: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="col-head text-muted-dim">step {n}</span>
          {done && <span className="eyebrow text-permit">done</span>}
        </div>
        <h2 className="text-[17px] font-semibold tracking-[-0.012em] text-foreground">{title}</h2>
        <p className="measure text-[13px] leading-relaxed text-muted">{caption}</p>
      </div>
      {children}
    </section>
  );
}
