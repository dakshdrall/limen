/**
 * The wire contract for `/api/lower`.
 *
 * `lower` itself is pure and has no SDK dependency, but it is exported from
 * `@limen/chain`'s index alongside `read.ts` and `authpayload.ts`, which do. A
 * client component importing it would pull the Stellar SDK into the browser
 * bundle, or depend on the bundler tree-shaking it out — and "it happens to be
 * tree-shaken today" is the same property `markers.ts` already refuses to rest
 * on. So the lowering runs on the server, and this is what crosses.
 */

import type { InstallPlan, NotEnforceableCode } from '@limen/chain';

export type { InstallPlan };

/**
 * A refusal to lower is not an error in the transport sense. It is the
 * composition-only rule working: the proposal describes a boundary that no
 * audited primitive can impose, so Limen declines to install something broader
 * than what the user reviewed. The screen renders it as a result, with the
 * constraint named.
 */
export interface LowerRefusal {
  refusal: {
    code: NotEnforceableCode;
    /** The specific constraint that could not be lowered. */
    constraint: string;
    message: string;
  };
}

export interface LowerSuccess {
  plan: InstallPlan;
}

/** A transport or input failure, which is a different screen from a refusal. */
export interface LowerFailure {
  error: { message: string };
}
