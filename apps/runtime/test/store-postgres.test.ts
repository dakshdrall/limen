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
import { agentAccounts, agentKeys, agents, policies, users } from '@limen/db';
import { drizzleRuntimeStore, type RuntimeStore } from '../src/store.js';

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
