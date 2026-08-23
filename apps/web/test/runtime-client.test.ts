/**
 * The four ways asking the runtime can go, kept apart.
 *
 * The distinction that matters is `unavailable` versus everything else. A
 * missing `LIMEN_RUNTIME_URL` is an operator's mistake and is fixable in a
 * minute; a 500 from the runtime is not. Folding them together would put "your
 * payment failed" in front of a user whose payment was never attempted, and
 * that is a false report rather than a vague one.
 *
 * The credential is also asserted here rather than assumed. `apps/runtime` reads
 * `Authorization: Bearer`, and a request that sent the token any other way —
 * a cookie, a query parameter — would authenticate against nothing and read as
 * an expired session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_URL_ENV, readTurn, startTurn } from '@/lib/runtime-client';

const TOKEN = 'a-session-token';
const AGENT = '11111111-2222-3333-4444-555555555555';

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: unknown, init: unknown) =>
    handler(String(input), (init ?? {}) as RequestInit),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubEnv(RUNTIME_URL_ENV, 'http://runtime.test:8080');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('startTurn', () => {
  it('posts to the agent turn route and returns the id to poll', async () => {
    const spy = stubFetch(() => json(202, { turnId: 'turn-1', status: 'queued', poll: '/turns/turn-1' }));

    const result = await startTurn(AGENT, TOKEN, {
      tool: 'get_balance',
      arguments: {},
      channel: 'web',
    });

    expect(result).toEqual({
      ok: true,
      value: { turnId: 'turn-1', status: 'queued', poll: '/turns/turn-1' },
    });

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('http://runtime.test:8080/agents/' + AGENT + '/turns');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('presents the session token as a bearer credential', async () => {
    const spy = stubFetch(() => json(202, { turnId: 't', status: 'queued', poll: '/turns/t' }));

    await startTurn(AGENT, TOKEN, { tool: 'get_balance', arguments: {}, channel: 'web' });

    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('reports an unset runtime URL as unavailable, and sends nothing', async () => {
    vi.stubEnv(RUNTIME_URL_ENV, '');
    const spy = stubFetch(() => json(202, {}));

    const result = await startTurn(AGENT, TOKEN, {
      tool: 'get_balance',
      arguments: {},
      channel: 'web',
    });

    expect(result).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports a missing token as unavailable rather than sending an anonymous request', async () => {
    // A request with no credential comes back 401, which in the interface is
    // indistinguishable from a session that expired mid-conversation.
    const spy = stubFetch(() => json(401, { error: 'unauthorized' }));

    const result = await startTurn(AGENT, undefined, {
      tool: 'get_balance',
      arguments: {},
      channel: 'web',
    });

    expect(result).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the runtime’s own error word on a refusal', async () => {
    stubFetch(() => json(400, { error: 'unknown_tool', message: 'No tool called "fly"' }));

    const result = await startTurn(AGENT, TOKEN, { tool: 'fly', arguments: {}, channel: 'web' });

    expect(result).toEqual({ ok: false, kind: 'http', status: 400, error: 'unknown_tool' });
  });

  it('reports a network failure as unreachable, not as an HTTP status', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });

    const result = await startTurn(AGENT, TOKEN, {
      tool: 'get_balance',
      arguments: {},
      channel: 'web',
    });

    expect(result).toEqual({ ok: false, kind: 'unreachable', detail: 'ECONNREFUSED' });
  });

  it('survives an error body that is not JSON', async () => {
    stubFetch(() => new Response('<html>502</html>', { status: 502 }));

    const result = await startTurn(AGENT, TOKEN, {
      tool: 'get_balance',
      arguments: {},
      channel: 'web',
    });

    expect(result).toEqual({ ok: false, kind: 'http', status: 502, error: 'unknown_error' });
  });

  it('strips a trailing slash from the configured URL', async () => {
    vi.stubEnv(RUNTIME_URL_ENV, 'http://runtime.test:8080/');
    const spy = stubFetch(() => json(202, { turnId: 't', status: 'queued', poll: '/turns/t' }));

    await startTurn(AGENT, TOKEN, { tool: 'get_balance', arguments: {}, channel: 'web' });

    expect(String(spy.mock.calls[0]![0])).toBe(`http://runtime.test:8080/agents/${AGENT}/turns`);
  });
});

describe('readTurn', () => {
  it('returns the turn as the runtime sent it', async () => {
    const view = {
      turnId: 'turn-1',
      agentId: AGENT,
      channel: 'web',
      status: 'done',
      outcome: 'refused_by_limen',
      request: { kind: 'tool', tool: 'send_payment', arguments: {} },
      result: { outcome: 'refused_by_limen', summary: 'over the per-transaction cap' },
      createdAt: '2026-08-23T07:00:00.000Z',
      startedAt: '2026-08-23T07:00:01.000Z',
      finishedAt: '2026-08-23T07:00:09.000Z',
    };
    const spy = stubFetch(() => json(200, view));

    const result = await readTurn('turn-1', TOKEN);

    expect(result).toEqual({ ok: true, value: view });
    expect(String(spy.mock.calls[0]![0])).toBe('http://runtime.test:8080/turns/turn-1');
    expect((spy.mock.calls[0]![1] as RequestInit).method).toBe('GET');
  });

  it('passes a 404 through as an HTTP failure', async () => {
    stubFetch(() => json(404, { error: 'not_found' }));

    expect(await readTurn('nope', TOKEN)).toEqual({
      ok: false,
      kind: 'http',
      status: 404,
      error: 'not_found',
    });
  });
});
