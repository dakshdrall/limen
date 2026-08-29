/**
 * The tick, and the four things that can happen to a due slot.
 *
 * The claim itself is not on trial here — that is a property of Postgres and
 * `store-postgres.test.ts` holds it. What is on trial is the policy on top:
 * that a live turn spends a slot rather than stacking a second cycle behind it,
 * that a turn nobody can resolve stops blocking, that the breaker is loud when
 * it stops a schedule, and that none of the reporting can break the schedule it
 * reports on.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Ticker, STALE_TURN_MS, type ScheduleEvent } from '../src/scheduler.js';
import { BREAKER_THRESHOLD, type RuntimeStore } from '../src/store.js';
import { AGENT_ID, USER_ID, fakeStore, type Recorded } from './fakes.js';

const TASK_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-29T12:00:00Z');

let store: RuntimeStore;
let recorded: Recorded;
let enqueued: { idempotencyKey: string; payload: unknown }[];
let events: ScheduleEvent[];

const ticker = (options: { notify?: (event: ScheduleEvent) => void; now?: Date } = {}): Ticker =>
  new Ticker({
    store,
    queue: { enqueue: async (job) => void enqueued.push({ idempotencyKey: job.idempotencyKey, payload: job.payload }) },
    notify: options.notify ?? ((event): void => void events.push(event)),
    now: () => options.now ?? NOW,
  });

const givenDue = (overrides: Partial<Recorded['schedules'] extends Map<string, infer V> ? V : never> = {}): void => {
  recorded.schedules.set(TASK_ID, {
    taskId: TASK_ID,
    agentId: AGENT_ID,
    userId: USER_ID,
    intervalSeconds: 900,
    nextRunAt: new Date(NOW.getTime() - 1000),
    enabled: true,
    consecutiveFailures: 0,
    disabledAt: null,
    disabledReason: null,
    ...overrides,
  });
};

const auditsFor = (action: string): Recorded['audits'] =>
  recorded.audits.filter((audit) => (audit as { action: string }).action === action);

beforeEach(() => {
  const fake = fakeStore();
  store = fake.store;
  recorded = fake.recorded;
  enqueued = [];
  events = [];
});

describe('a due slot becomes one cycle', () => {
  it('writes the turn with its slot, enqueues it, and says so in the history', async () => {
    givenDue();

    await ticker().tick();

    const turns = [...recorded.turns.values()];
    expect(turns).toHaveLength(1);
    expect(turns[0]!.request).toEqual({ kind: 'cycle' });
    // The slot travels on the row, which is what the partial unique index
    // refuses a second of. Nothing about the strategy is carried here — the
    // trigger is read from the agent when the worker runs it.
    expect(turns[0]!.scheduledTaskId).toBe(TASK_ID);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.idempotencyKey).toBe(turns[0]!.id);
    expect(enqueued[0]!.payload).toEqual({ turnId: turns[0]!.id, agentId: AGENT_ID, userId: USER_ID });

    expect(auditsFor('schedule.enqueued')).toHaveLength(1);
  });

  it('spends the slot and does not stack a second cycle behind a live turn', async () => {
    givenDue();
    // An agent already working. A second cycle queued behind the first is how a
    // slow drain becomes a stampede.
    const live = await store.createTurn({ agentId: AGENT_ID, channel: 'web', request: { kind: 'cycle' } });
    await store.claimTurn(live.id);
    // Started a moment ago — comfortably inside the bound. The fake stamps a
    // fixed `createdAt`, and a turn dated last week is a *stale* turn, which is
    // the opposite of the case under test.
    recorded.turns.set(live.id, { ...recorded.turns.get(live.id)!, createdAt: NOW, startedAt: NOW });

    await ticker().tick();

    expect(enqueued).toHaveLength(0);
    const skipped = auditsFor('schedule.skipped');
    expect(skipped).toHaveLength(1);
    // Recorded rather than dropped: "this agent did not trade at 12:00" has two
    // very different explanations and the history has to say which this was.
    expect((skipped[0] as { result: string }).result).toBe('turn_in_flight');
    expect((skipped[0] as { metadata: { blockingTurnId: string } }).metadata.blockingTurnId).toBe(live.id);

    // The slot is gone either way. No catch-up: a missed window is never made up.
    expect(recorded.schedules.get(TASK_ID)!.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe('a turn nobody can resolve stops blocking the schedule', () => {
  /** The unresolvable turn: a worker died between sendTransaction and recording. */
  const givenStrandedTurn = async (): Promise<string> => {
    // Carries its slot, because the tick is what created it. That is how an
    // expired turn still knows which schedule to count against.
    const turn = await store.createTurn({
      agentId: AGENT_ID,
      channel: 'api',
      request: { kind: 'cycle' },
      schedule: { taskId: TASK_ID, dueAt: new Date(NOW.getTime() - STALE_TURN_MS - 900_000) },
    });
    await store.claimTurn(turn.id);
    await store.markSubmitting(turn.id, { stage: 'submitting' });
    recorded.turns.set(turn.id, {
      ...recorded.turns.get(turn.id)!,
      createdAt: new Date(NOW.getTime() - STALE_TURN_MS - 60_000),
      startedAt: new Date(NOW.getTime() - STALE_TURN_MS - 60_000),
    });
    return turn.id;
  };

  it('closes it past the bound, runs the slot, and never retries it', async () => {
    givenDue();
    const stranded = await givenStrandedTurn();

    await ticker().tick();

    const closed = recorded.turns.get(stranded)!;
    expect(closed.status).toBe('done');
    expect(closed.outcome).toBe('infra_error');
    // The whole reason the marker is written before anything is sent.
    expect((closed.result as { mayHaveSubmitted: boolean }).mayHaveSubmitted).toBe(true);

    const expiry = auditsFor('schedule.turn_expired');
    expect(expiry).toHaveLength(1);
    expect((expiry[0] as { result: string }).result).toBe('may_have_submitted');
    // Said out loud, because the one thing a reader must not conclude from an
    // expiry is that the turn was run again.
    expect((expiry[0] as { metadata: { retried: boolean } }).metadata.retried).toBe(false);

    expect(events).toContainEqual({
      kind: 'turn_expired',
      agentId: AGENT_ID,
      turnId: stranded,
      mayHaveSubmitted: true,
    });

    // And the agent schedules again, which is the entire point of the bound.
    expect(enqueued).toHaveLength(1);
  });

  it('counts an expired turn against the breaker, so a dying worker is not silent', async () => {
    // Nothing ever calls `finishTurn` for these, so without this the schedule
    // would keep claiming slots it cannot run, forever, reporting nothing.
    givenDue({ consecutiveFailures: BREAKER_THRESHOLD - 1 });
    await givenStrandedTurn();

    await ticker().tick();

    const schedule = recorded.schedules.get(TASK_ID)!;
    expect(schedule.enabled).toBe(false);
    expect(schedule.disabledReason).toBe('turn_expired');
  });
});

describe('every way a scheduled turn can end reaches the breaker', () => {
  /**
   * The regression this file exists for, found by running the scheduler against
   * a real database rather than by reading it.
   *
   * `runClaimedTurn` used to close the "agent could not be loaded" case with a
   * bare `finishTurn` and return before the breaker. An agent whose account row
   * is missing fails *every* cycle, so that one early return produced a
   * schedule claiming a slot a minute, failing a minute, and counting nothing —
   * forever, with every screen still saying ACTIVE. The same silent-forever
   * failure the staleness bound prevents, reached by a different door.
   */
  it('counts a cycle whose agent could not be loaded at all', async () => {
    const { turnHandler } = await import('../src/turn.js');
    // No agent: `agentForTurn` finds nothing, which is the branch under test.
    const fake = fakeStore({ agent: undefined });
    fake.recorded.schedules.set(TASK_ID, {
      taskId: TASK_ID,
      agentId: AGENT_ID,
      userId: USER_ID,
      intervalSeconds: 60,
      nextRunAt: NOW,
      enabled: true,
      consecutiveFailures: BREAKER_THRESHOLD - 1,
      disabledAt: null,
      disabledReason: null,
    });

    const turn = await fake.store.createTurn({
      agentId: AGENT_ID,
      channel: 'api',
      request: { kind: 'cycle' },
      schedule: { taskId: TASK_ID, dueAt: NOW },
    });

    const handler = turnHandler({
      store: fake.store,
      provider: { open: async () => { throw new Error('never reached'); } } as never,
      rpcUrl: 'https://example.invalid',
      notify: (event) => void events.push(event),
    });
    await handler({
      kind: 'turn.run',
      idempotencyKey: turn.id,
      enqueuedAt: NOW.toISOString(),
      payload: { turnId: turn.id, agentId: AGENT_ID, userId: USER_ID },
    } as never);

    expect(fake.recorded.turns.get(turn.id)!.outcome).toBe('infra_error');
    // The point: it counted, and at the threshold it stopped the schedule.
    expect(fake.recorded.schedules.get(TASK_ID)!.enabled).toBe(false);
    expect(events.some((event) => event.kind === 'schedule_disabled')).toBe(true);
  });
});

describe('the breaker does not stop a schedule quietly', () => {
  it('records three facts when it trips, and leaves the agent alone', async () => {
    givenDue({ consecutiveFailures: BREAKER_THRESHOLD - 1 });
    const { recordCycleOutcome } = await import('../src/scheduler.js');

    await recordCycleOutcome(
      { store, notify: (event) => void events.push(event) },
      { taskId: TASK_ID, agentId: AGENT_ID, turnId: 'turn-1', outcome: 'refused_by_limen' },
    );

    // 1. The row says a breaker stopped it, and why.
    const schedule = recorded.schedules.get(TASK_ID)!;
    expect(schedule.enabled).toBe(false);
    expect(schedule.disabledAt).not.toBeNull();
    expect(schedule.disabledReason).toBe('refused_by_limen');

    // 2. The history says when, and that the agent itself was untouched.
    const disabled = auditsFor('schedule.disabled');
    expect(disabled).toHaveLength(1);
    expect((disabled[0] as { actor: string }).actor).toBe('system');
    expect((disabled[0] as { metadata: { agentStatusUnchanged: boolean } }).metadata.agentStatusUnchanged).toBe(true);

    // 3. Somebody is told. This is the seam Telegram arrives at.
    expect(events).toEqual([
      {
        kind: 'schedule_disabled',
        agentId: AGENT_ID,
        taskId: TASK_ID,
        consecutiveFailures: BREAKER_THRESHOLD,
        reason: 'refused_by_limen',
      },
    ]);
  });

  it('says nothing on a cycle that merely failed, and resets on one that succeeded', async () => {
    givenDue();
    const { recordCycleOutcome } = await import('../src/scheduler.js');
    const deps = { store, notify: (event: ScheduleEvent): void => void events.push(event) };

    await recordCycleOutcome(deps, { taskId: TASK_ID, agentId: AGENT_ID, turnId: 't', outcome: 'infra_error' });
    await recordCycleOutcome(deps, { taskId: TASK_ID, agentId: AGENT_ID, turnId: 't', outcome: 'infra_error' });
    expect(events).toHaveLength(0);
    expect(recorded.schedules.get(TASK_ID)!.consecutiveFailures).toBe(2);

    // A no-trade cycle is `succeeded` — it ran and it reported — so a patient
    // agent cannot trip its own breaker by being patient.
    await recordCycleOutcome(deps, { taskId: TASK_ID, agentId: AGENT_ID, turnId: 't', outcome: 'succeeded' });
    expect(recorded.schedules.get(TASK_ID)!.consecutiveFailures).toBe(0);
    expect(recorded.schedules.get(TASK_ID)!.enabled).toBe(true);
  });
});

describe('reporting cannot break the thing it reports on', () => {
  it('runs the slot even when the notifier throws', async () => {
    givenDue();

    await ticker({
      notify: (): never => {
        throw new Error('telegram is down');
      },
    }).tick();

    // A notification channel with the power to stop a schedule would be a
    // reporting path that breaks the thing it reports on.
    expect(enqueued).toHaveLength(1);
  });
});
