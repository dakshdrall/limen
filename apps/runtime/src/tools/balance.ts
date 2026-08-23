/**
 * `get_balance` — the first question anyone asks an agent.
 *
 * Two numbers, kept apart on purpose. §3.2 records them as **distinct
 * exposures** and requires the dashboard to render them as distinct,
 * differently-labelled figures, and a tool that returned one total would make
 * that impossible downstream:
 *
 *   - **The account's balance.** What the agent may spend from, bounded by the
 *     installed rule. Limen's key cannot move it except within that boundary.
 *   - **The fee account's balance.** XLM held by the classic account that pays
 *     transaction fees. It is *not* bounded by anything — it is the smaller,
 *     real exposure that comes with holding a key at all, and it is named that
 *     way here so nothing downstream can quietly add it to the first number.
 *
 * Both are read at a ledger and both carry it. A balance is stale the moment it
 * is read, and `balance.ts` in `@limen/chain` explains why the ledger travels
 * with the number rather than beside it in a comment.
 */

import { z } from 'zod';
import { nativeTokenId, readBalance } from '@limen/chain';
import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import type { Tool } from './registry.js';

export const getBalance: Tool<Record<string, never>> = {
  name: 'get_balance',
  kind: 'read',
  description:
    "Read the agent's smart account balance and the balance of the classic account that pays its " +
    'transaction fees. Both are returned in stroops with the ledger they were read at.',
  // No arguments, and `strict` so a model that invents one is corrected rather
  // than quietly ignored — an argument that is dropped silently is a
  // misunderstanding nobody finds out about.
  schema: z.strictObject({}),

  async run(_args, ctx) {
    const token = nativeTokenId(TESTNET_PASSPHRASE);

    // Sequential rather than parallel: two simulations against one RPC endpoint
    // for a question nobody is timing, and a failure names which read failed.
    const account = await readBalance(ctx.read, { token, holder: ctx.agent.smartAccount });
    const fees = await readBalance(ctx.read, { token, holder: ctx.agent.feeAccount });

    return {
      outcome: 'succeeded',
      summary:
        `The agent's account holds ${account.amount} stroops of XLM, read at ledger ${account.ledger}. ` +
        `Its fee account holds ${fees.amount} stroops, which is not bounded by the agent's boundary.`,
      data: {
        token,
        account: {
          address: account.holder,
          stroops: account.amount.toString(),
          ledger: account.ledger,
        },
        fees: {
          address: fees.holder,
          stroops: fees.amount.toString(),
          ledger: fees.ledger,
          note: 'Fees are paid from a classic account. This balance is not bounded by the agent boundary.',
        },
      },
      evidence: null,
    };
  },
};
