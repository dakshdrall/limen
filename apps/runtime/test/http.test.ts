/**
 * The three routes, driven over a real socket.
 *
 * `createServer` and `fetch` rather than a handler called directly: the parts
 * most likely to be wrong in an HTTP surface are the parts a direct call skips
 * — the method and path matching, the status code, the body cap, and whether a
 * header is read case-insensitively. A test that calls the handler function
 * proves the branch and not the route.
 *
 * The properties that matter here are the boundary ones. **Nothing is accepted
 * without a live session**, **an agent that is not yours is indistinguishable
 * from one that does not exist**, and **a POST returns before the work runs** —
 * which is the whole of §7.5.4's accept-fast shape, and the reason a payment
 * does not live inside a request handler.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer, type TurnQueue } from '../src/http.js';
import { fakeStore, AGENT_ID, USER_ID } from './fakes.js';
import type { Server } from 'node:http';
import type { Job } from '../src/queue.js';

const TOKEN = 'a-live-session-token';
const DESTINATION = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

let open: Server | undefined;

afterEach(async () => {
  const server = open;
  open = undefined;
  if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function start(options: { overBudget?: boolean } = {}): Promise<{
  url: string;
  enqueued: Job[];
  recorded: ReturnType<typeof fakeStore>['recorded'];
}> {
  const { store, recorded } = fakeStore();
  const enqueued: (Omit<Job, 'enqueuedAt'> & { enqueuedAt?: string })[] = [];

  const queue: TurnQueue = {
    async enqueue(job) {
      enqueued.push(job);
    },
    async depth() {
      return { waiting: 0, processing: 0 };
    },
  };

  const server = createHttpServer({
    store,
    queue,
    resolveCaller: async (token) =>
      token === TOKEN ? { userId: USER_ID, sessionId: 'session-1' } : undefined,
    limit: { check: async () => options.overBudget === true },
    log: () => undefined,
  });

  open = server;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { url: `http://127.0.0.1:${address.port}`, enqueued: enqueued as Job[], recorded };
}

/**
 * `null` means "send no Authorization header".
 *
 * Not `undefined`: passing `undefined` for a parameter with a default applies
 * the default, so the no-credential test would have sent a valid token and
 * passed for the wrong reason. It did, once.
 */
const post = (url: string, body: unknown, token: string | null = TOKEN): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

describe('nothing is accepted without a live session', () => {
  it('refuses a POST with no Authorization header', async () => {
    const { url, enqueued } = await start();
    const response = await post(`${url}/agents/${AGENT_ID}/turns`, { tool: 'get_balance' }, null);
    expect(response.status).toBe(401);
    expect(enqueued).toEqual([]);
  });

  it('refuses a token that names no session', async () => {
    const { url } = await start();
    const response = await post(`${url}/agents/${AGENT_ID}/turns`, { tool: 'get_balance' }, 'not-a-token');
    expect(response.status).toBe(401);
  });

  it('refuses a GET of a turn with no session', async () => {
    const { url } = await start();
    expect((await fetch(`${url}/turns/${AGENT_ID}`)).status).toBe(401);
  });

  it('reads the header case-insensitively and tolerates extra spacing', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/agents/${AGENT_ID}/turns`, {
      method: 'POST',
      headers: { AUTHORIZATION: `bearer   ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'get_balance' }),
    });
    expect(response.status).toBe(202);
  });
});

describe('a turn is accepted, queued, and answered later', () => {
  it('returns 202 with an id to poll, before anything has run', async () => {
    const { url, enqueued, recorded } = await start();
    const response = await post(`${url}/agents/${AGENT_ID}/turns`, {
      tool: 'send_payment',
      arguments: { destination: DESTINATION, stroops: '40000000' },
    });

    expect(response.status).toBe(202);
    const body = (await response.json()) as { turnId: string; status: string; poll: string };
    expect(body.status).toBe('queued');
    expect(body.poll).toBe(`/turns/${body.turnId}`);

    // The row exists before the response does, so a poll immediately afterwards
    // cannot 404 on work that was accepted.
    expect(recorded.turns.get(body.turnId)?.status).toBe('queued');
  });

  it('keys the job by the turn id, so a redelivery carries the same key', async () => {
    const { url, enqueued } = await start();
    const response = await post(`${url}/agents/${AGENT_ID}/turns`, { tool: 'get_balance' });
    const { turnId } = (await response.json()) as { turnId: string };

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.kind).toBe('turn.run');
    // Per intent, not per enqueue. `queue.ts` refuses a job with no key for
    // this reason and the row is the intent.
    expect(enqueued[0]?.idempotencyKey).toBe(turnId);
    expect(enqueued[0]?.payload).toEqual({ turnId, agentId: AGENT_ID, userId: USER_ID });
  });

  it('defaults the channel to web and carries a stated one through', async () => {
    const { url, recorded } = await start();
    const first = await post(`${url}/agents/${AGENT_ID}/turns`, { tool: 'get_balance' });
    const second = await post(`${url}/agents/${AGENT_ID}/turns`, {
      tool: 'get_balance',
      channel: 'telegram',
    });

    const a = (await first.json()) as { turnId: string };
    const b = (await second.json()) as { turnId: string };
    expect(recorded.turns.get(a.turnId)?.channel).toBe('web');
    expect(recorded.turns.get(b.turnId)?.channel).toBe('telegram');
  });

  it('answers the poll with the outcome once the worker has written one', async () => {
    const { url, recorded } = await start();
    const accepted = await post(`${url}/agents/${AGENT_ID}/turns`, { tool: 'get_balance' });
    const { turnId } = (await accepted.json()) as { turnId: string };

    const queued = await fetch(`${url}/turns/${turnId}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(((await queued.json()) as { status: string }).status).toBe('queued');

    const turn = recorded.turns.get(turnId)!;
    recorded.turns.set(turnId, {
      ...turn,
      status: 'done',
      outcome: 'succeeded',
      result: { summary: 'done' },
      finishedAt: new Date(),
    });

    const done = await fetch(`${url}/turns/${turnId}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const body = (await done.json()) as { status: string; outcome: string; result: { summary: string } };
    expect(body.status).toBe('done');
    expect(body.outcome).toBe('succeeded');
    expect(body.result.summary).toBe('done');
  });
});

describe('what the edge refuses rather than queueing', () => {
  it('gives 404 for an agent that is not this caller\'s, exactly as for one that does not exist', async () => {
    const { url, enqueued } = await start();
    const other = '33333333-3333-4333-8333-333333333333';
    const response = await post(`${url}/agents/${other}/turns`, { tool: 'get_balance' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(enqueued).toEqual([]);
  });

  it('refuses an unknown tool at the edge instead of queueing a doomed turn', async () => {
    // A turn that can only end in `agent_error` is not work. Queueing it would
    // make the caller poll to find out what this response can say immediately.
    const { url, enqueued } = await start();
    const response = await post(`${url}/agents/${AGENT_ID}/turns`, { tool: 'wire_transfer' });
    expect(response.status).toBe(400);
    expect(enqueued).toEqual([]);
  });

  it('refuses a body that is not JSON, and one that is too large', async () => {
    const { url } = await start();
    const notJson = await fetch(`${url}/agents/${AGENT_ID}/turns`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{oh no',
    });
    expect(notJson.status).toBe(400);

    const huge = await post(`${url}/agents/${AGENT_ID}/turns`, {
      tool: 'get_balance',
      arguments: { note: 'x'.repeat(20 * 1024) },
    });
    expect(huge.status).toBe(400);
  });

  it('refuses over the rate limit without writing a turn', async () => {
    const { url, recorded } = await start({ overBudget: true });
    const response = await post(`${url}/agents/${AGENT_ID}/turns`, { tool: 'get_balance' });
    expect(response.status).toBe(429);
    expect(recorded.turns.size).toBe(0);
  });

  it('has no route for anything else', async () => {
    const { url } = await start();
    expect((await fetch(`${url}/agents`)).status).toBe(404);
    expect((await fetch(`${url}/turns/not-a-uuid`)).status).toBe(404);
  });
});

describe('health says what this process can do', () => {
  it('needs no session, and names the tools it has', async () => {
    // Unauthenticated on purpose: a health check that needs a credential is a
    // health check a load balancer cannot make.
    const { url } = await start();
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      queue: { waiting: 0, processing: 0 },
      tools: ['get_balance', 'send_payment'],
    });
  });

  it('is never cached', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/health`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
