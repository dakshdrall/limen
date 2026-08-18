/**
 * Shared state, and the two `TODO(roadmap)`s it retires.
 *
 * `apps/web/src/lib/rate-limit.ts` and `tx-cache.ts` both said the same thing
 * about themselves, honestly, for two versions:
 *
 * > **TODO(roadmap): shared state.** Process-local counters reset on redeploy
 * > and do not compose across instances, so this raises the cost of a flood
 * > rather than bounding it.
 *
 * On Vercel that is not a small gap. Each concurrent execution is its own
 * process with its own counters, so a limit of "20 per five minutes" was
 * enforced 20-per-instance — a bound that loosens exactly as fast as traffic
 * arrives, which is the wrong direction for a rate limit.
 *
 * ## Two access paths, for §7.5.2's reason
 *
 * The same argument the database made, and it lands the same way:
 *
 * | Consumer | Client | Why |
 * |---|---|---|
 * | `apps/web` (Vercel, many short-lived instances) | Upstash over **HTTP** | Stateless. Each command is an HTTP request; there is no connection to exhaust, and 30,000 instances have no pool to run out of. |
 * | `apps/runtime` (one long-lived process) | **TCP** (`ioredis`) | The queue has to *block*. `BLPOP` is a held connection by definition, and an HTTP client cannot express it — polling instead would be the wrong shape for the one component whose job is to wait. |
 *
 * As with the database, the two are not interchangeable and there is no shared
 * `kv` export that would let a Vercel function open a TCP connection by
 * importing the wrong name.
 *
 * ## The interface is this small on purpose
 *
 * Four operations, all of which every Redis-compatible service implements
 * identically and none of which need a session. Anything requiring a held
 * connection — `BLPOP`, `SUBSCRIBE` — is on the runtime client only and is not
 * part of this interface, so a web route cannot reach for one and discover at
 * runtime that HTTP cannot do it.
 */

export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void>;
  del(key: string): Promise<void>;

  /**
   * Increment, and set the expiry on the way in if this is the first one.
   *
   * The whole reason the rate limiter can be shared. Read-then-write across two
   * commands is a race — N instances all reading 19 and all writing 20 is how a
   * limit of 20 lets 20N through — and `INCR` is atomic at the server, so the
   * count is correct no matter how many instances raced for it.
   *
   * The TTL is applied only when the counter is created (the increment returned
   * 1). Setting it on every call would slide the window forward with each
   * request and a client sending steadily would never reset, which converts a
   * fixed window into a ban.
   */
  incrementInWindow(key: string, ttlSeconds: number): Promise<number>;

  /** Which implementation this is. Rendered in the health check, never guessed. */
  readonly id: 'upstash' | 'redis' | 'memory';

  /**
   * Whether this store is shared between processes.
   *
   * Exists so nothing has to infer it from `id`. The whole point of this
   * package is that a process-local store is a *different guarantee*, and code
   * that cares — a health check, a startup log, an operator reading either —
   * should be able to ask rather than maintain its own list of which ids are
   * which.
   */
  readonly shared: boolean;
}
