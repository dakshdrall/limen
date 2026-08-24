'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Address } from '@/components/Address';
import { InstallPlanTable } from '@/components/app/InstallPlanTable';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { WriteResult } from '@/components/app/WriteResult';
import { StatusLabel } from '@/components/StatusLabel';
import {
  AgentApiError,
  beginDeployment,
  recordDeployment,
  recordDeploymentFailed,
  type VerifiedDeployment,
} from '@/lib/agent-api';
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
import type { InstallPlan } from '@/lib/lower-contract';

/**
 * Step three: four transactions, and then it exists.
 *
 * Lifted out of the old single-screen builder unchanged in every respect that
 * touches a chain. `deployAccount`, `fundSmartAccount` and `installBoundary` are
 * `lib/chain-actions.ts` exactly as they were — that module's header says every
 * write this product makes lives there as functions rather than as screens, so
 * that two screens cannot hold two copies of the one claim this product makes.
 * Splitting the builder into three routes moved where this is rendered and
 * changed nothing about what it does.
 *
 * ## The plan is fetched, not passed
 *
 * `beginDeployment` returns the boundary out of `policies.install_plan_json`.
 * The plan this component is handed as a prop is for **display only** and is
 * deliberately not the one installed. Installing the stored one means the rule
 * that reaches `add_context_rule` is the rule the review step wrote down, and
 * makes that true by construction rather than by the two happening to agree.
 *
 * ## The agent key is the server's, and this screen only knows its address
 *
 * `keys.agent` is not the agent. The local keys still do two jobs — the owner
 * signs the boundary into place and pays for the writes — but the key the
 * boundary is installed *around* is generated on a Limen server and arrives as
 * `started.agentPublicKey`, a `G…` and nothing more. Friendbot funds that
 * address rather than the local agent key, because the account that will pay
 * the agent's fees is the one that will submit its transactions.
 *
 * ## Why it does not navigate away when it finishes
 *
 * The success panel holds the deploy and install hashes, read back off the
 * ledger, and they are shown exactly once. Redirecting to the detail page
 * automatically would discard the evidence somebody just paid five fees to
 * produce, at the moment they are most likely to want to copy it. So the flow
 * ends here and offers the next step as a link.
 */

/** Required of every file importing the local-key modules. */
export const DEPLOY_STEP_KEY_LABEL = LOCAL_KEY_LABEL;

export function DeployStep({ agentId, plan }: { agentId: string; plan: InstallPlan }) {
  const log = useWriteLog();
  const signers = useSigners();
  const publics = useLocalKeyPublics();

  const [refusal, setRefusal] = useState<string | null>(null);
  const [verified, setVerified] = useState<VerifiedDeployment | null>(null);
  const [smartAccount, setSmartAccount] = useState<string | null>(null);

  const deploy = async () => {
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
      const what = `Friendbot funding the ${role}’s classic account`;
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
      await failed('The owner’s account could not be funded, so nothing was created.');
      return;
    }
    if (!(await friendbot('fund:AGENT', 'agent', started.agentPublicKey))) {
      await failed('The agent’s account could not be funded, so nothing was created.');
      return;
    }

    let contractId: string | null = null;
    const deployed = await log.run(
      'deploy',
      'Creating the smart account — createCustomContract, with the owner key as its only signer',
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
      `Funding the smart account — ${describeAmount(SEED_AMOUNT)} from the owner’s classic account`,
      () => fundSmartAccount({ keys: k, contractId: account }),
    );
    if (seeded?.status !== 'onLedger' || !seeded.ok) {
      await failed(
        'The smart account was created but could not be funded, so no boundary was installed.',
      );
      return;
    }

    // Two ids for a trading agent, one for a payment agent. Told apart by the
    // contract each rule was installed for rather than by the order they came
    // back in — the plan sorts its rules by contract address, so position is
    // not a fact about which is which.
    let ruleId: number | null = null;
    let venueRuleId: number | null = null;
    const tokenContract = started.plan.rules.find((rule) =>
      rule.policies.some((policy) => policy.kind === 'spending_limit'),
    )?.contract;

    const installed = await log.run(
      'install',
      `Installing the boundary — add_context_rule on ${account}`,
      () =>
        installBoundary({
          keys: k,
          accountId: account,
          plan: started.plan,
          agentPublicKey: started.agentPublicKey,
          onInstalled: (id, contract) => {
            // The rule carrying the spending limit is the boundary; anything
            // else in the plan is a venue. Matching on the contract means a
            // plan that grows a third rule fails loudly here rather than
            // silently recording the wrong id as the boundary.
            if (contract === tokenContract) ruleId = id;
            else venueRuleId = id;
          },
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
        venueContextRuleId: venueRuleId,
        ownerPublicKey: k.owner.publicKey,
        agentPublicKey: started.agentPublicKey,
      });
      setVerified(recorded.verified);
    } catch (error) {
      // The chain did the work and Limen could not write it down, or the ledger
      // disagreed with what this browser reported. Both leave a real account
      // with a real rule on it, so the message says so rather than implying
      // nothing happened.
      setRefusal(
        `${
          error instanceof AgentApiError ? error.message : 'The deployment could not be recorded.'
        } The smart account ${account} exists and the boundary was installed — this is Limen’s record of it that is missing.`,
      );
    }
  };

  const done = verified !== null && smartAccount !== null;

  return (
    <div className="flex flex-col gap-6">
      <InstallPlanTable plan={plan} />

      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="col-head text-muted">the keys that sign</span>
          <StatusLabel name={DEPLOY_STEP_KEY_LABEL} weight="loud" />
        </div>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          Both are generated in this browser and stay in it. The owner key creates the account and
          installs the boundary; the agent key is what the boundary is installed <em>for</em>, and
          it never signs here.
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
          Because the agent&rsquo;s key lives in this browser, this agent can only act while this
          browser is open. An agent that acts on its own needs a key Limen holds, and Limen does not
          hold one yet.
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

      {refusal !== null && (
        <p role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
          {refusal}
        </p>
      )}

      {!done && (
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

      {done && (
        <div className="panel" data-tone="permitted">
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow text-permit">deployed, and read back</span>
            <StatusLabel name="ON-CHAIN" />
          </div>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            Limen did not take this browser&rsquo;s word for it. Before recording the deployment,
            the server re-read the account&rsquo;s context rules from the network and checked the
            rule id, its contract, its cap and its expiry against the boundary you reviewed. The
            numbers below are the ledger&rsquo;s, not this page&rsquo;s.
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
            The cap is in the asset&rsquo;s smallest unit, as the contract stores it. Nothing about
            this rule is cached — reading this account again asks the network.
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <Link href={`/app/agents/${agentId}`} className="link">
              This agent
            </Link>
            <Link href={`/app/agents/${agentId}/chat`} className="link">
              Talk to this agent
            </Link>
            <Link href="/app/agents" className="link">
              All your agents
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
