/**
 * Three things a transaction-mode pooler breaks, made unusable rather than
 * discouraged.
 *
 * §7.5.2 decides that `apps/runtime` talks to Neon through PgBouncer in
 * **transaction mode**, where a connection is handed back to the pool at the
 * end of every transaction rather than being held for a session. Three
 * ordinary Postgres features depend on a session outliving a transaction, and
 * all three break there:
 *
 *   1. **Session-level advisory locks** (`pg_advisory_lock`). Taken on one
 *      pooled connection and released on whatever connection the next statement
 *      lands on — which is to say, not released, or released by someone else.
 *      The sequence-number lock is Redis for this reason and it is already the
 *      plan; this is the fence that keeps it that way.
 *   2. **`LISTEN` / `NOTIFY`.** A `LISTEN` registers interest on a session that
 *      the pooler will reassign. Job dispatch is Redis, not Postgres pub/sub.
 *   3. **Named prepared statements** — Drizzle's `.prepare()`. Prepared on one
 *      backend, executed against another that has never heard of them.
 *
 * ## Why this file exists at all
 *
 * Because **local Postgres accepts all three**. A developer writes
 * `pg_advisory_lock`, it works on their machine, it works in CI against the
 * container this repository's tests use, and it fails in production as an
 * intermittent — the worst shape a failure can take on a money path, because
 * two agents building on one sequence number produce something that looks
 * exactly like a refusal. §7.5 names that as the one failure this product
 * cannot afford to render wrong.
 *
 * So the local environment must not be able to let one back in unnoticed, and
 * "we agreed not to" is not a mechanism. There are two fences and they catch
 * different things:
 *
 *   - **`test/portability.test.ts`** scans every workspace's source for these
 *     patterns and fails the build. It catches the ordinary case — somebody
 *     writes one — at review time, before it can run anywhere. Two-sided, and
 *     proved able to fire against synthetic samples.
 *   - **`assertPoolable`, below**, refuses at runtime on the pooled path. It
 *     catches what a source scan structurally cannot: a statement assembled at
 *     runtime, or one arriving from a dependency rather than from this
 *     repository.
 *
 * Neither subsumes the other, which is the same argument `redact.ts` makes for
 * having both an allowlist and a scrubber.
 *
 * ## What is deliberately not forbidden
 *
 * **Transactions.** `apps/runtime` is on `node-postgres` against the pooled
 * endpoint, and transaction-mode pooling supports transactions — that is what
 * it is named for. It is the web app's `neon-http` path that cannot do
 * interactive transactions, which is a different constraint enforced in a
 * different place (`web.ts`).
 *
 * **`pg_try_advisory_xact_lock` and friends.** Transaction-scoped advisory
 * locks are released at commit, so the pooler cannot strand them. They are
 * safe, and the patterns below are written to permit them: a rule that banned
 * the whole family would push someone toward a worse workaround, and a fence
 * that forbids correct code loses its authority for the cases that matter.
 */

/**
 * The three patterns, as one list, so the runtime guard and the source scan
 * cannot drift apart.
 *
 * Each carries the sentence a developer needs at the moment it fires: what
 * broke, and what to use instead. A guard that says "forbidden" and stops has
 * to be researched; one that names the alternative gets fixed.
 */
export const POOLER_HAZARDS: readonly { name: string; pattern: RegExp; instead: string }[] = [
  {
    name: 'session-level advisory lock',
    // `pg_advisory_lock`, `pg_advisory_unlock`, `pg_try_advisory_lock`, and the
    // shared variants — but NOT the `_xact_` forms, which are transaction-scoped
    // and safe. The negative lookahead is the whole point of writing this by
    // hand rather than matching `advisory`.
    pattern: /\bpg_(?:try_)?advisory_(?!xact_)(?:unlock_)?(?:shared_)?(?:lock|unlock|all)/i,
    instead: 'the per-fee-account lock in Redis (§7.5), which is where sequence serialization lives',
  },
  {
    name: 'LISTEN / NOTIFY',
    // Anchored on a *statement* boundary — the start of the string, a `;`, or
    // the quote that opens one — rather than on any whitespace.
    //
    // Both halves of that were found by the test rather than reasoned out. An
    // earlier spelling allowed a bare space before the keyword, which missed
    // `client.query('NOTIFY jobs')` because the preceding character is a quote,
    // and simultaneously fired on the English sentence "we notify the user when
    // it lands" — a fence that is silent where it matters and noisy where it
    // does not, which is how a fence gets switched off.
    pattern: /(?:^|[;'"`])\s*(?:UN)?(?:LISTEN|NOTIFY)\s+["a-z_]/i,
    instead: 'the Redis queue that already carries job dispatch (§7.5.4)',
  },
  {
    name: 'named prepared statement',
    pattern: /\bPREPARE\s+[a-z_"]/i,
    instead: 'an ordinary parameterised query; Drizzle sends those unnamed',
  },
];

/**
 * Thrown rather than logged.
 *
 * A warning here would be read once and then filtered, and the failure it
 * prevents is intermittent and money-shaped. This is the same shape as
 * `demo-signer.ts`'s hard throw and `assertTestnet`'s: a fence, not a notice.
 */
export class PoolerHazardError extends Error {
  constructor(hazard: { name: string; instead: string }) {
    super(
      `This query uses a ${hazard.name}, which a transaction-mode pooler (PgBouncer, Neon's -pooler endpoint) breaks: ` +
        `the connection is returned to the pool at the end of each transaction, so nothing survives to the next statement. ` +
        `It will appear to work against a local Postgres and fail intermittently in production. Use ${hazard.instead}. ` +
        `See packages/db/src/forbidden.ts.`,
    );
    this.name = 'PoolerHazardError';
  }
}

/**
 * Refuses a statement the pooled endpoint cannot honour.
 *
 * Called on every query issued through the runtime's pool. The cost is three
 * regex tests against a string that is about to cross a network, which is not
 * a cost. It is deliberately *not* applied to the migration path: migrations
 * run against the direct, unpooled endpoint precisely so they can use the
 * session-scoped machinery a migration tool needs.
 */
export function assertPoolable(queryText: string): void {
  for (const hazard of POOLER_HAZARDS) {
    if (hazard.pattern.test(queryText)) throw new PoolerHazardError(hazard);
  }
}
