/**
 * The agent API: three routes, and the accept-fast shape §7.5.4 decided.
 *
 *     POST /agents/:id/turns   verify, enqueue, acknowledge      → 202 { turnId }
 *     GET  /turns/:id          what happened, or "not yet"       → 200
 *     GET  /health             is this process able to work
 *
 * A turn is not run inside the request. Telegram retries an unacknowledged
 * webhook, an agent turn takes 15–45 seconds, and a payment that is only in
 * flight inside an HTTP handler is a payment that disappears when the handler
 * does. So the POST does three things — authenticate, write a `turns` row,
 * enqueue — and returns the id of the row.
 *
 * ## One result path, for every surface
 *
 * The web chat and the Telegram bot poll the same `GET /turns/:id`. They are
 * asking the same question and the answer has one implementation, so there is
 * one thing to debug when a result goes missing rather than two that can drift.
 * Streaming to an open tab is an addition on top of this route later, not a
 * second source of truth beside it.
 *
 * ## Node's own http server, and no framework
 *
 * Three routes and one JSON body. A framework would be a dependency, a routing
 * DSL and a middleware convention in exchange for saving the twenty lines
 * below — on a repository whose audit gate has been held hostage once already
 * by a transitive dependency nobody imported.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RateLimit } from '@limen/kv';
import { bearerToken, type Caller } from './auth.js';
import { TURN_JOB_KIND } from './turn.js';
import { TOOLS, toolNames } from './tools/index.js';
import type { Job } from './queue.js';
import type { RuntimeStore, TurnChannel } from './store.js';

/** Bodies are small — a tool name and two fields. Anything larger is refused. */
const MAX_BODY_BYTES = 16 * 1024;

const turnRequestSchema = z.strictObject({
  tool: z.string().min(1),
  arguments: z.unknown().optional(),
  // Which surface asked. It is recorded and rendered; nothing about the answer
  // depends on it, which is the property that keeps one result path honest.
  channel: z.enum(['web', 'telegram', 'api']).default('web'),
});

/**
 * What this file needs from the queue, which is two methods.
 *
 * Structural rather than the `Queue` class, so a route test can supply one
 * without a Redis. The class satisfies it as written; nothing about the
 * durability properties changes by naming the two methods used.
 */
export interface TurnQueue {
  enqueue(job: Omit<Job, 'enqueuedAt'> & { enqueuedAt?: string }): Promise<void>;
  depth(): Promise<{ waiting: number; processing: number }>;
}

export interface HttpDeps {
  /**
   * Who a bearer token names, or nothing.
   *
   * Injected rather than reached for, so this file holds no database handle and
   * a route test can answer the question with a function. `index.ts` supplies
   * the real one, which is `auth.ts` over the `sessions` table — the same rows
   * `apps/web` authenticates against.
   */
  resolveCaller: (token: string | undefined) => Promise<Caller | undefined>;
  store: RuntimeStore;
  queue: TurnQueue;
  /** Per-user, shared across processes. The money path is worth a budget. */
  limit: RateLimit;
  log?: (message: string) => void;
}

export function createHttpServer(deps: HttpDeps): Server {
  const log = deps.log ?? console.log;

  return createServer((request, response) => {
    void handle(deps, request, response).catch((error: unknown) => {
      // Nothing below is allowed to leave a request hanging. A 500 with no
      // detail, and the detail in the log: an error body is read by whoever is
      // calling, and this one is for whoever runs the process.
      log(`limen runtime: unhandled error on ${request.method} ${request.url}: ${String(error)}`);
      if (!response.headersSent) send(response, 500, { error: 'internal_error' });
    });
  });
}

async function handle(
  deps: HttpDeps,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://runtime.invalid');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'GET' && path === '/health') {
    const { waiting, processing } = await deps.queue.depth();
    send(response, 200, { ok: true, queue: { waiting, processing }, tools: toolNames(TOOLS) });
    return;
  }

  const startTurn = /^\/agents\/([0-9a-fA-F-]{36})\/turns$/.exec(path);
  if (request.method === 'POST' && startTurn !== null) {
    await postTurn(deps, request, response, startTurn[1]!);
    return;
  }

  const readTurn = /^\/turns\/([0-9a-fA-F-]{36})$/.exec(path);
  if (request.method === 'GET' && readTurn !== null) {
    await getTurn(deps, request, response, readTurn[1]!);
    return;
  }

  send(response, 404, { error: 'not_found' });
}

async function postTurn(
  deps: HttpDeps,
  request: IncomingMessage,
  response: ServerResponse,
  agentId: string,
): Promise<void> {
  const caller = await authenticate(deps, request, response);
  if (caller === undefined) return;

  if (await deps.limit.check(caller.userId)) {
    send(response, 429, { error: 'rate_limited' });
    return;
  }

  const body = await readJson(request);
  if (!body.ok) {
    send(response, 400, { error: 'bad_request', message: body.error });
    return;
  }

  const parsed = turnRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    send(response, 400, {
      error: 'bad_request',
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
    });
    return;
  }

  // Ownership is checked here, before a row is written and before anything is
  // queued. The worker does not re-check it: a turn on the queue is one this
  // route already authorised, and a second check there would be a second place
  // for the answer to be different.
  const agent = await deps.store.agentForTurn(agentId, caller.userId);
  if (agent === undefined) {
    // One answer for "not yours" and "not there". Telling an unauthorised
    // caller that an id exists is the distinction worth not making.
    send(response, 404, { error: 'not_found' });
    return;
  }

  if (TOOLS[parsed.data.tool] === undefined) {
    // Refused at the edge rather than accepted and failed in a worker. A turn
    // that can only end in `agent_error` is not work, and queueing it would
    // make the caller poll to find out what this response can say now.
    send(response, 400, {
      error: 'unknown_tool',
      message: `No tool called ${JSON.stringify(parsed.data.tool)}. Known tools: ${toolNames(TOOLS).join(', ')}.`,
    });
    return;
  }

  const turn = await deps.store.createTurn({
    agentId,
    channel: parsed.data.channel as TurnChannel,
    request: { kind: 'tool', tool: parsed.data.tool, arguments: parsed.data.arguments ?? {} },
  });

  await deps.queue.enqueue({
    kind: TURN_JOB_KIND,
    // The turn id, not a fresh one. The key has to be per *intent* rather than
    // per enqueue, and the row is the intent — so a redelivery carries the same
    // key and finds the same claim already taken.
    idempotencyKey: turn.id,
    payload: { turnId: turn.id, agentId, userId: caller.userId },
  });

  send(response, 202, {
    turnId: turn.id,
    status: turn.status,
    poll: `/turns/${turn.id}`,
  });
}

async function getTurn(
  deps: HttpDeps,
  request: IncomingMessage,
  response: ServerResponse,
  turnId: string,
): Promise<void> {
  const caller = await authenticate(deps, request, response);
  if (caller === undefined) return;

  const turn = await deps.store.readTurn(turnId, caller.userId);
  if (turn === undefined) {
    send(response, 404, { error: 'not_found' });
    return;
  }

  send(response, 200, {
    turnId: turn.id,
    agentId: turn.agentId,
    channel: turn.channel,
    status: turn.status,
    outcome: turn.outcome,
    request: turn.request,
    result: turn.result,
    createdAt: turn.createdAt.toISOString(),
    startedAt: turn.startedAt?.toISOString() ?? null,
    finishedAt: turn.finishedAt?.toISOString() ?? null,
  });
}

async function authenticate(
  deps: HttpDeps,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<Caller | undefined> {
  const caller = await deps.resolveCaller(bearerToken(request.headers.authorization));
  if (caller === undefined) {
    send(response, 401, { error: 'unauthenticated' });
    return undefined;
  }
  return caller;
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/** Reads the body with a cap, so a large POST cannot be used to grow the heap. */
async function readJson(request: IncomingMessage): Promise<Parsed> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return { ok: false, error: 'request body too large' };
    chunks.push(buffer);
  }

  if (size === 0) return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, error: 'body is not valid JSON' };
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // Nothing here is cacheable: a turn's answer changes the moment the worker
    // writes it, and a cached 202 would be a poll that never advances.
    'cache-control': 'no-store',
    // The request id a caller can quote in a bug report.
    'x-limen-request-id': randomUUID(),
  });
  response.end(text);
}
