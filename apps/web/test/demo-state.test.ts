/**
 * The §0 invariant, made enforceable.
 *
 * The synthesizer is the only thing that produces policy. The stepper's
 * resumable state is the one place a derived value could plausibly be cached
 * "for speed" and then rendered on a later visit without `synthesize()` having
 * run — so the persisted shape is pinned by test.
 */

import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  LAST_BEAT,
  PERSISTED_KEYS,
  clearState,
  loadState,
  sanitise,
  saveState,
  serialise,
} from '@/lib/demo-state';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const HASH = 'a'.repeat(64);

describe('the persisted shape holds no derived values', () => {
  it('serialises exactly the allowlisted keys', () => {
    const written = JSON.parse(serialise({ version: 1, beat: 4, hash: HASH })) as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual([...PERSISTED_KEYS].sort());
  });

  it('allowlists only the beat index, the hash, and the version', () => {
    // If this list grows, it must grow deliberately. A proposal, a cap, a
    // policy, a rationale line, or an XDR payload must never appear here.
    expect([...PERSISTED_KEYS]).toEqual(['version', 'beat', 'hash']);
  });

  it('strips a derived value smuggled into stored state', () => {
    const storage = memoryStorage();
    storage.setItem(
      'limen.demo.v1',
      JSON.stringify({
        version: 1,
        beat: 3,
        hash: HASH,
        // Exactly the thing that must never survive a round trip.
        proposal: { policies: [{ kind: 'spending_limit', limit: '999999999' }] },
        cap: '999999999',
      }),
    );

    const loaded = loadState(storage) as unknown as Record<string, unknown>;
    expect(Object.keys(loaded).sort()).toEqual([...PERSISTED_KEYS].sort());
    expect(loaded).not.toHaveProperty('proposal');
    expect(loaded).not.toHaveProperty('cap');
  });

  it('never writes a smuggled field back out', () => {
    const storage = memoryStorage();
    saveState(storage, { version: 1, beat: 2, hash: HASH, proposal: {} } as never);
    const written = JSON.parse(storage.getItem('limen.demo.v1')!) as Record<string, unknown>;
    expect(written).not.toHaveProperty('proposal');
  });
});

describe('resume survives bad input rather than crashing on it', () => {
  it('starts fresh when nothing is stored', () => {
    expect(loadState(memoryStorage())).toEqual(INITIAL_STATE);
  });

  it('starts fresh on unparseable state', () => {
    const storage = memoryStorage();
    storage.setItem('limen.demo.v1', 'not json');
    expect(loadState(storage)).toEqual(INITIAL_STATE);
  });

  it('discards state from a different shape version', () => {
    expect(sanitise({ version: 99, beat: 3, hash: HASH })).toBeNull();
  });

  it('rejects an out-of-range beat', () => {
    expect(sanitise({ version: 1, beat: 0, hash: null })).toBeNull();
    expect(sanitise({ version: 1, beat: LAST_BEAT + 1, hash: null })).toBeNull();
    expect(sanitise({ version: 1, beat: 2.5, hash: null })).toBeNull();
  });

  it('accepts the last beat there is', () => {
    // The range widened from five to six when the simulator gained "could it be
    // installed?". Pinned against the constant rather than the literal, so the
    // stepper and the sanitiser cannot drift into a state where the last beat a
    // reviewer can reach is one the sanitiser throws away on reload.
    expect(sanitise({ version: 1, beat: LAST_BEAT, hash: HASH })).toEqual({
      version: 1,
      beat: LAST_BEAT,
      hash: HASH,
    });
  });

  it('still loads state written before the range widened', () => {
    // Widening the accepted range is backward compatible, so the version did
    // not move. A reviewer who left mid-run before step 10 comes back to where
    // they were rather than to a reset page.
    expect(sanitise({ version: 1, beat: 5, hash: HASH })).not.toBeNull();
  });

  it('rejects a hash that is not a transaction hash', () => {
    expect(sanitise({ version: 1, beat: 2, hash: 'nope' })).toBeNull();
    expect(sanitise({ version: 1, beat: 2, hash: HASH })).not.toBeNull();
    expect(sanitise({ version: 1, beat: 1, hash: null })).not.toBeNull();
  });

  it('clears cleanly', () => {
    const storage = memoryStorage();
    saveState(storage, { version: 1, beat: 5, hash: HASH });
    clearState(storage);
    expect(loadState(storage)).toEqual(INITIAL_STATE);
  });
});
