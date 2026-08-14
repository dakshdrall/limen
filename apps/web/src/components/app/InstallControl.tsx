'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Address } from '@/components/Address';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { WriteResult } from '@/components/app/WriteResult';
import { StatusLabel } from '@/components/StatusLabel';
import { LOCAL_KEY_LABEL } from '@/lib/status-labels';
import type { InstallPlan } from '@limen/chain/plan';
import { installBoundary } from '@/lib/chain-actions';
import { formatPolicyId } from '@/lib/policy-id';
import { rememberProvenance } from '@/lib/store';
import { useLocalKeyPublics, useSigners } from '@/lib/use-local-keys';
import { useWriteLog } from '@/lib/use-write';

/**
 * Writing the reviewed plan to the person's own account.
 *
 * This replaces the paragraph that used to stand here explaining why nothing
 * could be installed. That paragraph was accurate when it was written and is now
 * retired by this component existing — PLAN-V4 §9, which insists a caveat is
 * retired by the thing it described becoming possible, not by deleting the
 * sentence.
 *
 * One sentence from it survives verbatim, and deliberately: **there is no form
 * here that accepts a secret key, and there will not be one.** It was true when
 * nothing could sign and it is more load-bearing now that something can. The key
 * that signs this install was generated in the page, has never left it, and
 * cannot be exported or pasted in.
 *
 * ## What is submitted, and by whom
 *
 * `add_context_rule` on the smart account, authorized through `__check_auth`
 * under the owner's Default rule. One submission per rule in the plan, because
 * `add_context_rule` returns the rule it created and the id in that return value
 * is the only trustworthy source for what was installed — batching would save a
 * fee and lose the attribution every later screen depends on.
 *
 * The agent's key is what the rule is installed *for*. It never signs here, and
 * `assertDistinctSigners` runs inside `installFunctions` before a single host
 * function is built: a boundary whose bounded key is the key that installed it
 * is not a boundary.
 */
export function InstallControl({
  plan,
  accountId,
  observedTxHash,
  observedLedger,
  headroomBps,
}: {
  plan: InstallPlan;
  /** The account to install onto, from `?account=` or the accounts screen. */
  accountId: string | null;
  observedTxHash: string;
  observedLedger: number;
  headroomBps: number;
}) {
  const publics = useLocalKeyPublics();
  const signers = useSigners();
  const log = useWriteLog();
  const [installed, setInstalled] = useState<{ ruleId: number; hash: string } | null>(null);

  const owner = publics?.OWNER;
  const agent = publics?.AGENT;
  const rule = plan.rules[0];

  const install = async () => {
    const keys = signers();
    if (keys === null || accountId === null || rule === undefined) return;

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
      setInstalled({ ruleId, hash: outcome.hash });
      // Provenance is this application's history and exists nowhere on chain:
      // which transaction the boundary was derived from, and with what options.
      // The rule itself is always re-read from the ledger.
      rememberProvenance(accountId, {
        observedTxHash,
        observedLedger,
        headroomBps,
        windowLedgers: rule.policies[0]?.windowLedgers ?? 0,
        validityLedgers: rule.validUntilLedger ?? 0,
        installTxHash: outcome.hash,
        contextRuleId: ruleId,
        recordedAt: new Date().toISOString(),
      });
    }
  };

  if (publics === undefined) {
    return <p className="text-[13px] text-muted-dim">Reading what this browser holds…</p>;
  }

  if (owner === undefined || agent === undefined) {
    return (
      <div className="panel" data-tone="pending">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow text-muted-dim">no key in this browser</span>
          <StatusLabel name={LOCAL_KEY_LABEL} />
        </div>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          Installing writes a context rule to a smart account, and that write must be signed by an
          owner signer. This browser holds no keys, so the plan above can be reviewed and not
          submitted.
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          There is no form here that accepts a secret key, and there will not be one.{' '}
          <Link href="/app/accounts/new" className="link">
            Create an account
          </Link>{' '}
          to get a disposable owner key in this browser.
        </p>
      </div>
    );
  }

  if (accountId === null) {
    return (
      <div className="panel" data-tone="pending">
        <span className="eyebrow text-muted-dim">no account chosen</span>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          There is no account to install onto. Reach this screen from an account — its observed
          transaction carries both the account and the transaction the boundary is derived from.
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          <Link href="/app/accounts" className="link">
            Accounts
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="panel">
        <div className="flex flex-wrap items-center gap-3">
          <StatusLabel name="NOT AUDITED" weight="loud" />
          <StatusLabel name="COMPOSITION ONLY" />
        </div>

        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          The plan above is written to <Address value={accountId} tone="dim" /> as a context rule,
          signed in this browser by the owner key. The agent key below is what the boundary is
          installed <em>for</em> — it does not sign this.
        </p>

        {/* `border-border-subtle`. This divider asked for `border-border-faint`,
            which is not a token the palette defines — see `AccountWriteSteps`
            for the full account. It emitted nothing, so the rule separating the
            two keys had never been drawn on the one screen where telling them
            apart is the entire point. */}
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <div className="flex flex-col gap-1">
            <span className="col-head text-muted-dim">signs this install</span>
            <LocalKeyBadge role="OWNER" publicKey={owner} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="col-head text-muted-dim">bounded by it</span>
            <LocalKeyBadge role="AGENT" publicKey={agent} />
          </div>
        </div>

        <p className="measure text-[12.5px] leading-relaxed text-muted">
          There is no form here that accepts a secret key, and there will not be one. A boundary
          installed here can be taken back — the same key that installs it can revoke it, on the
          policy&rsquo;s own screen.
        </p>

        <button
          type="button"
          disabled={log.busy || installed !== null}
          onClick={() => void install()}
          className="btn"
          data-variant="primary"
        >
          {installed === null ? 'Install this boundary' : 'Installed'}
        </button>
      </div>

      <WriteResult state={log.stateOf('install')} />

      {installed !== null && (
        <div className="panel" data-tone="permitted">
          <span className="eyebrow text-permit">installed</span>
          <p className="measure text-[13px] leading-relaxed text-foreground/90">
            Context rule <span className="value">{installed.ruleId}</span>{' '}
            is on the account. The id was read out of what{' '}
            <span className="value">add_context_rule</span>{' '}
            returned, not assumed.
          </p>
          <Link
            href={`/app/policies/${formatPolicyId({ contractId: accountId, ruleId: installed.ruleId })}`}
            className="btn self-start"
            data-variant="primary"
          >
            Open the boundary
          </Link>
        </div>
      )}
    </div>
  );
}
