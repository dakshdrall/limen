/**
 * Whether this deployment may serve developer probes.
 *
 * A probe is a screen whose entire job is to report what some third party
 * actually does — it exists to answer a question, not to be part of the
 * product. `/app/dev/freighter` is the first: it asks Freighter to sign a
 * message and reports, byte for byte, what came back.
 *
 * ## It fails closed, and that direction is the whole point
 *
 * The predicate below returns *"is this production"*, and probes are enabled
 * only when the answer is a definite no. An environment this cannot classify is
 * treated as production and gets no probe — the alternative, defaulting to
 * enabled, means a misconfigured deployment quietly exposes a page that prompts
 * a visitor's wallet for a signature.
 *
 * ## Why the predicate is written here for a third time
 *
 * `webauthn-config.ts` and `packages/kv/src/resolve.ts` each carry their own
 * copy, and both give the reason it cannot be `NODE_ENV` alone: Vercel sets
 * `NODE_ENV=production` on previews too, so that variable cannot answer this
 * question. This is a third copy rather than a shared export, deliberately and
 * on the same terms `apps/runtime/src/auth.ts` states for duplicating
 * `hashToken`: the duplicated thing is four lines with no dependencies, and if
 * the copies ever diverged this one fails by *hiding* a probe, which is the
 * safe direction. A shared helper would be the better shape if this grew; at
 * four lines it would be an import for its own sake.
 */

import 'server-only';

export function isProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  const vercel = env.VERCEL_ENV;
  if (vercel !== undefined && vercel.length > 0) return vercel === 'production';
  return env.NODE_ENV === 'production';
}

/** Probes are a development affordance. Production has none. */
export function probesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isProductionDeployment(env);
}
