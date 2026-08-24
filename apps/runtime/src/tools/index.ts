/**
 * The tools this agent has, and the ones §6.1 deliberately leaves out.
 *
 * `invoke_contract` is not here and is not an oversight: it cannot be
 * constrained by any audited policy — `lower.ts` refuses an unconstrained rule
 * on an arbitrary contract, and the refusal is correct — so shipping it would
 * mean either an unconstrained context rule or generated Rust.
 *
 * `swap_tokens` is the one contract call that IS here, and the difference is
 * measured rather than argued: a router call raises a `token.transfer`
 * sub-invocation that only the token's own rule can validate, so the spending
 * limit still sees the money leaving. PLAN-V8 C0 records the over-cap swap
 * refused on a ledger with `SpendingLimitExceeded#3221`. `lower.ts` carries the
 * same argument where it decides to install the venue rule at all. `monitor_account` needs the
 * scheduler, which is a later milestone.
 *
 * `get_boundary`, `get_activity`, `get_transaction` and `explain_refusal` are
 * the rest of §6.1's read set. They are backed by modules that already exist
 * (`read.ts`, `events.ts`, `submit.ts`, `errors.ts`) and land with the chat
 * that gives someone a way to ask for them.
 */

import { erase, type ErasedTool } from './registry.js';
import { getBalance } from './balance.js';
import { sendPayment } from './payment.js';
import { swapTokens } from './swap.js';

export const TOOLS: Record<string, ErasedTool> = {
  [getBalance.name]: erase(getBalance),
  [sendPayment.name]: erase(sendPayment),
  [swapTokens.name]: erase(swapTokens),
};

export { invokeTool, toolNames, erase, type ErasedTool, type Tool, type ToolContext } from './registry.js';
export { classifySubmit, sendPayment, type PaymentArgs, type TransactionFacts } from './payment.js';
export { classifySwap, swapTokens, SOROSWAP_TESTNET_ROUTER, type SwapArgs } from './swap.js';
export { getBalance } from './balance.js';
export { hasEvidence, type Evidence, type ToolResult } from './types.js';
