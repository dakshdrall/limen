/**
 * What an account holds, read by simulation.
 *
 * PLAN-V8 §4.3 lists this as the one on-chain read the agent runtime needs that
 * did not exist: `get_balance` is the first tool a person uses and the only one
 * in §6.1 with no module behind it. Everything else the runtime calls —
 * `readAllContextRules`, `readSpendingLimit`, `readActivity`, `transferFunction`
 * — was already here.
 *
 * ## Why the token contract and not Horizon
 *
 * A smart account's XLM is held by the **Stellar Asset Contract**, not by a
 * classic account, so `GET /accounts/{id}` has nothing to say about it — the
 * contract id is not an account id and Horizon returns a 404 for one. The
 * balance lives in contract storage and `balance(id)` is how it is asked for.
 *
 * Using the SAC for a classic `G…` too is deliberate rather than incidental.
 * The agent's fee account is a classic account, and its XLM balance *is*
 * readable from Horizon — but reading two balances through two different
 * protocols would mean two failure modes, two clients, and two places for
 * "testnet" to be configured. `balance(G…)` on the native SAC returns the same
 * number, through the same call, at the same ledger.
 *
 * ## The ledger is returned with the number, and that is not decoration
 *
 * `schema.ts` rule 2 and `store.ts` before it: a cached copy of chain state is
 * a claim about the past rendered as the present. A balance is exactly that
 * kind of claim — it is stale the moment it is read — so every read here comes
 * back with the ledger it was taken at, and every surface that renders one has
 * the number it needs to say when. A caller that wants to store a balance has
 * `agent_accounts.fee_balance_last_seen` and its `*_ledger` companion, which is
 * the schema's one sanctioned denormalisation and is named so it can be found.
 */

import { Address, rpc } from '@stellar/stellar-sdk';
import { ContractReadError, simulateRead, type ReadOptions } from './read.js';

/** A balance, and the ledger it was true at. */
export interface BalanceRead {
  /** The token contract the balance was read from. */
  token: string;
  /** Whose balance: a contract `C…` or a classic `G…`. */
  holder: string;
  /** Smallest units. `bigint` because integer math only — design rule 5. */
  amount: bigint;
  /** The ledger this was read at. Every render of `amount` must state it. */
  ledger: number;
}

/**
 * `balance(id)` on a token contract.
 *
 * The SAC returns an `i128`, which `scValToNative` gives back as a `bigint`.
 * Anything else means the contract addressed is not a token, and that is worth
 * refusing loudly rather than coercing: `Number(...)` on a stray value would
 * produce a plausible balance out of something that was never one.
 */
export async function readBalance(
  options: ReadOptions,
  { token, holder }: { token: string; holder: string },
): Promise<BalanceRead> {
  const value = await simulateRead(options, token, 'balance', [new Address(holder).toScVal()]);
  return { token, holder, amount: decodeBalance(value, token), ledger: await latestLedger(options) };
}

/**
 * The returned value, checked rather than coerced.
 *
 * Separate and exported because it is the only decision in this file and the
 * network half cannot be unit-tested without a fake Soroban host — `read.ts`
 * declines to build one, and the reason holds here: a mock would prove this
 * file agrees with my idea of the host.
 *
 * `Number(value)` would be the convenient version and it is the bug: a `void`
 * return, a map, or a string all become a number, and two of those become `0` —
 * a perfectly plausible balance for an account that has never been funded. A
 * balance that is wrong in that direction reads as *"you have nothing"*, which
 * a person acts on.
 */
export function decodeBalance(value: unknown, token: string): bigint {
  if (typeof value === 'bigint') return value;
  throw new ContractReadError(
    token,
    'balance',
    `expected an i128 and got ${value === null ? 'null' : typeof value}; ` +
      `${token} does not look like a token contract`,
  );
}

/**
 * The current ledger sequence.
 *
 * Its own call rather than a field lifted off the simulation, because
 * `simulateTransaction`'s `latestLedger` is the ledger the *simulation* ran
 * against and the SDK does not surface it uniformly across versions. One
 * explicit question with one answer is cheaper to be sure of than a field that
 * is right until an SDK upgrade quietly renames it.
 *
 * Exported because the gate needs the same number for a different reason:
 * `isLive` compares a rule's `valid_until` against it, and a boundary check
 * that used a stale ledger would call a live rule expired.
 */
export async function latestLedger({ rpcUrl }: Pick<ReadOptions, 'rpcUrl'>): Promise<number> {
  const server = new rpc.Server(rpcUrl);
  const { sequence } = await server.getLatestLedger();
  return sequence;
}
