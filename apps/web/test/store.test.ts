/**
 * The store's job is to hold pointers and provenance and nothing else.
 *
 * The tests that matter here are the negative ones: that it does not hold chain
 * state, that a corrupt or future record is discarded rather than half-read,
 * and that a failed write is reported rather than presented as saved. Each of
 * those failures would render stale or invented data as current fact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAll,
  exportAll,
  forgetAccount,
  getAccount,
  getProvenance,
  listAccounts,
  rememberAccount,
  rememberProvenance,
  type StoredProvenance,
} from '../src/lib/store';

const ACCOUNT = 'CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V';
const OTHER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const KEY = 'limen.v1';

function memoryStorage(): Storage {
  let map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map = new Map();
    },
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  } as Storage;
}

const provenance = (overrides: Partial<StoredProvenance> = {}): StoredProvenance => ({
  observedTxHash: 'a'.repeat(64),
  observedLedger: 3_935_836,
  headroomBps: 10_000,
  windowLedgers: 17_280,
  validityLedgers: 120_960,
  installTxHash: 'b'.repeat(64),
  contextRuleId: 5,
  recordedAt: '2026-08-02T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: memoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accounts', () => {
  it('starts empty rather than throwing', () => {
    expect(listAccounts()).toEqual([]);
    expect(getAccount(ACCOUNT)).toBeUndefined();
  });

  it('remembers and returns an account', () => {
    expect(rememberAccount(ACCOUNT, 'c'.repeat(64))).toBe(true);
    expect(getAccount(ACCOUNT)?.contractId).toBe(ACCOUNT);
    expect(getAccount(ACCOUNT)?.deployTxHash).toBe('c'.repeat(64));
  });

  it('is idempotent, and keeps provenance when an address is re-added', () => {
    rememberAccount(ACCOUNT);
    rememberProvenance(ACCOUNT, provenance());
    const addedAt = getAccount(ACCOUNT)!.addedAt;

    rememberAccount(ACCOUNT);

    // Pasting the same address twice must not wipe the derivation history.
    expect(getAccount(ACCOUNT)!.addedAt).toBe(addedAt);
    expect(getProvenance(ACCOUNT, 5)).toBeDefined();
  });

  it('forgets one account without touching the others', () => {
    rememberAccount(ACCOUNT);
    rememberAccount(OTHER);
    forgetAccount(ACCOUNT);

    expect(getAccount(ACCOUNT)).toBeUndefined();
    expect(getAccount(OTHER)).toBeDefined();
  });

  it('treats forgetting an unknown account as already done', () => {
    expect(forgetAccount(ACCOUNT)).toBe(true);
  });
});

describe('provenance', () => {
  it('records the derivation, keyed by the on-chain rule id', () => {
    rememberAccount(ACCOUNT);
    rememberProvenance(ACCOUNT, provenance({ contextRuleId: 12 }));

    expect(getProvenance(ACCOUNT, 12)?.observedTxHash).toBe('a'.repeat(64));
    expect(getProvenance(ACCOUNT, 5)).toBeUndefined();
  });

  it('refuses provenance for an account this browser does not know', () => {
    // Otherwise the store holds a policy history belonging to no account, which
    // renders as an account with no address.
    expect(rememberProvenance(ACCOUNT, provenance())).toBe(false);
    expect(listAccounts()).toEqual([]);
  });

  it('keeps validFromLedger provenance local, which is the only place it exists', () => {
    rememberAccount(ACCOUNT);
    rememberProvenance(ACCOUNT, provenance({ observedLedger: 999 }));

    // An OpenZeppelin ContextRule has valid_until and no lower bound, so this
    // number is not recoverable from the chain. If the store stops holding it,
    // it is gone.
    expect(getProvenance(ACCOUNT, 5)?.observedLedger).toBe(999);
  });
});

describe('it holds no chain state', () => {
  it('records nothing about caps, spend, or liveness', () => {
    rememberAccount(ACCOUNT);
    rememberProvenance(ACCOUNT, provenance());

    const raw = JSON.stringify(exportAll());
    // Each of these is read from the ledger on every load. A cached copy is a
    // claim about the past rendered as the present: a rule revoked on another
    // device would still show as live.
    for (const forbidden of ['limit', 'spent', 'cap', 'validUntil', 'balance', 'live']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('bad storage is discarded, never half-read', () => {
  it('ignores a record written by a different version', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 99, accounts: { [ACCOUNT]: {} } }));
    expect(listAccounts()).toEqual([]);
  });

  it('ignores unparseable content', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(listAccounts()).toEqual([]);
  });

  it('ignores a record whose shape is wrong', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, accounts: null }));
    expect(listAccounts()).toEqual([]);
  });
});

describe('unavailable storage degrades rather than throws', () => {
  it('reads as empty during a server render', () => {
    vi.stubGlobal('window', undefined);
    expect(listAccounts()).toEqual([]);
    expect(exportAll().accounts).toEqual({});
  });

  it('reports a failed write instead of claiming it saved', () => {
    vi.stubGlobal('window', {
      localStorage: {
        ...memoryStorage(),
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    // The caller has to be able to tell the user their browser will not
    // remember this, rather than showing it as stored and losing it on reload.
    expect(rememberAccount(ACCOUNT)).toBe(false);
  });
});

describe('everything stored can be shown and cleared', () => {
  it('exports what it holds and clears on request', () => {
    rememberAccount(ACCOUNT);
    expect(Object.keys(exportAll().accounts)).toEqual([ACCOUNT]);

    expect(clearAll()).toBe(true);
    expect(listAccounts()).toEqual([]);
  });
});
