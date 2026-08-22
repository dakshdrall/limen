/**
 * Begin deploying: hand back the stored boundary, and mark the agent
 * `DEPLOYING`.
 *
 * The browser does the deploying — `lib/chain-actions.ts` is where every write
 * this product makes already lives, and this flow reuses it unchanged. What
 * this route exists for is the half a browser must not decide: **which
 * boundary**.
 *
 * The plan comes out of `policies.install_plan_json`, written when the person
 * accepted the review. The client does not send a plan and cannot influence
 * one; it asks for the plan belonging to the agent it is deploying and installs
 * that. So the rule that reaches `add_context_rule` is the rule that was on the
 * review screen, and a browser that had been tampered with between review and
 * deploy would be installing the reviewed boundary anyway.
 *
 * ## The agent key is generated here, on the server, and the browser never sees it
 *
 * PLAN-V8 §3, and the half of this flow that changed at M2. The **owner** key
 * is still the browser's and never reaches a Limen server — that is what
 * `NO OWNER CUSTODY` says and it stays true. The **agent** key cannot be the
 * browser's, because the whole point of an agent is that it acts while no
 * browser is open: a key in `localStorage` cannot answer a Telegram message.
 *
 * So it is generated here, sealed into `agent_keys`, and only the `G…` address
 * goes back to the client — which then installs the boundary naming that
 * address as the agent signer. The browser is told what the agent's key *is*
 * and never holds it, which is the exact inverse of the owner key.
 *
 * The ordering matters and is not incidental: the key must exist before the
 * install, because the context rule being installed names it. A key generated
 * after the boundary would be a key the boundary does not bound.
 *
 * ## `DEPLOYING` is set before anything is signed, not after
 *
 * If the browser closes mid-flight, the agent is left saying `DEPLOYING`, which
 * is true and is the useful thing for it to say: a smart account may or may not
 * exist, and Limen genuinely does not know which. Setting the status only on
 * success would leave that same agent reading `CONFIGURED` — indistinguishable
 * from one that never tried, and offering a deploy button that might be about
 * to create a second account.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { AgentNotFound, drizzleAgentStore } from '@/lib/stores';

export const runtime = 'nodejs';

const limit = createRateLimit({ max: 20, windowMs: 10 * 60 * 1000, namespace: 'agents-deploy' });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { id } = await params;
  const store = drizzleAgentStore();

  try {
    const agent = await store.findForUser(id, gate.user.id);
    if (agent === undefined) return Response.json({ error: 'not_found' }, { status: 404 });

    // Only a configured agent can be deployed, and an already-active one is
    // refused rather than redeployed. Deploying twice would create a second
    // smart account and leave the first one funded and forgotten.
    if (agent.status !== 'CONFIGURED' && agent.status !== 'ERROR') {
      return Response.json(
        {
          error: 'wrong_status',
          message:
            agent.status === 'ACTIVE'
              ? 'This agent is already deployed. Deploying again would create a second smart account and leave the first one funded and forgotten.'
              : `This agent is ${agent.status}, and only a configured agent can be deployed.`,
        },
        { status: 409 },
      );
    }

    const policy = await store.proposedPolicy(id, gate.user.id);
    if (policy === undefined) {
      return Response.json(
        {
          error: 'not_configured',
          message: 'This agent has no reviewed boundary to install. Accept the limits first.',
        },
        { status: 409 },
      );
    }

    // Before `DEPLOYING`, and before the browser is handed anything to sign.
    // A failure here leaves the agent in the status it already had, which is a
    // state the deploy button is offered from — rather than leaving it
    // `DEPLOYING` with no key, which is a state nothing can move it out of.
    let agentKey;
    try {
      agentKey = await store.provisionAgentKey({ agentId: id, userId: gate.user.id });
    } catch (error) {
      // The master key being absent or wrong is an operational failure of this
      // deployment, not a fault in the request, and it must not read as one.
      // `resolveKeyProvider` and the provider's own fence both throw with a
      // message written for whoever runs this — so it is logged in full and
      // summarised to the caller without echoing configuration detail back.
      console.error('limen agents: could not provision an agent key', error);
      return Response.json(
        {
          error: 'custody_unavailable',
          message:
            'This deployment cannot hold an agent key right now, so nothing was deployed. The agent is unchanged and the deploy can be retried.',
        },
        { status: 503 },
      );
    }

    const marked = await store.markStatus({
      agentId: id,
      userId: gate.user.id,
      status: 'DEPLOYING',
    });

    return Response.json(
      {
        agent: marked,
        policyId: policy.id,
        plan: policy.installPlan,
        // The address the browser must install the boundary against. Not a
        // suggestion: `/deployed` re-checks that what was installed names this
        // key, so a client that substituted its own would be refused there.
        agentPublicKey: agentKey.agentPublicKey,
        // True only on the first deploy of this agent. A retry reuses the key
        // the already-installed boundary may name; see `provisionAgentKey`.
        agentKeyGenerated: agentKey.generated,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof AgentNotFound) return Response.json({ error: 'not_found' }, { status: 404 });
    console.error('limen agents: could not begin a deployment', error);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}
