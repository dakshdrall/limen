/**
 * Which origins this deployment will accept an assertion from, and which
 * relying party its credentials belong to.
 *
 * `webauthn.ts` takes these as an argument rather than reading them, so the
 * verifier stays a pure function and every test states its own expectation.
 * This is the module that answers the question for the running deployment, and
 * it is the one place that does.
 *
 * ## Why this cannot be derived from the request
 *
 * The obvious implementation reads the `Host` or `Origin` header and checks the
 * assertion against that. It is also worthless: both are supplied by the
 * caller, so an attacker replaying a stolen assertion sends the origin it was
 * collected from and the check passes. **The expected origin has to come from
 * configuration**, which is the whole reason this file exists rather than a
 * one-line helper in the route.
 *
 * ## Previews
 *
 * Vercel gives every preview deployment its own hostname, so a fixed list would
 * either exclude previews or have to be edited per branch. `VERCEL_URL` is that
 * hostname, supplied by the platform, and is added to the accepted list when
 * present.
 *
 * That is safe in a way the header is not — `VERCEL_URL` is set by the platform
 * in the deployment's environment, not by the caller — but it is worth being
 * precise about what it buys, because a passkey registered on production will
 * not work on a preview regardless. `rpId` is the registrable domain a
 * credential is bound to, and `limen-git-m1.vercel.app` is a different one from
 * `limen.app`. Previews get their own credentials, which is the correct
 * behaviour and not a limitation to work around: a preview being able to
 * exercise a production credential is precisely the property this check exists
 * to deny.
 *
 * ## The production refusal
 *
 * Same shape as `resolveWebKeyValue` and `EnvMasterKeyProvider`, and for the
 * same reason. A deployment with no configured relying party could default to
 * the request's host and *appear* to work — every login would succeed, and the
 * check §7.3 requires would be off. A fence that silently defaults to accepting
 * everything is worse than no fence, because it reads as one. So: configured,
 * or `localhost` outside production, or refuse.
 */

import 'server-only';
import type { Expectation } from './webauthn';

export const RP_ID_ENV = 'LIMEN_WEBAUTHN_RP_ID';
export const ORIGINS_ENV = 'LIMEN_WEBAUTHN_ORIGINS';

export interface RelyingParty {
  rpId: string;
  origins: readonly string[];
}

function isProductionDeployment(env: NodeJS.ProcessEnv): boolean {
  // The same predicate `packages/kv/src/resolve.ts` uses, and for the same
  // reason: Vercel sets NODE_ENV=production on previews too, so it cannot
  // answer this question.
  const vercel = env.VERCEL_ENV;
  if (vercel !== undefined && vercel.length > 0) return vercel === 'production';
  return env.NODE_ENV === 'production';
}

export function resolveRelyingParty(env: NodeJS.ProcessEnv = process.env): RelyingParty {
  const rpId = (env[RP_ID_ENV] ?? '').trim();
  const configured = (env[ORIGINS_ENV] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const origins = [...configured];
  // Platform-supplied, not caller-supplied. See the header.
  const previewHost = (env.VERCEL_URL ?? '').trim();
  if (previewHost.length > 0) {
    const previewOrigin = `https://${previewHost}`;
    if (!origins.includes(previewOrigin)) origins.push(previewOrigin);
  }

  if (rpId.length > 0 && origins.length > 0) return { rpId, origins };

  if (isProductionDeployment(env)) {
    throw new Error(
      `${RP_ID_ENV} and ${ORIGINS_ENV} are not both set, and this is the production deployment. ` +
        'Refusing to fall back to a request-derived origin: the Origin and Host headers are supplied by the ' +
        'caller, so checking an assertion against them would accept a replayed assertion from any site and ' +
        'would look exactly like a working login. The on-chain verifier checks neither origin nor rpIdHash ' +
        '(PLAN-V8 §1.10), which is why this check is required rather than defence in depth. ' +
        'See apps/web/src/lib/webauthn-config.ts.',
    );
  }

  // `next dev`, a Playwright run, a test. `localhost` is a valid relying-party
  // id and the browser treats it as a secure context, so the ceremony works
  // here exactly as it does in production.
  return {
    rpId: rpId.length > 0 ? rpId : 'localhost',
    origins: origins.length > 0 ? origins : ['http://localhost:3000'],
  };
}

/** The expectation a route hands the verifier, with the challenge it just spent. */
export function expectationFor(
  purpose: 'register' | 'login',
  challenge: string,
  env: NodeJS.ProcessEnv = process.env,
): Expectation {
  const { rpId, origins } = resolveRelyingParty(env);
  return { rpId, origins, challenge, type: purpose === 'register' ? 'webauthn.create' : 'webauthn.get' };
}
