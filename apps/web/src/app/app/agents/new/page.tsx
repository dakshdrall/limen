import { AgentBuilder } from '@/components/app/AgentBuilder';
import { ScreenHeader } from '@/components/app/ScreenHeader';

export const metadata = {
  title: 'Limen — deploy an agent',
  description:
    'Describe an agent in a sentence, review the limits it would be given, and deploy it onto Stellar testnet under a boundary the network enforces.',
};

/**
 * Describe an agent, review what it would be allowed to do, deploy it.
 *
 * The other screens in this application are the permission layer with its
 * hands showing: observe a transaction, derive a boundary, install it, watch
 * the chain refuse. This one is the product on top of that — a person says
 * what they want an agent to do, and the boundary is derived underneath
 * without them ever authoring a policy.
 *
 * **Nothing about the permission layer changes here.** The sentence goes to a
 * model, the model proposes fields, a person corrects them, and the corrected
 * fields compile into exactly the `ObservedTransaction` → `synthesize` →
 * `lower` → `add_context_rule` path `/app/try` already walks. What the model
 * writes is a proposal on a form. What the chain enforces is what was
 * installed, and the two are separated by a person reading the second one.
 *
 * ## Why this screen is behind a sign-in and the others are not
 *
 * Every other screen here keeps its state in the browser and asks nothing of
 * anybody. An agent is different: it is a row in Postgres with an owner, and
 * `agents.user_id` is `NOT NULL` because an agent nobody owns is an agent
 * nobody can revoke. The passkey sign-in in the header is what supplies it.
 *
 * ## The labels, and the one that is deliberately absent
 *
 * `NO OWNER CUSTODY` is true on this screen and is not rendered on it, for the
 * reason `/app/accounts/new` gives about what a second label does to the loud
 * one beside it. `LIMEN HOLDS THE AGENT KEY` is absent because it is **not
 * true yet**: the agent key this flow creates is generated in this browser and
 * stays in it, exactly as `/app/try` does it. Server-held agent keys are the
 * runtime's work, and the label goes up in the commit that makes it true.
 */
export default function NewAgentPage() {
  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="interface"
        title="Deploy an agent"
        lede={
          <>
            <p>
              Describe what the agent should be able to do. Limen turns that into a set of limits,
              you correct anything it got wrong, and deploying installs those limits on a smart
              account as a context rule the network enforces.
            </p>
            <p>
              The description is read by a model and the model can be wrong. Nothing it proposes
              reaches the chain until you have read it on the review step — that step is the
              boundary between a suggestion and a permission.
            </p>
          </>
        }
        labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY', 'IN DEVELOPMENT']}
      />

      <AgentBuilder />
    </main>
  );
}
