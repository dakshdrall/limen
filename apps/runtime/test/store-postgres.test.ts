/**
 * The claim, against a real Postgres.
 *
 * `fakes.ts` says why this file exists: the property that makes a duplicate
 * delivery harmless is *the database serialising two conditional updates*, and
 * asserting it against an in-memory map would be writing a fake that agrees
 * with the design. `queue-redis.test.ts` makes the same argument for at-least-
 * once delivery, and `@limen/db`'s `append-only.test.ts` for the audit grant.
 *
 * Runs when `TEST_DATABASE_URL` is set, and **fails rather than skips in CI**.
 * A suite that silently skipped would leave the one property this design rests
 * on unchecked in exactly the environment built to check it.
 *
 * Unlike the web app's store, this path is a plain `pg.Pool` — the same driver
 * production uses — so what passes here is what will happen.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createRuntimeDb, type RuntimeDb } from '@limen/db/runtime';
import { agentAccounts, agentKeys, agents, policies, scheduledTasks, turns, users } from '@limen/db';
import { BREAKER_THRESHOLD, drizzleRuntimeStore, type RuntimeStore } from '../src/store.js';

const url = process.env.TEST_DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL ?? '';
const inCi = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false';

const USER_ID = randomUUID();
const AGENT_ID = randomUUID();
const SMART_ACCOUNT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const AGENT_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const RECIPIENT = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

let db: RuntimeDb | undefined;
let close: (() => Promise<void>) | undefined;
let store: RuntimeStore | undefined;

beforeAll(async () => {
  if (url.length === 0) return;

  const handle = createRuntimeDb({ connectionString: url, max: 4 });
  db = handle.db;
  close = () => handle.pool.end();
  store = drizzleRuntimeStore(handle.db);

  await handle.db.insert(users).values({ id: USER_ID, authMethod: 'passkey', displayName: 'store test' });
  await handle.db.insert(agents).values({
    id: AGENT_ID,
    userId: USER_ID,
    name: 'payer',
    status: 'ACTIVE',
  });
  await handle.db.insert(agentAccounts).values({
    agentId: AGENT_ID,
    smartAccountContractId: SMART_ACCOUNT,
    ownerSignerKind: 'passkey',
    ownerPublicKey: 'owner-public-key',
    agentPublicKey: AGENT_KEY,
    contextRuleId: 1,
  });
  await handle.db.insert(agentKeys).values({
    agentId: AGENT_ID,
    agentPublicKey: AGENT_KEY,
    ciphertext: new Uint8Array([1, 2, 3]),
    wrappedDataKey: new Uint8Array([4, 5, 6]),
    kmsKeyId: 'env-master-key/test',
    algorithm: 'ed25519-seed:aes-256-gcm/aes-256-gcm-envelope-v1',
  });
});

afterAll(async () => {
  // Cascades to every row above; `users` is the root of all of them.
  if (db !== undefined) await db.delete(users).where(eq(users.id, USER_ID));
  await close?.();
});

describe('the claim is checked against a real database', () => {
  it('has a Postgres, or fails in CI for not having one', () => {
    if (url.length === 0 && !inCi) {
      process.stderr.write(
        'store-postgres.test.ts: no TEST_DATABASE_URL — the single-claim property was NOT exercised. ' +
          'Run a Postgres and set TEST_DATABASE_URL. This fails rather than skips in CI.\n',
      );
    }
    if (inCi) expect(url.length, 'CI must provide TEST_DATABASE_URL').toBeGreaterThan(0);
  });
});

describe.runIf(url.length > 0)('exactly one worker claims a turn', () => {
  it('lets the first claim through and the second find nothing', async () => {
    const turn = await store!.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'get_balance', arguments: {} },
    });

    const first = await store!.claimTurn(turn.id);
    const second = await store!.claimTurn(turn.id);

    expect(first?.status).toBe('running');
    // The duplicate. Not an error, not a retry: nothing to do, because another
    // worker owns this turn.
    expect(second).toBeUndefined();
  });

  it('serialises concurrent claims to exactly one winner', async () => {
    // Four at once, which is what redelivery to a fleet actually looks like. A
    // SELECT-then-UPDATE would let more than one through here, and the window
    // it opens is a duplicate payment.
    const turn = await store!.createTurn({
      agentId: AGENT_ID,
      channel: 'api',
      request: { kind: 'tool', tool: 'send_payment', arguments: {} },
    });

    const claims = await Promise.all([
      store!.claimTurn(turn.id),
      store!.claimTurn(turn.id),
      store!.claimTurn(turn.id),
      store!.claimTurn(turn.id),
    ]);

    expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
  });

  it('refuses to claim a turn that is already done', async () => {
    const turn = await store!.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'get_balance', arguments: {} },
    });
    await store!.claimTurn(turn.id);
    await store!.finishTurn({ turnId: turn.id, outcome: 'succeeded', result: { summary: 'ok' } });

    expect(await store!.claimTurn(turn.id)).toBeUndefined();
  });

  it('does not abandon a turn that has already finished', async () => {
    // `abandonTurn` is conditional on `running` for the same reason the claim
    // is conditional on `queued`: a late redelivery must not overwrite a result
    // somebody is already looking at.
    const turn = await store!.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'get_balance', arguments: {} },
    });
    await store!.claimTurn(turn.id);
    await store!.finishTurn({ turnId: turn.id, outcome: 'succeeded', result: { summary: 'kept' } });

    await store!.abandonTurn(turn.id, { summary: 'overwritten' });

    const after = await store!.turnById(turn.id);
    expect(after?.outcome).toBe('succeeded');
    expect(after?.result).toEqual({ summary: 'kept' });
  });
});

describe.runIf(url.length > 0)('what a turn can read back', () => {
  it('reads a turn for its owner and not for anybody else', async () => {
    const turn = await store!.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'get_balance', arguments: {} },
    });

    expect((await store!.readTurn(turn.id, USER_ID))?.id).toBe(turn.id);
    expect(await store!.readTurn(turn.id, randomUUID())).toBeUndefined();
  });

  it('round-trips the request and the result as written', async () => {
    const turn = await store!.createTurn({
      agentId: AGENT_ID,
      channel: 'telegram',
      request: { kind: 'tool', tool: 'send_payment', arguments: { destination: RECIPIENT, stroops: '40' } },
    });
    await store!.claimTurn(turn.id);
    await store!.finishTurn({
      turnId: turn.id,
      outcome: 'refused_by_limen',
      result: { constraint: 'recipient_not_allowed', reachedLedger: false },
    });

    const after = await store!.turnById(turn.id);
    expect(after?.channel).toBe('telegram');
    expect(after?.request).toEqual({
      kind: 'tool',
      tool: 'send_payment',
      arguments: { destination: RECIPIENT, stroops: '40' },
    });
    expect(after?.outcome).toBe('refused_by_limen');
    expect(after?.status).toBe('done');
    expect(after?.finishedAt).not.toBeNull();
  });
});

describe.runIf(url.length > 0)('what one turn needs about its agent', () => {
  it('reads the pointers, and no boundary at all', async () => {
    const agent = await store!.agentForTurn(AGENT_ID, USER_ID);
    expect(agent?.smartAccount).toBe(SMART_ACCOUNT);
    expect(agent?.contextRuleId).toBe(1);
    expect(agent?.sealedKey.algorithm).toMatch(/^ed25519-seed:/);
    // The fee account falls back to the agent's own address, which `deploy`
    // funds precisely so it can pay.
    expect(agent?.feeAccount).toBe(AGENT_KEY);
    // No cap, no remaining spend, no "is live". Those are read from the chain
    // on every turn — `schema.ts` rule 2, inherited from `lib/store.ts`.
    expect(Object.keys(agent ?? {})).not.toContain('limit');
    expect(Object.keys(agent ?? {})).not.toContain('remaining');
  });

  it('returns nothing for somebody else\'s agent', async () => {
    expect(await store!.agentForTurn(AGENT_ID, randomUUID())).toBeUndefined();
  });

  it('finds an agent with no installed policy row, rather than hiding it', async () => {
    // An inner join on `policies` would make an agent with no off-chain limits
    // unreachable while looking exactly like one that does not exist.
    const agent = await store!.agentForTurn(AGENT_ID, USER_ID);
    expect(agent).toBeDefined();
    expect(agent?.enforcedOffchain).toBeNull();
  });

  it('reads the off-chain limits when a policy is installed', async () => {
    await db!.insert(policies).values({
      agentId: AGENT_ID,
      source: 'described',
      status: 'installed',
      enforcedOffchainJson: { recipients: [RECIPIENT] },
    });

    const agent = await store!.agentForTurn(AGENT_ID, USER_ID);
    expect(agent?.enforcedOffchain).toEqual({ recipients: [RECIPIENT] });
  });
});

/**
 * The ratchet, against the database that enforces it.
 *
 * `restampReference` refuses an upward move and `restamp.test.ts` proves it
 * over a range. This is the *second* refusal, and it is the one that holds when
 * the first is bypassed — a future caller, a concurrent cycle finishing second,
 * a hand-run UPDATE through this method. Asserting it against the fake would be
 * asserting that the fake agrees with the design; the `WHERE` clause is a
 * property of Postgres, so it is checked here.
 */
describe.runIf(url.length > 0)('the re-stamp guard is in the database, not only in the caller', () => {
  const stored = (referencePrice: string) => ({
    kind: 'price_drop' as const,
    referencePrice,
    referenceLedger: 4_300_000,
    dropBps: 500,
    amount: '20000000',
  });

  const currentReference = async (): Promise<string | undefined> => {
    const [row] = await db!.select({ trigger: agents.triggerJson }).from(agents).where(eq(agents.id, AGENT_ID));
    return (row?.trigger as { referencePrice?: string } | null)?.referencePrice;
  };

  beforeEach(async () => {
    await db!.update(agents).set({ triggerJson: stored('2500000') }).where(eq(agents.id, AGENT_ID));
  });

  it('applies a re-stamp that moves the reference down', async () => {
    const applied = await store!.restampTrigger({
      agentId: AGENT_ID,
      mustBeAbove: '2300000',
      trigger: stored('2300000'),
    });

    expect(applied).toBe(true);
    expect(await currentReference()).toBe('2300000');
  });

  it('refuses one that would move it up, and leaves the row untouched', async () => {
    const applied = await store!.restampTrigger({
      agentId: AGENT_ID,
      mustBeAbove: '2700000',
      trigger: stored('2700000'),
    });

    expect(applied, 'the WHERE clause must match no row').toBe(false);
    expect(await currentReference()).toBe('2500000');
  });

  it('refuses one that would not move it at all', async () => {
    // Equal is not down. A no-op write would be harmless in itself, but it
    // would report as a re-stamp and put a row in the audit log claiming a
    // change that did not happen.
    const applied = await store!.restampTrigger({
      agentId: AGENT_ID,
      mustBeAbove: '2500000',
      trigger: stored('2500000'),
    });

    expect(applied).toBe(false);
    expect(await currentReference()).toBe('2500000');
  });

  it('compares numerically rather than as text', async () => {
    // `'900000' > '1000000'` is true lexically and false in every sense that
    // matters here. A text comparison would invert the guard for any pair of
    // prices with different digit counts, which is most of them.
    await db!.update(agents).set({ triggerJson: stored('1000000') }).where(eq(agents.id, AGENT_ID));

    const applied = await store!.restampTrigger({
      agentId: AGENT_ID,
      mustBeAbove: '900000',
      trigger: stored('900000'),
    });

    expect(applied, '900000 is below 1000000 and the write must apply').toBe(true);
    expect(await currentReference()).toBe('900000');
  });

  it('loses a race rather than winning it, when the stored reference has already moved below', async () => {
    // Two cycles finishing out of order. The second carries an older, higher
    // price; the guard is what stops it walking the reference back up.
    await db!.update(agents).set({ triggerJson: stored('2100000') }).where(eq(agents.id, AGENT_ID));

    const applied = await store!.restampTrigger({
      agentId: AGENT_ID,
      mustBeAbove: '2300000',
      trigger: stored('2300000'),
    });

    expect(applied).toBe(false);
    expect(await currentReference()).toBe('2100000');
  });
});

/**
 * The scheduler, against the same real database, for the same reason.
 *
 * Every property below is a property of *Postgres serialising two statements*
 * or of *a constraint refusing a row*. A fake that agreed with the design would
 * assert nothing here, and the design is what is on trial: the whole argument
 * for a conditional UPDATE is that two ticks cannot both own a due window, and
 * the only place that is true or false is in a database.
 */
describe.runIf(url.length > 0)('the schedule claim', () => {
  const TASK_ID = randomUUID();
  const INTERVAL = 900;

  /** A schedule due at `dueAt`, replaced from scratch so no test inherits state. */
  const givenSchedule = async (dueAt: Date, overrides: Record<string, unknown> = {}): Promise<void> => {
    await db!.delete(scheduledTasks).where(eq(scheduledTasks.id, TASK_ID));
    await db!.insert(scheduledTasks).values({
      id: TASK_ID,
      agentId: AGENT_ID,
      cron: null,
      intervalSeconds: INTERVAL,
      nextRunAt: dueAt,
      enabled: true,
      ...overrides,
    });
  };

  const taskRow = async (): Promise<typeof scheduledTasks.$inferSelect> => {
    const [row] = await db!.select().from(scheduledTasks).where(eq(scheduledTasks.id, TASK_ID));
    return row!;
  };

  beforeEach(async () => {
    await db!.delete(turns).where(eq(turns.agentId, AGENT_ID));
    await db!.update(agents).set({ status: 'ACTIVE' }).where(eq(agents.id, AGENT_ID));
  });

  afterAll(async () => {
    if (db !== undefined) await db.delete(scheduledTasks).where(eq(scheduledTasks.id, TASK_ID));
  });

  it('claims a due schedule and advances it to the next future slot, not the missed one', async () => {
    // Due two and a half intervals ago: the scheduler was down through two
    // slots. A catch-up scheduler would move to the slot after the one it
    // missed and then re-run windows it was absent for; this one goes forward.
    const now = new Date();
    const dueAt = new Date(now.getTime() - INTERVAL * 2500);
    await givenSchedule(dueAt);

    const claimed = await store!.claimDueTasks({ now, limit: 10 });
    const mine = claimed.filter((c) => c.taskId === TASK_ID);

    expect(mine).toHaveLength(1);
    expect(mine[0]!.dueAt.getTime()).toBe(dueAt.getTime());
    expect(mine[0]!.agentId).toBe(AGENT_ID);
    expect(mine[0]!.userId).toBe(USER_ID);
    // Strictly future, and still on the original grid rather than `now + interval`.
    expect(mine[0]!.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    expect((mine[0]!.nextRunAt.getTime() - dueAt.getTime()) % (INTERVAL * 1000)).toBe(0);
    // Three slots on, because two were missed and the third is the first future one.
    expect(mine[0]!.nextRunAt.getTime()).toBe(dueAt.getTime() + INTERVAL * 3000);
  });

  it('lets exactly one of four concurrent ticks own a due window', async () => {
    // What a redelivery, a second process, or one tick running twice actually
    // looks like. A SELECT-then-UPDATE lets more than one through here, and
    // what comes through is a scheduled trade that runs twice.
    const now = new Date();
    await givenSchedule(new Date(now.getTime() - 1000));

    const results = await Promise.all([
      store!.claimDueTasks({ now, limit: 10 }),
      store!.claimDueTasks({ now, limit: 10 }),
      store!.claimDueTasks({ now, limit: 10 }),
      store!.claimDueTasks({ now, limit: 10 }),
    ]);

    const winners = results.flat().filter((c) => c.taskId === TASK_ID);
    expect(winners).toHaveLength(1);
  });

  it('does not see a paused agent, or a schedule somebody turned off', async () => {
    const now = new Date();
    await givenSchedule(new Date(now.getTime() - 1000));

    // The filter lives in the query, so a paused agent is not "skipped with a
    // reason" — the schedule simply does not see it.
    await db!.update(agents).set({ status: 'PAUSED' }).where(eq(agents.id, AGENT_ID));
    expect((await store!.claimDueTasks({ now, limit: 10 })).filter((c) => c.taskId === TASK_ID)).toHaveLength(0);
    // And the slot was not consumed while it was invisible.
    expect((await taskRow()).nextRunAt?.getTime()).toBe(now.getTime() - 1000);

    await db!.update(agents).set({ status: 'ACTIVE' }).where(eq(agents.id, AGENT_ID));
    await givenSchedule(new Date(now.getTime() - 1000), { enabled: false });
    expect((await store!.claimDueTasks({ now, limit: 10 })).filter((c) => c.taskId === TASK_ID)).toHaveLength(0);
  });

  it('refuses a second turn for a slot even when the claim is bypassed entirely', async () => {
    // The fence behind the mechanism. This writes the turn directly, as a
    // weakened caller or a well-meant retry would, and the index still refuses.
    const now = new Date();
    await givenSchedule(new Date(now.getTime() - 1000));
    const dueAt = new Date(now.getTime() - 1000);

    await store!.createTurn({
      agentId: AGENT_ID,
      channel: 'api',
      request: { kind: 'cycle' },
      schedule: { taskId: TASK_ID, dueAt },
    });

    // Asserted on the constraint's own name rather than on a message, so this
    // proves *the partial unique index* refused it and not merely that
    // something went wrong. Drizzle wraps the driver error, so the cause is
    // where Postgres's own report survives.
    const refusal = await store!
      .createTurn({
        agentId: AGENT_ID,
        channel: 'api',
        request: { kind: 'cycle' },
        schedule: { taskId: TASK_ID, dueAt },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refusal).toBeDefined();
    expect((refusal as { cause?: { constraint?: string; code?: string } }).cause?.constraint).toBe(
      'turns_scheduled_slot_key',
    );
    expect((refusal as { cause?: { code?: string } }).cause?.code).toBe('23505');

    // A hand-started turn has neither column set and must never collide.
    await store!.createTurn({ agentId: AGENT_ID, channel: 'web', request: { kind: 'cycle' } });
    await store!.createTurn({ agentId: AGENT_ID, channel: 'web', request: { kind: 'cycle' } });
  });

  it('stops letting an unresolvable turn block the schedule, and records which kind it was', async () => {
    const now = new Date();
    const turn = await store!.createTurn({ agentId: AGENT_ID, channel: 'api', request: { kind: 'cycle' } });
    await store!.claimTurn(turn.id);
    // The turn that can never be resolved: a worker died between
    // `sendTransaction` and recording, so the marker is the last thing written.
    await store!.markSubmitting(turn.id, { stage: 'submitting' });

    // Inside the bound it blocks, which is the ordinary case and the one that
    // stops a second cycle stacking behind a slow first.
    expect(await store!.blockingTurn({ agentId: AGENT_ID, staleAfterMs: 10 * 60 * 1000, now })).toBeDefined();

    // Past it, it does not.
    const later = new Date(now.getTime() + 11 * 60 * 1000);
    expect(await store!.blockingTurn({ agentId: AGENT_ID, staleAfterMs: 10 * 60 * 1000, now: later })).toBeUndefined();

    const cutoff = new Date(later.getTime() - 10 * 60 * 1000);
    const expired = await store!.expireStaleTurn({ agentId: AGENT_ID, cutoff });
    expect(expired?.turnId).toBe(turn.id);
    // The whole point of the marker: this is "a transaction may be on a
    // ledger", not "nothing was signed", and the record says so rather than hedging.
    expect(expired?.mayHaveSubmitted).toBe(true);

    const closed = await store!.turnById(turn.id);
    expect(closed?.status).toBe('done');
    expect(closed?.outcome).toBe('infra_error');
    expect((closed?.result as { stage: string }).stage).toBe('expired');
    expect((closed?.result as { summary: string }).summary).toMatch(/may already be on a ledger/);

    // Single-winner, like every other close in this file: a second ticker
    // finds nothing and cannot write a second expiry onto one turn.
    expect(await store!.expireStaleTurn({ agentId: AGENT_ID, cutoff })).toBeUndefined();
  });

  it('disables the schedule on the third failure in a row, and one success resets the count', async () => {
    const now = new Date();
    await givenSchedule(new Date(now.getTime() - 1000));

    const first = await store!.recordScheduleOutcome({ taskId: TASK_ID, counts: true, reason: 'refused_by_limen' });
    const second = await store!.recordScheduleOutcome({ taskId: TASK_ID, counts: true, reason: 'refused_by_limen' });
    expect([first.consecutiveFailures, second.consecutiveFailures]).toEqual([1, 2]);
    expect([first.disabled, second.disabled]).toEqual([false, false]);
    expect((await taskRow()).enabled).toBe(true);

    const third = await store!.recordScheduleOutcome({ taskId: TASK_ID, counts: true, reason: 'refused_by_limen' });
    expect(third.consecutiveFailures).toBe(BREAKER_THRESHOLD);
    expect(third.disabled).toBe(true);

    // Not silent: the two columns say a breaker stopped this, and when, so a
    // stopped schedule cannot render as a healthy one.
    const tripped = await taskRow();
    expect(tripped.enabled).toBe(false);
    expect(tripped.disabledAt).not.toBeNull();
    expect(tripped.disabledReason).toBe('refused_by_limen');

    // And the schedule stops being claimed, which is what "disabled" has to mean.
    await db!.update(scheduledTasks).set({ nextRunAt: new Date(now.getTime() - 1000) }).where(eq(scheduledTasks.id, TASK_ID));
    expect((await store!.claimDueTasks({ now, limit: 10 })).filter((c) => c.taskId === TASK_ID)).toHaveLength(0);

    // One success resets. A no-trade cycle is a success — it ran and reported —
    // so a patient agent never trips its own breaker by being patient.
    await db!.update(scheduledTasks).set({ enabled: true }).where(eq(scheduledTasks.id, TASK_ID));
    const reset = await store!.recordScheduleOutcome({ taskId: TASK_ID, counts: false, reason: 'succeeded' });
    expect(reset.consecutiveFailures).toBe(0);
    expect((await taskRow()).consecutiveFailures).toBe(0);
  });
});
