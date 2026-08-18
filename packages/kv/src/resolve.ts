/**
 * Which store this process gets, and the refusal that actually retires the
 * `TODO(roadmap)`.
 *
 * The two modules this package replaces were process-local *by default, when
 * nothing was configured*. Reproducing that would move the problem rather than
 * solve it: a deployment with no Redis credentials would silently get the old
 * behaviour, the `TODO` would be gone from the source, and the limit would
 * still be per-instance. A comment that has been deleted is not a problem that
 * has been fixed.
 *
 * So the fallback is explicit and fenced, in the same shape as
 * `EnvMasterKeyProvider`'s mainnet refusal:
 *
 *   - configured → the shared store, HTTP or TCP by runtime shape;
 *   - not configured, not the production deployment → `MemoryKeyValue`, which
 *     reports `shared: false` so nothing can mistake it for the real thing, and
 *     says so on stderr so it cannot be mistaken quietly;
 *   - **not configured, production deployment → throw.**
 *
 * That last line is the whole of the retirement. "Shared state" becomes a
 * property of the deployment rather than an aspiration, because the production
 * deployment without it cannot serve.
 *
 * ## "Production deployment" is not `NODE_ENV`, and the difference matters here
 *
 * Vercel sets `NODE_ENV=production` for **preview** builds as well as
 * production ones — they are production *builds*, which is not the same claim.
 * Keying the refusal off `NODE_ENV` would mean every preview deployment
 * refused to serve until Upstash credentials existed, and previews are where
 * most of this project's testing happens.
 *
 * So the predicate is the deployment, not the build: `VERCEL_ENV === 'production'`
 * where the platform says, falling back to `NODE_ENV` where it does not (a
 * self-hosted container, which has no preview concept and for which
 * `NODE_ENV=production` does mean production).
 *
 * A preview without Redis therefore runs per-instance counters — which is
 * acceptable, because a preview is not serving real traffic and the alternative
 * is a preview that cannot be used at all — and logs that it is doing so. The
 * strictness is where the traffic is.
 */

import { MemoryKeyValue } from './memory.js';
import type { KeyValue } from './kv.js';
import { UpstashKeyValue } from './web.js';

export const UPSTASH_URL_ENV = 'UPSTASH_REDIS_REST_URL';
export const UPSTASH_TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';

/**
 * The web app's store.
 *
 * The runtime resolves its own — see `apps/runtime` — because it needs the TCP
 * client and a different variable, and because a single resolver returning
 * either would be the shared export §7.5.2's two-path split exists to avoid.
 */
export function resolveWebKeyValue(env: NodeJS.ProcessEnv = process.env): KeyValue {
  const url = env[UPSTASH_URL_ENV] ?? '';
  const token = env[UPSTASH_TOKEN_ENV] ?? '';

  if (url.length > 0 && token.length > 0) return new UpstashKeyValue({ url, token });

  if (isProductionDeployment(env)) {
    throw new Error(
      `${UPSTASH_URL_ENV} and ${UPSTASH_TOKEN_ENV} are not set, and this is the production deployment. ` +
        'Refusing to fall back to a process-local store: on a platform that runs many instances, per-process ' +
        'counters enforce a rate limit per instance rather than in total, which loosens exactly as fast as ' +
        'traffic arrives. That was the behaviour PLAN-V8 M1 set out to retire, and falling back to it silently ' +
        'would retire the comment rather than the problem. See packages/kv/src/resolve.ts.',
    );
  }

  // A preview, `next dev`, a Playwright run, a test. Honest about what it is —
  // and on a preview, said out loud, because that is a deployment somebody is
  // looking at and drawing conclusions from.
  if (env.VERCEL_ENV !== undefined && env.VERCEL_ENV.length > 0) {
    console.error(
      `limen kv: ${UPSTASH_URL_ENV} is not set on this ${env.VERCEL_ENV} deployment. ` +
        'Rate limits are per-instance and reset on redeploy. This is refused on production.',
    );
  }
  return new MemoryKeyValue();
}

/**
 * The production *deployment*, which is a narrower thing than a production
 * build.
 *
 * Exported so the runtime resolver and any future surface answer this question
 * the same way. Two modules disagreeing about what "production" means is how
 * one of them ends up strict and the other silently permissive.
 */
export function isProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  const vercel = env.VERCEL_ENV;
  if (vercel !== undefined && vercel.length > 0) return vercel === 'production';
  return env.NODE_ENV === 'production';
}
