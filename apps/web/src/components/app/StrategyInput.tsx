'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, Pending } from '@/components/app/ScreenState';
import { MAX_DESCRIPTION_LENGTH } from '@/lib/agent-config';
import { useIdentity } from '@/lib/use-identity';
import { PASSKEY_LABEL, WALLET_DISCLOSURE } from '@limen/shared/status-labels';
import { StatusLabel } from '@/components/StatusLabel';
import { AgentApiError, generateDraft, saveDraft } from '@/lib/agent-api';

/**
 * Step one: the strategy, and almost nothing else.
 *
 * This screen used to open with two paragraphs and four badges above a
 * three-row textarea, and the thing a person came to do was below the fold of
 * their attention. The explanation was not wrong — it was in the wrong place.
 * It now lives on the review screen, which is the screen it is actually about:
 * *a description is not a permission, the fields on the next step are* is a
 * sentence about the next step, and it reads as a caveat here and as an
 * instruction there.
 *
 * So what is left is the input, at the size of the thing being asked for. A
 * strategy is a sentence or three, not a tweet, and a box that looks like a
 * search field asks for a search query.
 *
 * ## Why this is a client component and the page is not
 *
 * The page is a server component: it renders the shell, the header and the
 * labels, and it is what `design-system.test.ts` sees as a page. This is only
 * the part that needs state — the text, and the request. Keeping the split
 * there means the screen's chrome is server-rendered and the interactive piece
 * is as small as it can be.
 *
 * ## The navigation is the step
 *
 * On submit this writes a `DRAFT` row and pushes to that agent's review route.
 * It does not reveal a second section below itself, and the difference is not
 * cosmetic: a URL means the back button works, a reload lands somewhere, and
 * the proposal is attached to an agent that exists rather than to a tab that is
 * open. `agents.draft_json` is what carries the proposal across, which is why
 * it is stored rather than held.
 */

/** The label this screen names, per `test/local-key-label.test.ts`. */
export const STRATEGY_INPUT_PASSKEY_LABEL = PASSKEY_LABEL;

/**
 * A strategy, not a payment.
 *
 * The old example — *"an agent that can pay approved suppliers up to 50 USDC"*
 * — described the product this was before it was a trading tool, and a
 * placeholder is the strongest instruction on a form: it is the shape of answer
 * a person copies. This one names a trigger, an asset and a ceiling, because
 * those are the three things the review step is going to ask for.
 */
const PLACEHOLDER = 'buy XLM whenever the price drops 5%, spend at most 20 USDC a day';

export function StrategyInput() {
  const identity = useIdentity();
  const router = useRouter();

  const [strategy, setStrategy] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (identity.status === 'unknown') {
    return <Pending what="Checking whether this browser is signed in" />;
  }

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
      <EmptyState title="Connect a wallet to build an agent">
        <p>
          Use <span className="value">Connect wallet</span>{' '}
          at the top right. An agent has an owner: the row that records this agent records who may
          pause and revoke it.
        </p>
        <p>{WALLET_DISCLOSURE}</p>
        <p>
          Signing in with a passkey works too, and is the same session either way.
        </p>
        <p>
          <StatusLabel name={STRATEGY_INPUT_PASSKEY_LABEL} />
        </p>
      </EmptyState>
    );
  }

  /**
   * Read the strategy, write the row, go to the review.
   *
   * The row is written *after* the model answers, because the proposed name is
   * what names it and a row called "Untitled agent" for every abandoned attempt
   * is a worse artefact than no row. It is written *before* the navigation,
   * because the review screen loads the agent by id and there has to be one.
   *
   * A failure to record is fatal to the step and says so. Navigating to a
   * review for an agent that was never written would end at a deploy button
   * that could not work, which is the shape of dead control this application
   * does not offer.
   */
  const submit = async () => {
    const written = strategy.trim();
    if (written.length === 0) return;

    setBusy(true);
    setRefusal(null);

    try {
      const result = await generateDraft(written);
      const agent = await saveDraft({
        agentId: null,
        name: result.draft.name,
        description: written,
        // Carried into `agents.draft_json`, which is how it survives this
        // navigation. Untrusted there and re-validated before it can bind
        // anything — see the column's comment in the schema.
        draft: { ...result.draft, description: written },
      });
      router.push(`/app/agents/${agent.id}/review`);
    } catch (error) {
      setRefusal(
        error instanceof AgentApiError
          ? error.message
          : 'That did not go through. Check your connection and try again.',
      );
      setBusy(false);
    }
    // No `setBusy(false)` on the happy path: the navigation is in flight and
    // re-enabling the button would offer a second submission that would create
    // a second agent for one strategy.
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="col-head text-muted-dim" htmlFor="agent-strategy">
        the strategy
      </label>

      <textarea
        id="agent-strategy"
        className="field font-mono text-[14px] leading-relaxed"
        rows={7}
        maxLength={MAX_DESCRIPTION_LENGTH}
        placeholder={PLACEHOLDER}
        value={strategy}
        onChange={(event) => setStrategy(event.target.value)}
        autoFocus
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn"
          data-variant="primary"
          disabled={busy || strategy.trim().length === 0}
          onClick={() => void submit()}
        >
          {busy ? 'Reading the strategy…' : 'Draft the limits'}
        </button>

        <span className="font-mono text-[11px] tracking-[0.08em] text-faint">
          {strategy.length}/{MAX_DESCRIPTION_LENGTH}
        </span>
      </div>

      {refusal !== null && (
        <p role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
          {refusal}
        </p>
      )}
    </div>
  );
}
