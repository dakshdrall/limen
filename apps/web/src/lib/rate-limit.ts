/**
 * The web app's binding to the shared rate limiter.
 *
 * The algorithm and the store moved to `@limen/kv` in V8 M1, and with them the
 * `TODO(roadmap)` this module used to carry:
 *
 * > **TODO(roadmap): shared state.** Process-local counters reset on redeploy
 * > and do not compose across instances, so this raises the cost of a flood
 * > rather than bounding it.
 *
 * That is retired rather than moved. The counter is in Redis, incremented
 * atomically, and `resolveWebKeyValue` **refuses to construct a process-local
 * store on the production deployment** — so "shared" is a property of the
 * deployment rather than a thing this comment used to promise. See
 * `packages/kv/src/resolve.ts` for why the predicate is the deployment and not
 * `NODE_ENV`, which on Vercel is `production` for previews too.
 *
 * What stays here is the part that is about *this* app: reading a client
 * address out of an HTTP request, and holding the one store handle every route
 * shares.
 */

import { createRateLimit as createSharedRateLimit, resolveWebKeyValue, type RateLimit } from '@limen/kv';

export type { RateLimit };

/**
 * One store for the whole app, built on first use rather than at import.
 *
 * Lazy on purpose. Next evaluates route modules during the build, and a
 * resolver that threw at import time would fail the build rather than the
 * request — reporting a missing environment variable as a compile error, which
 * is the wrong place to read it and the wrong error to read.
 */
let store: ReturnType<typeof resolveWebKeyValue> | undefined;

function keyValue() {
  store ??= resolveWebKeyValue();
  return store;
}

/**
 * `max` calls per `windowMs`, keyed by whatever the caller passes.
 *
 * `namespace` is new and is required. Every limiter in the app now shares one
 * Redis, so two of them colliding on a key would silently enforce the tighter
 * budget on both — a bug that presents as "the API is randomly refusing me" and
 * is invisible in either route.
 */
export function createRateLimit({
  max,
  windowMs,
  namespace,
}: {
  max: number;
  windowMs: number;
  namespace: string;
}): RateLimit {
  // Built on first check rather than here, for the same reason the store is:
  // constructing one reaches for the environment, and a route module is
  // evaluated during `next build`. Built *once* rather than per call — the
  // limiter is a closure over the store, so rebuilding it on every request
  // would allocate one per request to no purpose.
  let limiter: RateLimit | undefined;

  return {
    async check(key: string): Promise<boolean> {
      limiter ??= createSharedRateLimit({
        kv: keyValue(),
        max,
        windowMs,
        namespace,
        // Reported, never swallowed: a limiter that has quietly stopped
        // limiting looks exactly like one that is working.
        onError: (error) =>
          console.error(
            `limen rate-limit: store unavailable, request allowed through (${
              error instanceof Error ? error.message : 'unknown error'
            })`,
          ),
      });
      return await limiter.check(key);
    },
  };
}

/**
 * The first hop in `x-forwarded-for` is the client as far as the proxy in front
 * of this app is concerned. Spoofable when the app is reachable without that
 * proxy; sufficient for throttling a public endpoint.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return request.headers.get('x-real-ip') ?? 'unknown';
}
