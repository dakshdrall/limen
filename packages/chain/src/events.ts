/**
 * Activity, read from contract events.
 *
 * What this can and cannot see is the whole design, so it is stated first.
 *
 * **Only successes emit events.** A transaction the boundary refused emits no
 * contract events at all — it failed, so nothing was published. Everything in
 * this file is therefore a record of what was *permitted*. Refused attempts are
 * recovered from transaction results, a different source with different
 * confidence, and the screen must label which is which rather than blending
 * them into one feed. Nothing here should ever be presented as "the account's
 * complete history".
 *
 * **The RPC forgets.** Soroban RPC retains events for a bounded window —
 * `getHealth` reports the floor as `oldestLedger`. Activity older than that is
 * gone, not empty, and `ActivityWindow` carries what was actually scanned so a
 * screen can say which of the two it is showing.
 *
 * **One request does not cover the window.** Measured against testnet: a single
 * `getEvents` call scans roughly 10,000 ledgers and then returns a *cursor* —
 * not an error, and not a signal that it stopped early. Asking for the full
 * retention window in one call returns an empty page while real events sit
 * ~100,000 ledgers further on. Reading that empty page as "nothing happened" is
 * the exact failure this module exists to not have, so the scan pages through
 * the cursor and reports `truncated` when it runs out of budget before reaching
 * the head.
 *
 * Event names below are the ones the deployed contracts actually emit, read off
 * live testnet rather than inferred: the account publishes `context_rule_added`,
 * `policy_registered`, and `signer_registered` — not the `*_added` spellings a
 * reading of the sources suggests. An unrecognised event is kept and labelled
 * rather than dropped, because dropping it would silently under-report history.
 */

import { rpc, scValToNative, type xdr } from '@stellar/stellar-sdk';
import type { Amount } from '@limen/core';

/**
 * Event names this module decodes into structured fields. Anything else is
 * still reported, as `kind: 'unknown'` with its name preserved.
 */
export type ActivityKind =
  // from the smart account
  | 'context_rule_added'
  | 'context_rule_removed'
  | 'policy_registered'
  | 'policy_removed'
  | 'signer_registered'
  | 'signer_removed'
  // from the spending limit policy
  | 'spending_limit_installed'
  | 'spending_limit_enforced'
  | 'spending_limit_uninstalled'
  | 'spending_limit_changed'
  | 'unknown';

/** A permitted spend, as the policy contract recorded it. */
export interface EnforcedSpend {
  amount: Amount;
  /**
   * The policy's own running total for the window, taken from the event rather
   * than re-derived here. Re-deriving would mean reimplementing the contract's
   * eviction rule in TypeScript and disagreeing with it at the edges.
   */
  totalSpentInPeriod: Amount;
  contract: string;
  fnName: string;
}

export interface ActivityEvent {
  kind: ActivityKind;
  /** The contract event name as emitted, including for `unknown`. */
  name: string;
  /** Which contract published it. */
  source: 'account' | 'policy';
  contract: string;
  ledger: number;
  closedAt: string;
  txHash: string;
  /**
   * The context rule this event is about, when the event actually identifies
   * one.
   *
   * Deliberately null for `policy_registered` and `signer_registered`. Their
   * second topic is a *policy id* and a *signer id* — separate counters that
   * happen to be small integers too. Reading either as a rule id would file the
   * event under whichever rule shares its number, which is a plausible-looking
   * lie.
   */
  contextRuleId: number | null;
  /** The rule's name, for the events that carry it. */
  ruleName: string | null;
  spend: EnforcedSpend | null;
}

export interface ActivityWindow {
  /** First ledger scanned. */
  fromLedger: number;
  /** Head of the chain when the scan finished. */
  toLedger: number;
  /** The oldest ledger this RPC still holds. Below it, history is gone. */
  oldestRetainedLedger: number;
  /** True when the scan began at the retention floor — there is nothing older to read. */
  reachedRetentionFloor: boolean;
  /**
   * True when the request budget ran out before the scan reached the head.
   * A screen showing a truncated scan must not describe it as complete.
   */
  truncated: boolean;
  /** How many `getEvents` calls the scan cost. */
  requests: number;
}

export interface ActivityRead {
  events: ActivityEvent[];
  window: ActivityWindow;
}

export interface ActivityOptions {
  rpcUrl: string;
  /** The smart account whose activity this is. */
  smartAccount: string;
  /**
   * Policy contracts to include. Policy events are keyed by smart account in
   * their second topic, so events for other accounts are filtered out here.
   */
  policyContracts?: string[];
  /** How far back to look. Clamped to what the RPC still retains. */
  lookbackLedgers?: number;
  /**
   * Maximum `getEvents` calls per contract. At ~10,000 ledgers scanned per
   * call, the default covers ~150,000 ledgers — more than testnet's retention
   * window — while still bounding a screen's cost.
   */
  maxRequests?: number;
}

const DEFAULT_LOOKBACK_LEDGERS = 120_960;
const DEFAULT_MAX_REQUESTS = 16;

const ACCOUNT_KINDS: ReadonlySet<string> = new Set([
  'context_rule_added',
  'context_rule_removed',
  'policy_registered',
  'policy_removed',
  'signer_registered',
  'signer_removed',
]);

const POLICY_KINDS: ReadonlySet<string> = new Set([
  'spending_limit_installed',
  'spending_limit_enforced',
  'spending_limit_uninstalled',
  'spending_limit_changed',
]);

/** Event names whose second topic is a context rule id. */
const RULE_ID_IN_TOPIC: ReadonlySet<string> = new Set(['context_rule_added', 'context_rule_removed']);

function native(value: xdr.ScVal): unknown {
  return scValToNative(value);
}

/** i128 arrives as a bigint. Every amount in this project is a decimal string. */
function amount(value: unknown): Amount {
  return typeof value === 'bigint' ? value.toString() : String(value ?? '0');
}

/**
 * The cursor's ledger.
 *
 * A cursor is `"<toid>-<opIndex>"`, and the toid's high 32 bits are the ledger
 * sequence. Knowing where a page ended is what makes it possible to tell "the
 * scan reached the head" from "the scan ran out of budget", which are the two
 * things a screen must never confuse.
 */
export function cursorLedger(cursor: string): number {
  const toid = cursor.split('-')[0];
  if (toid === undefined) return 0;
  try {
    return Number(BigInt(toid) >> 32n);
  } catch {
    // An unparseable cursor must not be read as "the scan reached the head".
    // Returning 0 keeps the loop going until the request budget stops it, and
    // the budget reports itself as `truncated`.
    return 0;
  }
}

/**
 * One event, or `null` when it belongs to a different account.
 *
 * The verifier and spending-limit contracts are deployed once and shared by
 * every account, so their event streams carry every account's activity. The
 * smart account is the second topic on a policy event, and narrowing on it here
 * is not an optimisation — without it, this screen would show one account's
 * spending under another account's boundary.
 */
/**
 * An event with its `ScVal`s already converted to plain values.
 *
 * The conversion is the SDK's business; everything interesting about decoding
 * an event happens after it. Splitting them here is what lets the rules below —
 * which id means what, which events belong to this account — be unit-tested
 * without a mock Soroban host, in the same spirit as `read.ts`.
 */
export interface NativeEvent {
  topics: unknown[];
  value: Record<string, unknown> | undefined;
  source: 'account' | 'policy';
  contract: string;
  ledger: number;
  closedAt: string;
  txHash: string;
}

export function decodeActivity(event: NativeEvent, smartAccount: string): ActivityEvent | null {
  const { topics, value, source } = event;
  const name = String(topics[0] ?? '');
  const known = source === 'account' ? ACCOUNT_KINDS.has(name) : POLICY_KINDS.has(name);

  if (source === 'policy' && String(topics[1] ?? '') !== smartAccount) return null;

  const contextRuleId =
    RULE_ID_IN_TOPIC.has(name) && typeof topics[1] === 'number'
      ? topics[1]
      : value !== undefined && typeof value.context_rule_id === 'number'
        ? value.context_rule_id
        : null;

  const context = value?.context as ['Contract', Record<string, unknown>] | undefined;
  const call = Array.isArray(context) ? context[1] : undefined;

  return {
    kind: known ? (name as ActivityKind) : 'unknown',
    name,
    source,
    contract: event.contract,
    ledger: event.ledger,
    closedAt: event.closedAt,
    txHash: event.txHash,
    contextRuleId,
    ruleName: typeof value?.name === 'string' ? value.name : null,
    spend:
      name === 'spending_limit_enforced' && value !== undefined
        ? {
            amount: amount(value.amount),
            totalSpentInPeriod: amount(value.total_spent_in_period),
            contract: String(call?.contract ?? ''),
            fnName: String(call?.fn_name ?? ''),
          }
        : null,
  };
}

/** Adapts one RPC event into the shape `decodeActivity` reasons about. */
function decode(
  raw: rpc.Api.EventResponse,
  source: 'account' | 'policy',
  smartAccount: string,
): ActivityEvent | null {
  return decodeActivity(
    {
      topics: raw.topic.map(native),
      value: native(raw.value) as Record<string, unknown> | undefined,
      source,
      contract: raw.contractId?.toString() ?? '',
      ledger: raw.ledger,
      closedAt: raw.ledgerClosedAt,
      txHash: raw.txHash,
    },
    smartAccount,
  );
}

/**
 * Pages through `getEvents` for one contract until the scan reaches the head or
 * runs out of budget.
 *
 * Returns whether it was truncated, because that is a property of the answer and
 * not a detail of how it was obtained: a screen that shows a truncated scan as a
 * complete one is claiming an absence it did not verify.
 */
async function scanContract(
  server: rpc.Server,
  contract: string,
  startLedger: number,
  headLedger: number,
  maxRequests: number,
): Promise<{ events: rpc.Api.EventResponse[]; truncated: boolean; requests: number }> {
  const filters = [{ type: 'contract' as const, contractIds: [contract] }];
  const collected: rpc.Api.EventResponse[] = [];

  let page = await server.getEvents({ startLedger, filters, limit: 200 });
  let requests = 1;

  while (true) {
    collected.push(...page.events);

    const cursor = page.cursor;
    if (cursor === undefined || cursor.length === 0) return { events: collected, truncated: false, requests };
    if (cursorLedger(cursor) >= headLedger) return { events: collected, truncated: false, requests };
    if (requests >= maxRequests) return { events: collected, truncated: true, requests };

    page = await server.getEvents({ cursor, filters, limit: 200 });
    requests += 1;
  }
}

export async function readActivity({
  rpcUrl,
  smartAccount,
  policyContracts = [],
  lookbackLedgers = DEFAULT_LOOKBACK_LEDGERS,
  maxRequests = DEFAULT_MAX_REQUESTS,
}: ActivityOptions): Promise<ActivityRead> {
  const server = new rpc.Server(rpcUrl);
  const [health, latest] = await Promise.all([server.getHealth(), server.getLatestLedger()]);

  const oldestRetainedLedger = health.oldestLedger;
  const headLedger = latest.sequence;
  const wanted = headLedger - lookbackLedgers;
  const fromLedger = Math.max(wanted, oldestRetainedLedger);

  const contracts: Array<{ id: string; source: 'account' | 'policy' }> = [
    { id: smartAccount, source: 'account' },
    ...policyContracts.map((id) => ({ id, source: 'policy' as const })),
  ];

  const scans = await Promise.all(
    contracts.map(async ({ id, source }) => {
      const scan = await scanContract(server, id, fromLedger, headLedger, maxRequests);
      const events = scan.events
        .map((raw) => decode(raw, source, smartAccount))
        .filter((event): event is ActivityEvent => event !== null);
      return { events, truncated: scan.truncated, requests: scan.requests };
    }),
  );

  return {
    // Newest first. Ties within a ledger fall back to the transaction hash so
    // the order is stable between reads rather than dependent on which contract
    // happened to be scanned first.
    events: scans
      .flatMap((scan) => scan.events)
      .sort((a, b) => b.ledger - a.ledger || b.txHash.localeCompare(a.txHash)),
    window: {
      fromLedger,
      toLedger: headLedger,
      oldestRetainedLedger,
      reachedRetentionFloor: wanted <= oldestRetainedLedger,
      truncated: scans.some((scan) => scan.truncated),
      requests: scans.reduce((total, scan) => total + scan.requests, 0),
    },
  };
}
