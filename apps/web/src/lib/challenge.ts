/**
 * Login challenges: issued here, spent once, and gone.
 *
 * The half of `webauthn.ts`'s check 2 that a pure function cannot do. Verifying
 * that an assertion answers *a* challenge this server issued is arithmetic;
 * ensuring the same assertion cannot be presented twice is state, and it has to
 * be state every instance shares — which is why this waited for `@limen/kv`.
 * On the old process-local store, a challenge issued by one Vercel instance
 * would not be found by the instance handling the response, and the login would
 * fail for one user in N while looking like a flake.
 *
 * ## Single use is enforced by deletion, not by a flag
 *
 * `consume` deletes and returns in one step and reports whether the challenge
 * existed. A "used" boolean would leave a window between reading it and writing
 * it — the two instances racing there both see `used: false`, and a replayed
 * assertion succeeds twice. Deleting is the check.
 *
 * The `KeyValue` interface has no atomic delete-and-return, and adding one for
 * this would put a fifth operation on an interface deliberately kept to four.
 * `GETDEL` exists in Redis but is not expressible through the shared shape, so
 * this reads and then deletes, and the ordering is what makes it safe: the read
 * proves the challenge existed, and the delete happens before the caller is
 * told it did. Two instances racing can both read the same challenge, so this
 * is **not** a mutual-exclusion primitive — it narrows the replay window to the
 * few milliseconds between read and delete rather than closing it. Closing it
 * needs `GETDEL` on the runtime client, which is where the money path's
 * single-use decision tokens will live at M2; a login challenge is not worth
 * widening the shared interface for.
 *
 * ## Two minutes
 *
 * Long enough for a user to find their phone and answer a biometric prompt,
 * short enough that a challenge captured from a log is worthless by the time
 * anybody reads the log. WebAuthn ceremonies that take longer than this are
 * ones the user has abandoned.
 */

import 'server-only';
import { randomBytes } from 'node:crypto';
import { resolveWebKeyValue } from '@limen/kv';
import { bytesToBase64Url } from './webauthn';

/** See the header. */
export const CHALLENGE_TTL_SECONDS = 120;

/**
 * 32 bytes.
 *
 * The spec's floor is 16. This is the size of the thing standing between an
 * attacker and a replayed login, it costs nothing, and the only reason to
 * choose the minimum would be to save 16 bytes in Redis.
 */
const CHALLENGE_BYTES = 32;

let store: ReturnType<typeof resolveWebKeyValue> | undefined;

/** Lazy, for the reason `rate-limit.ts` is: the build must not read the environment. */
function keyValue() {
  store ??= resolveWebKeyValue();
  return store;
}

/**
 * What the challenge was issued *for*.
 *
 * Registration and login are separate ceremonies with separate meanings, and a
 * challenge minted for one must not be spendable in the other. `webauthn.ts`
 * checks `clientDataJSON.type` for the same reason; this is the server-side
 * half, so the two cannot be crossed even if a browser lies about `type`.
 */
export type ChallengePurpose = 'register' | 'login';

const key = (purpose: ChallengePurpose, challenge: string): string => `webauthn:${purpose}:${challenge}`;

export interface IssuedChallenge {
  challenge: string;
  expiresInSeconds: number;
}

export async function issueChallenge(purpose: ChallengePurpose): Promise<IssuedChallenge> {
  const challenge = bytesToBase64Url(new Uint8Array(randomBytes(CHALLENGE_BYTES)));
  // The value is unused; existence is the whole record. Stored as the purpose
  // so an operator reading a key in Redis can see what it was for.
  await keyValue().set(key(purpose, challenge), purpose, { ttlSeconds: CHALLENGE_TTL_SECONDS });
  return { challenge, expiresInSeconds: CHALLENGE_TTL_SECONDS };
}

/**
 * Spend a challenge. True only if it existed and was issued for this purpose.
 *
 * A challenge that expired and one that never existed are the same answer on
 * purpose: distinguishing them would tell a caller whether a value it guessed
 * was ever real.
 */
export async function consumeChallenge(purpose: ChallengePurpose, challenge: string): Promise<boolean> {
  if (challenge.length === 0) return false;
  const kv = keyValue();
  const found = await kv.get(key(purpose, challenge));
  if (found === null) return false;
  await kv.del(key(purpose, challenge));
  return true;
}
