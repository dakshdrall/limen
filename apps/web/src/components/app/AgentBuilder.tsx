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
import { AgentApiError, generateDraft, saveDraft } from '@/lib/agent-api';
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

/** Where the flow has got to. Not a step number — a state with a name. */
type Stage = 'describe' | 'review';

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
  };

  const check = () => {
    const result = validate(draft);
    setProblems(result.ok ? [] : result.problems);
    return result;
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

      {stage === 'review' && (
        <Stage
          n={2}
          title="Review the limits"
          caption="These are the fields that become the boundary. Correct anything that is wrong — this step is where a proposal becomes a permission, and it is the only place that happens."
          done={false}
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

          <button
            type="button"
            className="btn self-start"
            data-variant="secondary"
            disabled={busy}
            onClick={check}
          >
            Check these limits
          </button>
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
