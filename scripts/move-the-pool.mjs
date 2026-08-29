#!/usr/bin/env node
/**
 * Move the market the agent is watching, without touching the agent's rule.
 *
 *     node scripts/move-the-pool.mjs [xlmToSell]        # default 150
 *
 * ## Why this exists, and why it is not cheating
 *
 * A `price_drop` trigger fires when the venue's quote falls a stated distance
 * below the reference stamped when the agent was configured. Soroswap's quote is
 * a pure function of the pool's two reserves — there is no oracle and no feed —
 * so on testnet, where the XLM/USDC pair sees essentially no flow, **the price
 * does not move on its own and the trigger never fires**. Every cycle is an
 * honest no-trade, forever.
 *
 * There are two ways to get a fire out of that, and only one of them proves
 * anything:
 *
 *   - **Move the rule.** Lower `dropBps` until the trigger clears the price that
 *     is already there. This proves nothing: it is the goalposts moving, and the
 *     resulting trade says only that a number was edited until a condition was
 *     true.
 *   - **Move the market.** Sell XLM into the pair from an unrelated account. The
 *     reserves change, the quote falls, and the agent — which is not told any of
 *     this — reads the new price on its next scheduled cycle and decides on its
 *     own terms. That is a real market event and a real reaction to it.
 *
 * This is the second. It touches no Limen row, no agent, no policy and no
 * boundary. It is an ordinary swap by a stranger who happens to be us, and the
 * agent has no way to tell the difference — which is the whole point.
 *
 * ## The account is fresh and disposable
 *
 * A new keypair, funded by Friendbot, used once. Deliberately **not** the demo
 * account and not the owner: the claim being made is *an unrelated party traded*,
 * and reusing an account this run already holds keys for would weaken it for no
 * benefit. Testnet XLM is free.
 *
 * ## What it prints
 *
 * The quote before and after, the basis points moved, and the hash. The basis
 * points are computed from the two quotes rather than predicted, because the
 * prediction is the thing being checked.
 */

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const PROBE = 10_000_000n;

const xlmToSell = BigInt(Math.round(Number(process.argv[2] ?? '150') * 1e7));
const server = new rpc.Server(RPC_URL);

const path = () => nativeToScVal([new Address(XLM), new Address(USDC)], { type: 'address' });

async function quote(source) {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(
      new Contract(ROUTER).call('router_get_amounts_out', nativeToScVal(PROBE, { type: 'i128' }), path()),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`quote failed: ${sim.error}`);
  const amounts = scValToNative(sim.result.retval);
  return BigInt(amounts[amounts.length - 1]);
}

const kp = Keypair.random();

console.log(`account   ${kp.publicKey()}  (fresh, disposable)`);
const funded = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
if (!funded.ok) throw new Error(`friendbot refused: ${funded.status}`);
console.log('funded    10,000 XLM from Friendbot');

const before = await quote(kp.publicKey());
console.log(`quote     ${before} USDC units per 1 XLM (before)`);

const account = await server.getAccount(kp.publicKey());
const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
  .addOperation(
    new Contract(ROUTER).call(
      'swap_exact_tokens_for_tokens',
      nativeToScVal(xlmToSell, { type: 'i128' }),
      nativeToScVal(0n, { type: 'i128' }),
      path(),
      new Address(kp.publicKey()).toScVal(),
      nativeToScVal(Math.floor(Date.now() / 1000) + 300, { type: 'u64' }),
    ),
  )
  .setTimeout(60)
  .build();

const prepared = await server.prepareTransaction(tx);
prepared.sign(kp);
const sent = await server.sendTransaction(prepared);
if (sent.status === 'ERROR') throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);

let result = await server.getTransaction(sent.hash);
while (result.status === 'NOT_FOUND') {
  await new Promise((r) => setTimeout(r, 1500));
  result = await server.getTransaction(sent.hash);
}

console.log(`sold      ${Number(xlmToSell) / 1e7} XLM into the XLM/USDC pair`);
console.log(`status    ${result.status}`);
console.log(`hash      ${sent.hash}`);
console.log(`explorer  https://stellar.expert/explorer/testnet/tx/${sent.hash}`);

const after = await quote(kp.publicKey());
const bps = Number(((before - after) * 10_000n) / before);
console.log(`quote     ${after} USDC units per 1 XLM (after)`);
console.log(`moved     ${bps} bps down`);
console.log(
  bps === 0
    ? '\nThe quote did not move. Nothing was provoked; do not read a later trade as a reaction to this.'
    : `\nThe market moved ${bps} bps. An agent whose trigger is below that will fire on its own next cycle.`,
);
