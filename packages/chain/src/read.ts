/**
 * Reading installed state back off the chain.
 *
 * This is the half of persistence that matters. What is installed on a smart
 * account is a fact about the ledger, not a fact about this browser, so it is
 * read from the ledger every time rather than restored from storage. A reload
 * recomputes; it does not replay a stored answer.
 *
 * The distinction is not pedantic. A policy can be revoked from another device,
 * a context rule can expire while the tab is closed, and a spending window can
 * roll. Anything cached locally is a claim about the past being rendered as the
 * present, which for a permissions tool is the worst available failure.
 *
 * What legitimately lives in browser storage is in `apps/web/src/lib/store.ts`:
 * pointers and provenance, never chain state.
 */

import { Address, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { Amount } from '@limen/core';

/** A context rule as it exists on-chain, decoded. */
export interface InstalledContextRule {
  id: number;
  name: string;
  /** The single contract this rule authorizes calls to, or null for `Default`. */
  contract: string | null;
  contextType: 'Default' | 'CallContract' | 'CreateContract';
  /** Absolute ledger sequence, or null for no expiry. */
  validUntilLedger: number | null;
  /** Policy contract addresses attached to this rule. */
  policies: string[];
  policyIds: number[];
  signerIds: number[];
  /** Signers, as `External(verifier, key)` or `Delegated(address)`. */
  signers: InstalledSigner[];
}

export type InstalledSigner =
  | { kind: 'External'; verifier: string; publicKey: string }
  | { kind: 'Delegated'; address: string };

/** A spending limit as the policy contract currently holds it. */
export interface InstalledSpendingLimit {
  contextRuleId: number;
  limit: Amount;
  periodLedgers: number;
  /** Spent within the current rolling window, as the contract computed it. */
  spentInWindow: Amount;
}

export interface ReadOptions {
  rpcUrl: string;
  /** The account used to simulate reads. Never signs; reads cost nothing. */
  simulationSource: string;
}

/**
 * Whether a rule is live at a given ledger.
 *
 * `valid_until` is inclusive on-chain: `get_validated_context_by_id` rejects
 * only when `valid_until < current_ledger`. Getting this off by one would
 * render a rule as expired for the last ledger of its life, or as live for one
 * ledger past it.
 */
export function isLive(rule: InstalledContextRule, atLedger: number): boolean {
  return rule.validUntilLedger === null || rule.validUntilLedger >= atLedger;
}

function decodeSigner(value: unknown): InstalledSigner {
  const parts = value as unknown[];
  const tag = String(parts[0]);
  if (tag === 'Delegated') {
    return { kind: 'Delegated', address: String(parts[1]) };
  }
  return {
    kind: 'External',
    verifier: String(parts[1]),
    publicKey: Buffer.from(parts[2] as Uint8Array).toString('hex'),
  };
}

/**
 * `ContextRuleType` -> a tag and, for `CallContract`, its address.
 *
 * Every variant decodes to a vec whose head is the variant name — including the
 * unit variant `Default`, which arrives as `['Default']` rather than as a bare
 * string. Assuming otherwise silently mislabels the account's own Default rule
 * as `CreateContract`, which is how this was found: reading a real account and
 * not recognising a rule that was visibly there.
 *
 * The tag is matched exhaustively rather than by elimination, so an unknown
 * variant from a future contract version throws instead of being reported as
 * whichever branch happened to be last.
 */
function decodeContextType(value: unknown): Pick<InstalledContextRule, 'contextType' | 'contract'> {
  const parts = Array.isArray(value) ? value : [value];
  const tag = String(parts[0]);

  switch (tag) {
    case 'Default':
      return { contextType: 'Default', contract: null };
    case 'CallContract':
      return { contextType: 'CallContract', contract: String(parts[1]) };
    case 'CreateContract':
      return { contextType: 'CreateContract', contract: null };
    default:
      throw new Error(
        `unknown ContextRuleType variant ${JSON.stringify(tag)}; refusing to guess which context this rule authorizes`,
      );
  }
}

/**
 * A read-only contract call, executed by simulation.
 *
 * Simulation runs the function without submitting anything, so this costs no
 * fee and needs no signature — which is why account state can be shown to
 * someone who cannot sign for it.
 */
async function simulateRead(
  { rpcUrl, simulationSource }: ReadOptions,
  contract: string,
  fn: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  const { Networks, Operation, TransactionBuilder } = await import('@stellar/stellar-sdk');
  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(simulationSource);

  const tx = new TransactionBuilder(account, { fee: '100000', networkPassphrase: Networks.TESTNET })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(contract).toScAddress(),
            functionName: fn,
            args,
          }),
        ),
        auth: [],
      }),
    )
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new ContractReadError(contract, fn, sim.error);
  }
  const value = sim.result?.retval;
  if (value === undefined) throw new ContractReadError(contract, fn, 'no return value');
  return scValToNative(value);
}

/**
 * A read that failed.
 *
 * Distinct from an empty result on purpose: "this account has no rules" and
 * "we could not ask" are different screens, and rendering the second as the
 * first would tell someone their boundary is gone when it is not.
 */
export class ContractReadError extends Error {
  readonly contract: string;
  readonly fn: string;

  constructor(contract: string, fn: string, detail: string) {
    super(`reading ${fn} from ${contract} failed: ${detail}`);
    this.name = 'ContractReadError';
    this.contract = contract;
    this.fn = fn;
  }
}

/** How many context rules the account has ever created, including expired. */
export async function readContextRuleCount(
  options: ReadOptions,
  smartAccount: string,
): Promise<number> {
  return Number(await simulateRead(options, smartAccount, 'get_context_rules_count', []));
}

export async function readContextRule(
  options: ReadOptions,
  smartAccount: string,
  id: number,
): Promise<InstalledContextRule> {
  const raw = (await simulateRead(options, smartAccount, 'get_context_rule', [
    xdr.ScVal.scvU32(id),
  ])) as Record<string, unknown>;

  const { contextType, contract } = decodeContextType(raw.context_type);

  return {
    id: Number(raw.id),
    name: String(raw.name),
    contextType,
    contract,
    validUntilLedger: raw.valid_until === null || raw.valid_until === undefined ? null : Number(raw.valid_until),
    policies: ((raw.policies ?? []) as unknown[]).map(String),
    policyIds: ((raw.policy_ids ?? []) as unknown[]).map(Number),
    signerIds: ((raw.signer_ids ?? []) as unknown[]).map(Number),
    signers: ((raw.signers ?? []) as unknown[]).map(decodeSigner),
  };
}

/**
 * Every context rule on an account.
 *
 * Ids come from a counter that only increases, and `remove_context_rule` leaves
 * a gap rather than renumbering — so a removed rule's id fails to read while
 * later ids still resolve. A missing id is therefore a revoked rule, not the
 * end of the list, and iteration must not stop at the first failure.
 */
export async function readAllContextRules(
  options: ReadOptions,
  smartAccount: string,
): Promise<InstalledContextRule[]> {
  const count = await readContextRuleCount(options, smartAccount);
  const rules: InstalledContextRule[] = [];

  for (let id = 0; id < count; id++) {
    try {
      rules.push(await readContextRule(options, smartAccount, id));
    } catch (error) {
      if (error instanceof ContractReadError) continue; // removed
      throw error;
    }
  }
  return rules;
}

/**
 * The spending limit a policy contract currently holds for a rule.
 *
 * `spentInWindow` is the contract's own running total, not a number derived
 * here from event history. Deriving it would mean reimplementing the policy's
 * eviction rule in TypeScript and quietly disagreeing with it at the edges.
 */
export async function readSpendingLimit(
  options: ReadOptions,
  policyContract: string,
  smartAccount: string,
  contextRuleId: number,
): Promise<InstalledSpendingLimit> {
  const raw = (await simulateRead(options, policyContract, 'get_spending_limit_data', [
    xdr.ScVal.scvU32(contextRuleId),
    new Address(smartAccount).toScVal(),
  ])) as Record<string, unknown>;

  return {
    contextRuleId,
    limit: String(raw.spending_limit),
    periodLedgers: Number(raw.period_ledgers),
    spentInWindow: String(raw.cached_total_spent ?? '0'),
  };
}
