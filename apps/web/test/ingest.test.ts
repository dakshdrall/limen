/**
 * The ingest route's failure modes.
 *
 * §6 of PLAN-V2: a malformed hash, a nonexistent hash, a classic payment, and a
 * failed transaction must each produce a clear structured error — never a crash
 * and never a fabricated `ObservedTransaction`. The last of those is the one
 * that matters: a fabricated flow produces a real-looking policy for a
 * transaction that never happened.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservedTransaction } from '@limen/core';
import { POST } from '@/app/api/ingest/route';
import { REFUSAL_CODES, type IngestError } from '@/lib/ingest-contract';
import { clearCache } from '@/lib/tx-cache';

function post(body: unknown, ip = '203.0.113.1'): Request {
  return new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

async function errorOf(response: Response): Promise<IngestError['error']> {
  const payload = (await response.json()) as IngestError;
  return payload.error;
}

beforeEach(() => {
  clearCache();
  delete process.env.SOROBAN_RPC_URL;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fixtures resolve with no network access', () => {
  it('returns a shipped fixture by key', async () => {
    const response = await POST(post({ hash: 'simple-transfer' }));
    expect(response.status).toBe(200);
    const observed = (await response.json()) as ObservedTransaction;
    expect(observed.network).toBe('simulated');
    expect(observed.attribution).toBe('exact');
    expect(observed.movements).toHaveLength(1);
  });

  it('returns a shipped fixture by its full hash', async () => {
    const byKey = (await (await POST(post({ hash: 'swap-two-calls' }))).json()) as ObservedTransaction;
    const byHash = (await (await POST(post({ hash: byKey.hash }))).json()) as ObservedTransaction;
    expect(byHash).toEqual(byKey);
  });

  it('defaults to the demo fixture when no hash is given', async () => {
    const observed = (await (await POST(post({}))).json()) as ObservedTransaction;
    expect(observed.network).toBe('simulated');
  });
});

describe('malformed input is refused, never fabricated', () => {
  it('refuses a body that is not JSON', async () => {
    const request = new Request('http://localhost/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('bad_request');
  });

  it('refuses a malformed hash', async () => {
    const response = await POST(post({ hash: 'zzzz', network: 'testnet' }));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe('bad_request');
    expect(error.message).toContain('64 hexadecimal characters');
  });

  it('refuses a hash of the right shape but the wrong alphabet', async () => {
    const response = await POST(post({ hash: 'g'.repeat(64), network: 'testnet' }));
    expect((await errorOf(response)).code).toBe('bad_request');
  });

  it('refuses mainnet deliberately rather than treating it as testnet', async () => {
    const response = await POST(post({ hash: 'a'.repeat(64), network: 'mainnet' }));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('mainnet_out_of_scope');
  });

  it('refuses an unknown network', async () => {
    const response = await POST(post({ hash: 'a'.repeat(64), network: 'futurenet' }));
    expect((await errorOf(response)).code).toBe('unknown_network');
  });

  it('never returns a transaction body on any refusal', async () => {
    for (const body of [
      { hash: 'zzzz', network: 'testnet' },
      { hash: 'a'.repeat(64), network: 'mainnet' },
      { hash: 'a'.repeat(64), network: 'futurenet' },
    ]) {
      const payload = (await (await POST(post(body))).json()) as Record<string, unknown>;
      expect(payload).not.toHaveProperty('invocations');
      expect(payload).not.toHaveProperty('movements');
      expect(payload).toHaveProperty('error');
    }
  });
});

describe('an unconfigured deployment says so rather than falling back', () => {
  it('refuses a live lookup with rpc_unconfigured', async () => {
    const response = await POST(post({ hash: 'b'.repeat(64), network: 'testnet' }));
    expect(response.status).toBe(503);
    const error = await errorOf(response);
    expect(error.code).toBe('rpc_unconfigured');
    // Silently serving a fixture in place of the requested transaction would be
    // the worst possible fallback.
    expect(error.message).toContain('fixtures still work');
  });
});

describe('refusal codes are distinguishable from transport failures', () => {
  it('classifies extractor refusals as refusals and RPC problems as not', () => {
    expect(REFUSAL_CODES.has('no_invocations')).toBe(true);
    expect(REFUSAL_CODES.has('unreadable_movement')).toBe(true);
    expect(REFUSAL_CODES.has('unreadable_meta')).toBe(true);
    expect(REFUSAL_CODES.has('rpc_failed')).toBe(false);
    expect(REFUSAL_CODES.has('not_found')).toBe(false);
    expect(REFUSAL_CODES.has('rate_limited')).toBe(false);
  });
});
