/**
 * What a described agent may say, and what it may not.
 *
 * Two failures are worth more than the rest of this file put together, and
 * both of them are quiet:
 *
 *   1. **An amount that loses a digit.** A cap of `1.005` on an asset with two
 *      decimals must be refused, not rounded to `1.00`. Rounded, the number on
 *      the review screen and the number installed on the chain are different
 *      numbers, and every label is still correct.
 *   2. **An off-chain field treated as on-chain.** `validate` puts recipients
 *      and the per-payment ceiling in a separate object from the cap, and
 *      nothing that reaches `synthesize` may carry them. A test that only
 *      checked the values would pass while the partition rotted.
 *
 * The rest is boundary conditions on a form, which matter less but fail more
 * often.
 */

import { describe, expect, it } from 'vitest';
import { synthesize } from '@limen/core';
import {
  DEFAULT_ASSET_DECIMALS,
  EXPIRY_OPTIONS,
  LEDGERS_PER_DAY,
  MAX_RECIPIENTS,
  WINDOW_OPTIONS,
  DESCRIBED_SOURCE,
  compileToObservation,
  emptyDraft,
  fromSmallestUnits,
  resolveExpiry,
  resolveWindow,
  synthesisOptionsFor,
  toSmallestUnits,
  validate,
  windowOutlivesExpiry,
  type AgentConfigDraft,
} from '@/lib/agent-config';

const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const ACCOUNT = 'CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V';
const SUPPLIER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUFXH';
const OTHER_SUPPLIER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/** A draft that validates, so each test can break exactly one thing. */
function goodDraft(overrides: Partial<AgentConfigDraft> = {}): AgentConfigDraft {
  return {
    ...emptyDraft(),
    name: 'Supplier payments',
    description: 'an agent that can pay approved suppliers up to 50 USDC',
    assetLabel: 'USDC',
    assetContractId: TOKEN,
    cap: '50',
    ...overrides,
  };
}

/** The problems for one field, as messages. */
function problemsFor(draft: AgentConfigDraft, field: keyof AgentConfigDraft): string[] {
  const result = validate(draft);
  if (result.ok) return [];
  return result.problems.filter((problem) => problem.field === field).map((problem) => problem.message);
}

describe('an amount is refused rather than rounded', () => {
  it('scales a whole amount by the asset’s decimals', () => {
    expect(toSmallestUnits('50', 7)).toBe('500000000');
    expect(toSmallestUnits('50', 2)).toBe('5000');
    expect(toSmallestUnits('50', 0)).toBe('50');
  });

  it('scales a fractional amount exactly', () => {
    expect(toSmallestUnits('0.5', 7)).toBe('5000000');
    expect(toSmallestUnits('1.0000001', 7)).toBe('10000001');
    expect(toSmallestUnits('0', 7)).toBe('0');
  });

  it('refuses a precision the asset cannot express', () => {
    // The whole point. Two decimals cannot hold a third, and `1.00` is a
    // different cap from `1.005`.
    expect(toSmallestUnits('1.005', 2)).toBeNull();
    expect(toSmallestUnits('0.00000001', 7)).toBeNull();
  });

  it('refuses everything that is not a plain non-negative decimal', () => {
    for (const bad of ['', '-1', '1e6', '1,000', ' ', '.5', '1.', 'fifty', '01', 'Infinity', 'NaN']) {
      expect(toSmallestUnits(bad, 7), `${JSON.stringify(bad)} was accepted`).toBeNull();
    }
  });

  it('refuses a decimals value that is not a place count', () => {
    for (const bad of [-1, 1.5, 19, Number.NaN]) {
      expect(toSmallestUnits('1', bad), `decimals ${bad} was accepted`).toBeNull();
    }
  });

  it('round-trips back to what a person typed', () => {
    for (const [amount, decimals] of [
      ['50', 7],
      ['0.5', 7],
      ['1.0000001', 7],
      ['0', 7],
      ['123.45', 2],
      ['7', 0],
    ] as const) {
      const units = toSmallestUnits(amount, decimals);
      expect(units).not.toBeNull();
      expect(fromSmallestUnits(units as string, decimals)).toBe(amount);
    }
  });
});

describe('the two halves stay apart', () => {
  it('puts the cap on chain and the ceiling and recipients off it', () => {
    const result = validate(
      goodDraft({ perTransactionCap: '10', recipients: [SUPPLIER, OTHER_SUPPLIER] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.onChain).toEqual({
      assetContractId: TOKEN,
      cap: '500000000',
      windowLedgers: LEDGERS_PER_DAY,
      validityLedgers: 30 * LEDGERS_PER_DAY,
    });
    expect(result.config.enforcedOffChain).toEqual({
      perTransactionCap: '100000000',
      recipients: [SUPPLIER, OTHER_SUPPLIER],
      // Both empty here because this draft configures a payment agent: no
      // output asset means no pair, and no pair means Limen refuses every
      // swap — which is the safe direction and the same one `recipients`
      // takes. A trading draft is covered separately below.
      allowedPairs: [],
      maxPositionSize: null,
    });
  });

  it('keeps every off-chain field out of the object that reaches the chain', () => {
    // Structural, not by value. A refactor that moved `recipients` up beside
    // `cap` would keep every assertion above passing and would put an
    // unenforced constraint into the half the network refuses.
    const result = validate(goodDraft({ perTransactionCap: '10', recipients: [SUPPLIER] }));
    if (!result.ok) throw new Error('expected a valid config');

    const onChainKeys = Object.keys(result.config.onChain);
    expect(onChainKeys).not.toContain('recipients');
    expect(onChainKeys).not.toContain('perTransactionCap');
    expect(new Set(onChainKeys)).toEqual(
      new Set(['assetContractId', 'cap', 'windowLedgers', 'validityLedgers']),
    );
  });

  it('carries the asset label as display only, never as an address', () => {
    const result = validate(goodDraft({ assetLabel: 'USDC' }));
    if (!result.ok) throw new Error('expected a valid config');
    expect(result.config.display.assetLabel).toBe('USDC');
    expect(JSON.stringify(result.config.onChain)).not.toContain('USDC');
  });
});

describe('the asset contract is pasted, never guessed', () => {
  it('refuses an empty contract id and says why', () => {
    const messages = problemsFor(goodDraft({ assetContractId: '' }), 'assetContractId');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('will not guess');
  });

  it('refuses anything that is not a C-address', () => {
    for (const bad of [SUPPLIER, 'C', 'CDLZ', TOKEN.toLowerCase(), `${TOKEN}X`]) {
      expect(problemsFor(goodDraft({ assetContractId: bad }), 'assetContractId')).toHaveLength(1);
    }
  });

  it('defaults decimals to 7 and lets a person change it', () => {
    expect(emptyDraft().assetDecimals).toBe(String(DEFAULT_ASSET_DECIMALS));

    const result = validate(goodDraft({ assetDecimals: '2', cap: '50' }));
    if (!result.ok) throw new Error('expected a valid config');
    expect(result.config.onChain.cap).toBe('5000');
  });

  it('blames the decimals field alone when decimals are wrong', () => {
    // Not the amount. An amount that cannot be scaled because the scale is
    // broken is not a bad amount, and saying so would send the user to fix the
    // wrong input.
    const draft = goodDraft({ assetDecimals: '99', cap: '50' });
    expect(problemsFor(draft, 'assetDecimals')).toHaveLength(1);
    expect(problemsFor(draft, 'cap')).toHaveLength(0);
  });
});

describe('a cap has to be a cap', () => {
  it('refuses an absent one', () => {
    expect(problemsFor(goodDraft({ cap: '' }), 'cap')).toHaveLength(1);
  });

  it('refuses zero, because there would be no agent to deploy', () => {
    expect(problemsFor(goodDraft({ cap: '0' }), 'cap')).toHaveLength(1);
  });

  it('refuses a precision the asset cannot hold, on the field', () => {
    const messages = problemsFor(goodDraft({ assetDecimals: '2', cap: '1.005' }), 'cap');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('refuses rather than rounding');
  });
});

describe('a per-payment ceiling that cannot bind is refused', () => {
  it('accepts one below the window cap', () => {
    const result = validate(goodDraft({ cap: '50', perTransactionCap: '10' }));
    expect(result.ok).toBe(true);
  });

  it('refuses one above the window cap', () => {
    // It would never apply, and a limit that cannot apply reads as protection
    // that is not there.
    expect(problemsFor(goodDraft({ cap: '50', perTransactionCap: '60' }), 'perTransactionCap')).toHaveLength(1);
  });

  it('treats empty as no ceiling rather than as zero', () => {
    const result = validate(goodDraft({ perTransactionCap: '' }));
    if (!result.ok) throw new Error('expected a valid config');
    expect(result.config.enforcedOffChain.perTransactionCap).toBeNull();
  });

  it('refuses an explicit zero and points at the empty field instead', () => {
    expect(problemsFor(goodDraft({ perTransactionCap: '0' }), 'perTransactionCap')).toHaveLength(1);
  });
});

describe('recipients are addresses or they are refusals', () => {
  it('accepts G and C addresses', () => {
    const result = validate(goodDraft({ recipients: [SUPPLIER, TOKEN] }));
    if (!result.ok) throw new Error('expected a valid config');
    expect(result.config.enforcedOffChain.recipients).toEqual([SUPPLIER, TOKEN]);
  });

  it('names the value it refused rather than reporting a count', () => {
    const messages = problemsFor(goodDraft({ recipients: ['alice'] }), 'recipients');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('alice');
  });

  it('drops blanks and duplicates without complaining about them', () => {
    // A trailing empty row is what a list editor looks like mid-edit, and a
    // duplicate is a paste. Neither is a mistake worth a refusal.
    const result = validate(goodDraft({ recipients: [SUPPLIER, '', '  ', SUPPLIER] }));
    if (!result.ok) throw new Error('expected a valid config');
    expect(result.config.enforcedOffChain.recipients).toEqual([SUPPLIER]);
  });

  it('refuses a list longer than a person reads', () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, index) =>
      // Distinct, well-formed, and unimportant: the length is what is under test.
      `G${'A'.repeat(54)}${String.fromCharCode(65 + (index % 26))}`,
    );
    expect(problemsFor(goodDraft({ recipients: many }), 'recipients')).toHaveLength(1);
  });
});

describe('the window cannot outlive the rule', () => {
  it('accepts a daily window on a 30-day agent', () => {
    expect(validate(goodDraft({ windowId: 'daily', expiryId: '30d' })).ok).toBe(true);
  });

  it('accepts a weekly window on a 7-day agent, which is the same span', () => {
    // `weekly` is 120,960 ledgers and `7d` is 7 × 17,280 — the same number. The
    // cap resets exactly as the rule expires, which is legal: the guard is
    // `>`, not `>=`.
    expect(validate(goodDraft({ windowId: 'weekly', expiryId: '7d' })).ok).toBe(true);
  });

  /**
   * The guard is dormant, and this says so rather than pretending to fire it.
   *
   * No pair from the two tables can make a window outlive an expiry — the
   * longest window is `weekly` and the shortest expiry is `7d`, and those are
   * equal. So a test that "exercised" the refusal would have to reach it
   * through some *other* invalid field, which is a test passing for the wrong
   * reason. An earlier draft of this file did exactly that, by way of an
   * unrecognised expiry id.
   *
   * What is worth pinning is the invariant itself. The guard exists because
   * `synthesize` throws on `windowLedgers > validityLedgers`, and catching it
   * here is what puts the reason on the field instead of in a synthesis error.
   * Adding a `monthly` window, or a `1d` expiry, makes it reachable — and this
   * assertion is what tells whoever does that the guard has just come alive.
   */
  it('keeps every window inside every expiry, so the guard stays unreachable', () => {
    const violations = WINDOW_OPTIONS.flatMap((window) =>
      EXPIRY_OPTIONS.filter((expiry) => window.ledgers > expiry.ledgers).map(
        (expiry) => `${window.id} (${window.ledgers}) outlives ${expiry.id} (${expiry.ledgers})`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it('fires the guard itself, against numbers the tables do not ship', () => {
    // The predicate is exported precisely so this is possible. Without it the
    // refusal below would be unreachable and untested until the day a longer
    // window made it matter.
    expect(windowOutlivesExpiry(2, 1)).toBe(true);
    expect(windowOutlivesExpiry(1, 2)).toBe(false);
    // Equal is legal: the cap resets as the rule expires. This is the
    // `weekly` / `7d` pair, and it is why the comparison is `>` and not `>=`.
    expect(windowOutlivesExpiry(1, 1)).toBe(false);
  });

  it('offers only windows and expiries from the closed tables', () => {
    expect(resolveWindow('daily')).toBeDefined();
    expect(resolveWindow('fortnightly')).toBeUndefined();
    expect(resolveExpiry('30d')).toBeDefined();
    expect(resolveExpiry('forever')).toBeUndefined();

    // No unbounded option. An agent key is a key somebody holds, and expiry is
    // what stops that mattering.
    expect(EXPIRY_OPTIONS.every((option) => option.ledgers > 0)).toBe(true);
    expect(WINDOW_OPTIONS.every((option) => option.ledgers > 0)).toBe(true);
  });

  it('refuses an unrecognised option id rather than falling back to a default', () => {
    // A silent fallback would install a boundary the user did not choose.
    expect(problemsFor(goodDraft({ windowId: 'monthly' }), 'windowId')).toHaveLength(1);
    expect(problemsFor(goodDraft({ expiryId: 'never' }), 'expiryId')).toHaveLength(1);
  });
});

describe('a name is required and bounded', () => {
  it('refuses an empty name', () => {
    expect(problemsFor(goodDraft({ name: '   ' }), 'name')).toHaveLength(1);
  });

  it('trims rather than refusing surrounding space', () => {
    const result = validate(goodDraft({ name: '  Supplier payments  ' }));
    if (!result.ok) throw new Error('expected a valid config');
    expect(result.config.name).toBe('Supplier payments');
  });

  it('refuses one too long to render', () => {
    expect(problemsFor(goodDraft({ name: 'x'.repeat(65) }), 'name')).toHaveLength(1);
  });
});

describe('every refusal arrives at once', () => {
  it('reports each broken field rather than the first', () => {
    const result = validate({
      ...emptyDraft(),
      name: '',
      cap: '',
      assetContractId: '',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(new Set(result.problems.map((problem) => problem.field))).toEqual(
      new Set(['name', 'cap', 'assetContractId']),
    );
  });
});

describe('a config compiles into the pipeline that already exists', () => {
  it('derives the cap the user reviewed, to the unit', () => {
    const result = validate(goodDraft({ cap: '50' }));
    if (!result.ok) throw new Error('expected a valid config');

    const observed = compileToObservation(result.config, { atLedger: 1_000_000 });
    const proposal = synthesize(observed, synthesisOptionsFor(result.config));

    const limit = proposal.policies.find((policy) => policy.kind === 'spending_limit');
    expect(limit).toEqual({
      kind: 'spending_limit',
      asset: TOKEN,
      limit: '500000000',
      windowLedgers: LEDGERS_PER_DAY,
    });
  });

  it('derives exactly the transfer allowlist that lowering accepts', () => {
    // `lower.ts` refuses any function allowlist that is not exactly
    // `['transfer']`, because that is the only one `spending_limit` subsumes.
    // A compiled observation naming any other function would be refused at
    // install, after the user had reviewed it.
    const result = validate(goodDraft());
    if (!result.ok) throw new Error('expected a valid config');

    const proposal = synthesize(
      compileToObservation(result.config, { atLedger: 1_000_000 }),
      synthesisOptionsFor(result.config),
    );
    expect(proposal.contextRule.allowedFunctions).toEqual({ [TOKEN]: ['transfer'] });
    expect(proposal.contextRule.allowedContracts).toEqual([TOKEN]);
  });

  it('says the observation is simulated, so nothing reports it as a transaction', () => {
    const result = validate(goodDraft());
    if (!result.ok) throw new Error('expected a valid config');

    const observed = compileToObservation(result.config, { atLedger: 1_000_000 });
    expect(observed.network).toBe('simulated');
    // No hash, because none exists. `policies.observed_tx_hash` stays null for
    // a described agent and the absence is the record that nothing was observed.
    expect(observed.hash).toBe('');
  });

  it('sets the rule’s validity from the chosen expiry, counted at the given ledger', () => {
    const result = validate(goodDraft({ expiryId: '7d' }));
    if (!result.ok) throw new Error('expected a valid config');

    const proposal = synthesize(
      compileToObservation(result.config, { atLedger: 2_000_000 }),
      synthesisOptionsFor(result.config),
    );
    expect(proposal.contextRule.validFromLedger).toBe(2_000_000);
    expect(proposal.contextRule.validUntilLedger).toBe(2_000_000 + 7 * LEDGERS_PER_DAY);
  });

  it('applies no headroom, so the installed cap is the reviewed number', () => {
    // Headroom exists so a boundary derived from one observed payment is not so
    // tight the next ordinary one trips it. A described agent has no
    // observation to be tight against — the user stated the limit, and the
    // number they read must be the number installed.
    const result = validate(goodDraft({ cap: '50' }));
    if (!result.ok) throw new Error('expected a valid config');
    expect(synthesisOptionsFor(result.config).headroomBps).toBe(10_000);
  });

  it('derives the same boundary whatever account it is derived for', () => {
    /**
     * The claim `compileToObservation` rests on, checked rather than asserted.
     *
     * The review step derives a proposal before a smart account exists, and the
     * deploy step installs *that* proposal rather than re-deriving one. That is
     * only sound if the account plays no part in the derivation. `synthesize`
     * reads `source` solely to decide which movements are outflows and never
     * copies it into the result — so the same config must produce a
     * byte-identical proposal for any account, including the sentinel.
     *
     * If this ever fails, the deploy step must stop installing a stored
     * proposal and start re-deriving against the real account.
     */
    const result = validate(goodDraft());
    if (!result.ok) throw new Error('expected a valid config');

    const options = synthesisOptionsFor(result.config);
    const fromSentinel = synthesize(
      compileToObservation(result.config, { atLedger: 1_000_000 }),
      options,
    );

    for (const source of [ACCOUNT, SUPPLIER, DESCRIBED_SOURCE, 'anything at all']) {
      const observed = {
        ...compileToObservation(result.config, { atLedger: 1_000_000 }),
        source,
        movements: [
          { asset: TOKEN, from: source, to: source, amount: result.config.onChain.cap },
        ],
      };
      expect(JSON.stringify(synthesize(observed, options))).toBe(JSON.stringify(fromSentinel));
    }
  });

  it('names no address at all in a described observation', () => {
    // The sentinel is written to be obviously wrong if it ever reaches a
    // screen. A placeholder that looked like an address would be a bug that
    // renders as data.
    expect(DESCRIBED_SOURCE).not.toMatch(/^[GC][A-Z2-7]{55}$/);

    const result = validate(goodDraft());
    if (!result.ok) throw new Error('expected a valid config');
    const observed = compileToObservation(result.config, { atLedger: 1_000_000 });
    expect(observed.source).toBe(DESCRIBED_SOURCE);
  });

  it('carries no recipient into the derivation', () => {
    // The compiled observation must not name an approved recipient anywhere.
    // A destination inside the derivation would read as a constraint the
    // installed rule does not impose.
    const result = validate(goodDraft({ recipients: [SUPPLIER, OTHER_SUPPLIER] }));
    if (!result.ok) throw new Error('expected a valid config');

    const observed = compileToObservation(result.config, { atLedger: 1_000_000 });
    expect(JSON.stringify(observed)).not.toContain(SUPPLIER);
    expect(JSON.stringify(observed)).not.toContain(OTHER_SUPPLIER);
  });
});

/**
 * The two constraints a trading agent adds, and the one thing they must not be.
 *
 * `allowedPairs` and `maxPositionSize` are Limen's, because the account cannot
 * see either — it sees an amount and a period, never which asset came back and
 * never a per-call ceiling. So they are collected here, validated here, and
 * rendered on the deploy screen; a limit collected and never shown is the
 * per-transaction-ceiling gap repeated.
 *
 * What they must not become is a second cap. The window cap is the network's
 * and it refuses on a ledger with a code and a hash — PLAN-V8 C0 measured it —
 * so nothing below compares an amount against it.
 */
describe('a trading draft carries the two limits the account cannot see', () => {
  const XLM_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
  const USDC_CONTRACT = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';

  const trading = () => ({
    ...emptyDraft(),
    name: 'Dip buyer',
    description: 'buy XLM whenever the price drops 5%, spend at most 20 USDC a day',
    assetContractId: USDC_CONTRACT,
    assetLabel: 'USDC',
    assetDecimals: '7',
    cap: '20',
    outputAssetContractId: XLM_CONTRACT,
    outputAssetLabel: 'XLM',
    maxPositionSize: '5',
  });

  it('builds the pair from the token it spends and the token it buys', () => {
    const result = validate(trading());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.enforcedOffChain.allowedPairs).toEqual([`${USDC_CONTRACT}/${XLM_CONTRACT}`]);
    expect(result.config.enforcedOffChain.maxPositionSize).toBe('50000000');
  });

  it('refuses a pair of one token', () => {
    const result = validate({ ...trading(), outputAssetContractId: USDC_CONTRACT });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((p) => p.field === 'outputAssetContractId')).toBe(true);
  });

  it('refuses an output asset that is not a contract address', () => {
    const result = validate({ ...trading(), outputAssetContractId: 'not-an-address' });
    expect(result.ok).toBe(false);
  });

  it('allows a position size above the window cap, because the network refuses first', () => {
    // Deliberately NOT refused, and the asymmetry with `perTransactionCap` is
    // the point. That one is refused above the cap because it could never bind
    // and would read as protection that is not there. A position size above
    // the cap is the same shape — but the cap here is the *network's*, and
    // Limen having an opinion about a number the chain already governs is the
    // inversion this project exists to avoid. It simply never binds.
    const result = validate({ ...trading(), maxPositionSize: '999' });
    expect(result.ok).toBe(true);
  });

  it('leaves a payment draft with no pair and no position size', () => {
    const result = validate({ ...trading(), outputAssetContractId: '', maxPositionSize: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.enforcedOffChain.allowedPairs).toEqual([]);
    expect(result.config.enforcedOffChain.maxPositionSize).toBeNull();
  });
});
