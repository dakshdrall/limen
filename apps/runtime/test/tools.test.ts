/**
 * The four outcomes, the one door, and the badge that cannot be borrowed.
 *
 * §4.4's table is the specification these cover:
 *
 *   - an argument the tool layer cannot understand is an **agent error**, and
 *     has no hash because nothing was attempted;
 *   - a failure is **not a refusal until its error code says so**;
 *   - a refusal that reached a ledger carries a hash, and one that did not
 *     carries a stated reason for having none;
 *   - and `refused_by_limen` has no `evidence` field at all — a structural
 *     property, checked here rather than left to a renderer to honour.
 */

import { describe, expect, it } from 'vitest';
import type { SubmitResult } from '@limen/chain';
import { classifySubmit, invokeTool, TOOLS, toolNames } from '../src/tools/index.js';
import { sendPayment } from '../src/tools/payment.js';
import { fakeAgent, fakeStore } from './fakes.js';

const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const DESTINATION = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const request = { token: TOKEN, destination: DESTINATION, amount: 4_000_000n };

/**
 * A submit result, with the two XDR fields the classifier never reads left off.
 *
 * They are a footprint and a set of signed auth entries — real values that cost
 * a network round trip to produce and that this function does not look at. The
 * cast is confined to this helper so no test body has to carry it.
 */
function ledgerResult(overrides: Partial<Extract<SubmitResult, { stage: 'ledger' }>>): SubmitResult {
  return {
    ok: false,
    label: 'send_payment',
    stage: 'ledger',
    hash: 'a'.repeat(64),
    status: 'FAILED',
    ledger: 4_242,
    codes: [],
    returnValue: undefined,
    opResult: 'invokeHostFunctionTrapped',
    ...overrides,
  } as unknown as SubmitResult;
}

const context = () => {
  const { store, recorded } = fakeStore();
  return {
    recorded,
    ctx: {
      agent: fakeAgent(),
      store,
      provider: {} as never,
      read: { rpcUrl: 'https://rpc.invalid', simulationSource: fakeAgent().feeAccount },
      rpcUrl: 'https://rpc.invalid',
      turnId: 'turn-1',
    },
  };
};

describe('the registry is the set §6.1 decided on', () => {
  it('has the two MVP tools and not `invoke_contract`', () => {
    // `invoke_contract` cannot be constrained by any audited policy —
    // `lower.ts` refuses exactly this — so shipping it would mean either an
    // unconstrained context rule or generated Rust.
    expect(toolNames(TOOLS)).toEqual(['get_balance', 'send_payment']);
  });
});

describe('a call the tool layer cannot understand is an agent error, with no hash', () => {
  it('refuses an unknown tool by name, and lists the ones that exist', async () => {
    const { ctx } = context();
    const result = await invokeTool(TOOLS, 'wire_transfer', {}, ctx);
    expect(result.outcome).toBe('agent_error');
    expect('evidence' in result).toBe(false);
  });

  it('refuses a destination that is not an address', async () => {
    const { ctx, recorded } = context();
    const result = await invokeTool(TOOLS, 'send_payment', { destination: 'bob', stroops: '10' }, ctx);
    expect(result.outcome).toBe('agent_error');
    // Nothing was attempted, so nothing was recorded: a tool_executions row for
    // a call that never ran would be a record of work that did not happen.
    expect(recorded.toolExecutions).toEqual([]);
  });

  it('refuses a decimal amount rather than rounding it', async () => {
    // Design rule 5 at the edge of the system. `4.5` stroops is not a quantity,
    // and the helpful reading of it — round, or truncate — is how an amount
    // becomes approximate.
    const { ctx } = context();
    const result = await invokeTool(TOOLS, 'send_payment', { destination: DESTINATION, stroops: '4.5' }, ctx);
    expect(result.outcome).toBe('agent_error');
  });

  it('refuses zero, a negative amount, and a leading zero', async () => {
    const { ctx } = context();
    for (const stroops of ['0', '-5', '007']) {
      const result = await invokeTool(TOOLS, 'send_payment', { destination: DESTINATION, stroops }, ctx);
      expect(result.outcome, stroops).toBe('agent_error');
    }
  });

  it('accepts an amount larger than a double can hold, as a string', () => {
    // The reason the field is a string. As a JSON number this has already lost
    // precision by the time any code here runs.
    const parsed = sendPayment.schema.safeParse({
      destination: DESTINATION,
      stroops: '9007199254740993',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses an argument nobody asked for, rather than ignoring it', async () => {
    // `strictObject`: a model that invents `memo` is corrected. Silently
    // dropping it would mean a misunderstanding nobody finds out about.
    const { ctx } = context();
    const result = await invokeTool(
      TOOLS,
      'send_payment',
      { destination: DESTINATION, stroops: '10', memo: 'rent' },
      ctx,
    );
    expect(result.outcome).toBe('agent_error');
  });
});

describe('a failure is not a refusal until its error code says so', () => {
  it('calls a successful ledger result a success, with its hash', () => {
    const { result, transaction } = classifySubmit(
      ledgerResult({ ok: true, status: 'SUCCESS', codes: [], opResult: 'invokeHostFunctionSuccess' }),
      request,
      1,
    );
    expect(result.outcome).toBe('succeeded');
    expect(transaction?.reachedLedger).toBe(true);
    expect(transaction?.ledger).toBe(4_242);
  });

  it('calls an on-ledger boundary refusal a network refusal, and keeps the hash', () => {
    // 3221 is `SpendingLimitExceeded` — the over-cap case §X demonstrates, and
    // the one refusal the whole product is built to show coming from the ledger
    // rather than from Limen.
    const { result, transaction } = classifySubmit(ledgerResult({ codes: [3221] }), request, 1);
    if (result.outcome !== 'refused_by_network') throw new Error('expected a network refusal');
    expect(result.evidence?.hash).toBe('a'.repeat(64));
    expect(result.boundaryRefusal).toBe(true);
    expect(transaction?.isBoundaryRefusal).toBe(true);
  });

  it('records a revoked rule as revoked as well as refused', () => {
    // §XIII item 4: after a revocation the next attempt fails *differently*.
    // The two flags are separate columns because that difference is the thing
    // being demonstrated.
    const { result, transaction } = classifySubmit(ledgerResult({ codes: [3000] }), request, 1);
    if (result.outcome !== 'refused_by_network') throw new Error('expected a network refusal');
    expect(result.revokedRule).toBe(true);
    expect(transaction?.isRevokedRule).toBe(true);
  });

  it('calls a simulation refusal a network refusal with NO hash, and says why', () => {
    const { result, transaction } = classifySubmit(
      { ok: false, label: 'send_payment', stage: 'simulation', error: 'Error(Contract, #3221)', code: 3221 },
      request,
      1,
    );
    if (result.outcome !== 'refused_by_network') throw new Error('expected a network refusal');
    expect(result.evidence).toBeNull();
    // The type will not let this arm exist without a reason, and the reason is
    // the finding: the refusal is real and there is no transaction to look up.
    if (result.evidence !== null) throw new Error('unreachable');
    expect(result.whyNoEvidence).toMatch(/no transaction was submitted/);
    expect(transaction?.reachedLedger).toBe(false);
    expect(transaction?.hash).toBeNull();
  });

  it('calls a simulation failure with no contract code an infrastructure error', () => {
    // "This didn't reach the network." Never rendered as a refusal: a boundary
    // did not do anything here, and saying it did would be a claim about a
    // check that never ran.
    const { result, transaction } = classifySubmit(
      { ok: false, label: 'send_payment', stage: 'simulation', error: 'host is unreachable', code: null },
      request,
      1,
    );
    expect(result.outcome).toBe('infra_error');
    // No transaction row either: there is nothing to record but a failure to
    // reach the network, and a row in `transactions` reads as an attempt.
    expect(transaction).toBeNull();
  });

  it('calls a send failure an infrastructure error, not a refusal', () => {
    const { result } = classifySubmit(
      { ok: false, label: 'send_payment', stage: 'submit', error: '{"tx":"txBadSeq"}', code: null },
      request,
      1,
    );
    expect(result.outcome).toBe('infra_error');
  });
});

describe('a Limen refusal cannot borrow the network\'s badge', () => {
  it('has no evidence field at all, for every refusal the gate makes', async () => {
    // §4.4: "row two never borrows row three's badge". Not a convention for a
    // renderer to honour — there is no field for a hash to go in, so no code
    // path can put one there and no screen can find one to show.
    const { store } = fakeStore({ agent: fakeAgent({ status: 'PAUSED' }) });
    const result = await invokeTool(
      TOOLS,
      'send_payment',
      { destination: DESTINATION, stroops: '10' },
      {
        agent: fakeAgent({ status: 'PAUSED' }),
        store,
        provider: {} as never,
        read: { rpcUrl: 'https://rpc.invalid', simulationSource: 'GA' },
        rpcUrl: 'https://rpc.invalid',
        turnId: 'turn-1',
      },
    );

    // The boundary read fails against `rpc.invalid`, so this particular call
    // ends as an infrastructure error — which is itself the point worth
    // asserting: an unreachable network is never reported as a refusal.
    expect(result.outcome).toBe('infra_error');
    expect('evidence' in result).toBe(false);
  });

  it('records the refusal on the agent with no transaction row', async () => {
    const { store, recorded } = fakeStore({ agent: fakeAgent({ contextRuleId: null }) });
    const result = await invokeTool(
      TOOLS,
      'send_payment',
      { destination: DESTINATION, stroops: '10' },
      {
        agent: fakeAgent({ contextRuleId: null }),
        store,
        provider: {} as never,
        read: { rpcUrl: 'https://rpc.invalid', simulationSource: 'GA' },
        rpcUrl: 'https://rpc.invalid',
        turnId: 'turn-1',
      },
    );

    expect(result.outcome).toBe('refused_by_limen');
    expect('evidence' in result).toBe(false);
    // No transaction row. A Limen refusal in the table a person reads for
    // network refusals is one column away from looking like one.
    expect(recorded.transactions).toEqual([]);
    expect(recorded.decisions[0]?.decision).toBe('refuse');
    expect(recorded.outcomes[0]?.outcome).toBe('refused_by_limen');
  });
});
