/**
 * `PolicyProposal` -> `InstallPlan`, or a named refusal.
 *
 * The step between "here is the boundary Limen derived" and "here is what would
 * be written to the chain". They are not the same thing, and the gap between
 * them is where this project's central claim lives: `@limen/core` can express
 * constraints that no audited OpenZeppelin primitive imposes, and `lower`
 * refuses those rather than installing something broader.
 *
 * No network IO, no signing, no keys. This route exists purely to keep the
 * Stellar SDK — which `@limen/chain`'s index pulls in — out of the browser
 * bundle. `lower` itself is pure and is unit-tested without a network.
 */

import { NotEnforceableError, lower } from '@limen/chain';
import type { PolicyProposal } from '@limen/core';
import type { LowerFailure, LowerRefusal, LowerSuccess } from '@/lib/lower-contract';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  let proposal: PolicyProposal;
  try {
    const body = (await request.json()) as { proposal?: PolicyProposal };
    if (body.proposal === undefined) throw new Error('missing proposal');
    proposal = body.proposal;
  } catch (error) {
    const failure: LowerFailure = {
      error: {
        message: `request body must be {"proposal": PolicyProposal}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
    return Response.json(failure, { status: 400 });
  }

  try {
    const plan = lower(proposal);
    return Response.json({ plan } satisfies LowerSuccess);
  } catch (error) {
    if (error instanceof NotEnforceableError) {
      // 422, not 500. The request was well-formed and Limen understood it
      // completely; it declined. Reporting a refusal as a server error would
      // make the composition-only rule look like a bug.
      const refusal: LowerRefusal = {
        refusal: { code: error.code, constraint: error.constraint, message: error.message },
      };
      return Response.json(refusal, { status: 422 });
    }
    const failure: LowerFailure = {
      error: { message: error instanceof Error ? error.message : String(error) },
    };
    return Response.json(failure, { status: 500 });
  }
}
