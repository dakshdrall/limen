'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AgentConfigForm } from '@/components/app/AgentConfigForm';
import { NotEnforceable } from '@/components/NotEnforceable';
import { validate, type AgentConfigDraft, type FieldProblem } from '@/lib/agent-config';
import {
  AgentApiError,
  ConfigRejected,
  NotEnforceableRefusal,
  configureAgent,
} from '@/lib/agent-api';

/**
 * Step two: a proposal becomes a permission, or does not.
 *
 * This is the step the other two exist to protect. A model read a sentence and
 * suggested numbers; nothing has been installed and nothing is bound. What
 * happens here is that a person reads the numbers and either corrects them or
 * accepts them, and only what they accept is derived into a boundary.
 *
 * ## The model is untrusted, and that is structural rather than stated
 *
 * The proposal arrives as `initialDraft`, revived from `agents.draft_json`, and
 * it is loaded into exactly the same state a person types into. There is no
 * privileged channel: by the time `accept` runs, a field a model filled and a
 * field a person typed are indistinguishable, and both go through `validate`
 * and then through the server's own validation.
 *
 * That is the cheap half of the guarantee. The expensive half is on the chain —
 * whatever this screen gets wrong, the installed context rule is what bounds the
 * agent, and it bounds it whether this screen was right or not.
 *
 * ## `validate` here is a convenience and not the gate
 *
 * It runs first so the ordinary case — a field still empty — shows a message
 * without a round trip. The server re-validates the same draft and derives
 * everything from its own result, for the reason B8.1 gives about checks that
 * live only in a frontend. A local pass is not permission to skip the request;
 * a local failure is only a shortcut past one.
 */
export function ReviewStep({
  agentId,
  initialDraft,
  hadProposal,
}: {
  agentId: string;
  initialDraft: AgentConfigDraft;
  /**
   * Whether a stored proposal was found.
   *
   * False for an agent described before proposals were kept, and for one whose
   * generation returned nothing. The screen says so rather than presenting a
   * set of empty fields as though a model had chosen them — the fields still
   * bind exactly the same way, which is the point worth making.
   */
  hadProposal: boolean;
}) {
  const router = useRouter();

  const [draft, setDraft] = useState<AgentConfigDraft>(initialDraft);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notEnforceable, setNotEnforceable] = useState<{
    constraint: string;
    message: string;
  } | null>(null);

  const onChange = (next: AgentConfigDraft) => {
    setDraft(next);
    // Cleared on edit rather than recomputed. Re-validating on every keystroke
    // means refusing a field somebody is halfway through typing, which trains
    // them to ignore the messages.
    if (problems.length > 0) setProblems([]);
    if (notEnforceable !== null) setNotEnforceable(null);
  };

  const accept = async () => {
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
      await configureAgent(agentId, draft);
      router.push(`/app/agents/${agentId}/deploy`);
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
      setBusy(false);
    }
    // No `setBusy(false)` on success: the navigation is in flight, and a
    // re-enabled button would offer to derive the boundary a second time.
  };

  return (
    <div className="flex flex-col gap-6">
      {!hadProposal && (
        <div className="panel" data-tone="unproven">
          <span className="col-head text-muted">nothing was drafted for this agent</span>
          <p className="measure text-[13px] leading-relaxed text-muted">
            No proposal is stored against this agent — either it was described before Limen kept
            them, or the model returned nothing.
          </p>
          <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
            This is a working path rather than a broken one. The limits below are what bind the
            agent, and they bind it the same whether a model proposed them or you typed them.
          </p>
        </div>
      )}

      <AgentConfigForm draft={draft} problems={problems} onChange={onChange} disabled={busy} />

      {notEnforceable !== null && (
        <NotEnforceable constraint={notEnforceable.constraint} message={notEnforceable.message} />
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
    </div>
  );
}
