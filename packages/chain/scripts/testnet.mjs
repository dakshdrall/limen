#!/usr/bin/env node
/**
 * The testnet scripts behind `deployments/testnet.json`.
 *
 *   node scripts/testnet.mjs deploy      upload the four WASMs, deploy the
 *                                        shared verifiers and policy, deploy a
 *                                        smart account
 *   node scripts/testnet.mjs walkthrough install a rule, transfer inside it,
 *                                        transfer outside it
 *   node scripts/testnet.mjs survey      attempt all six deny axes and report
 *                                        which error refused each, and whether
 *                                        it reached a ledger
 *
 * Secrets come from the environment and are never written anywhere:
 *
 *   LIMEN_DEPLOYER_SECRET   pays fees; funded from friendbot
 *   LIMEN_OWNER_SECRET      the smart account's owner signer
 *   LIMEN_AGENT_SECRET      the agent's own key, bounded by the installed policy
 *
 * These are disposable testnet keys. The agent's key is deliberately a separate
 * key from the owner's: the claim is not that the agent holds no key, it is that
 * the key the agent holds cannot exceed the boundary.
 *
 * Nothing here runs in CI. Every subcommand submits real transactions.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  authDigest,
  authPayload,
  callContractType,
  describeContractError,
  externalSigner,
  i128,
  isBoundaryRefusal,
  spendingLimitParams,
} from '../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const deployments = JSON.parse(readFileSync(join(HERE, '..', 'deployments', 'testnet.json'), 'utf8'));

const RPC = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;
const server = new rpc.Server(RPC);

function secret(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. These scripts submit real testnet transactions and will not invent a key.`);
  }
  return Keypair.fromSecret(value);
}

const rawKey = (kp) => StrKey.decodeEd25519PublicKey(kp.publicKey());
const explorer = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const sym = (s) => xdr.ScVal.scvSymbol(s);
const u32 = (n) => xdr.ScVal.scvU32(n);
const addr = (a) => new Address(a).toScVal();

const invoke = (contract, fn, args) =>
  xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contract).toScAddress(),
      functionName: fn,
      args,
    }),
  );

async function waitFor(hash) {
  let r = await server.getTransaction(hash);
  for (let i = 0; i < 40 && r.status === 'NOT_FOUND'; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    r = await server.getTransaction(hash);
  }
  return r;
}

/** Contract error codes out of a failed transaction's diagnostic events. */
function contractErrorCodes(result) {
  const out = [];
  const scan = (v) => {
    if (!v || typeof v.switch !== 'function') return;
    const kind = v.switch().name;
    if (kind === 'scvError') {
      const e = v.error();
      if (e.switch().name === 'sceContract') out.push(e.contractCode());
    } else if (kind === 'scvVec') for (const inner of v.vec() ?? []) scan(inner);
    else if (kind === 'scvMap') for (const entry of v.map() ?? []) { scan(entry.key()); scan(entry.val()); }
  };
  for (const ev of result.diagnosticEventsXdr ?? []) {
    try {
      const body = ev.event().body().v0();
      for (const topic of body.topics()) scan(topic);
      scan(body.data());
    } catch {
      // A diagnostic event we cannot read is not an error we can attribute.
    }
  }
  return [...new Set(out)];
}

function opResultName(result) {
  try {
    return result.resultXdr.result().results()[0].tr().invokeHostFunctionResult().switch().name;
  } catch {
    try { return result.resultXdr.result().switch().name; } catch { return 'unknown'; }
  }
}

const simErrorCode = (text) => {
  const m = /Error\(Contract, #(\d+)\)/.exec(String(text ?? ''));
  return m === null ? null : Number(m[1]);
};

/**
 * Sign a smart-account auth entry.
 *
 * The signature is over `authDigest`, never over the host payload, and it goes
 * in verbatim as `signatureScVal` because `__check_auth` expects an AuthPayload
 * rather than the built-in ed25519 vector.
 */
function signAs(kp, verifier, contextRuleIds, expirationLedger) {
  return (entry) =>
    authorizeEntry(
      entry,
      async (_preimage, payload) => ({
        signatureScVal: authPayload(
          [{ signer: externalSigner(verifier, rawKey(kp)), signature: kp.sign(authDigest(payload, contextRuleIds)) }],
          contextRuleIds,
        ),
      }),
      expirationLedger,
      PASSPHRASE,
    );
}

/**
 * Simulate twice, then submit.
 *
 * The second simulation is not redundant. Recording-mode simulation never
 * executes `__check_auth`, so its footprint omits the verifier and policy
 * contracts and its budget omits their work; a transaction assembled from it
 * dies with `resourceLimitExceeded` before the boundary is ever consulted.
 */
async function submitAuthorized({ feeSource, func, sign, label }) {
  const recording = await server.simulateTransaction(
    new TransactionBuilder(await server.getAccount(feeSource.publicKey()), {
      fee: '2000000',
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.invokeHostFunction({ func, auth: [] }))
      .setTimeout(180)
      .build(),
  );
  if (rpc.Api.isSimulationError(recording)) throw new Error(`${label}: recording simulation failed: ${recording.error}`);

  const signed = [];
  for (const entry of recording.result.auth ?? []) signed.push(await sign(entry));

  const tx = new TransactionBuilder(await server.getAccount(feeSource.publicKey()), {
    fee: '2000000',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth: signed }))
    .setTimeout(180)
    .build();

  const enforcing = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(enforcing)) {
    return { ok: false, stage: 'simulation', error: enforcing.error, code: simErrorCode(enforcing.error) };
  }

  const built = rpc.assembleTransaction(tx, enforcing).build();
  built.sign(feeSource);
  const sent = await server.sendTransaction(built);
  if (sent.status === 'ERROR') return { ok: false, stage: 'submit', error: JSON.stringify(sent.errorResult) };

  const result = await waitFor(sent.hash);
  return {
    ok: result.status === 'SUCCESS',
    stage: 'ledger',
    hash: sent.hash,
    status: result.status,
    codes: contractErrorCodes(result),
    returnValue: result.returnValue,
    transactionData: enforcing.transactionData.build(),
    recordingData: recording.transactionData.build(),
    signed,
  };
}

/**
 * The `id` field out of the `ContextRule` that `add_context_rule` returns.
 *
 * Read from the transaction rather than assumed: rule ids are assigned by an
 * on-chain counter, so every run of this script installs a new one, and a
 * hardcoded id would silently drive the wrong rule.
 */
function contextRuleIdFrom(returnValue) {
  const entries = returnValue?.map?.() ?? [];
  for (const entry of entries) {
    if (entry.key().sym().toString() === 'id') return entry.val().u32();
  }
  throw new Error('add_context_rule did not return a ContextRule with an id');
}

// ---------------------------------------------------------------------------

function addContextRuleFunc({ smartAccount, token, name, validUntil, agentRaw, verifier, policy, cap, windowLedgers }) {
  return invoke(smartAccount, 'add_context_rule', [
    callContractType(token),
    xdr.ScVal.scvString(name),
    u32(validUntil),
    xdr.ScVal.scvVec([externalSigner(verifier, agentRaw)]),
    xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: addr(policy), val: spendingLimitParams(cap, windowLedgers) })]),
  ]);
}

const transferFunc = (token, from, to, amount) =>
  invoke(token, 'transfer', [addr(from), addr(to), i128(amount)]);

async function walkthrough() {
  const deployer = secret('LIMEN_DEPLOYER_SECRET');
  const owner = secret('LIMEN_OWNER_SECRET');
  const agent = secret('LIMEN_AGENT_SECRET');

  const { smartAccount, token } = deployments.walkthrough;
  const verifier = deployments.shared.ed25519Verifier.contract;
  const policy = deployments.shared.spendingLimitPolicy.contract;

  const latest = await server.getLatestLedger();
  const expiry = latest.sequence + 200;
  const cap = 1_000_000n;

  console.log(`ledger ${latest.sequence}`);

  const install = await submitAuthorized({
    feeSource: deployer,
    func: addContextRuleFunc({
      smartAccount, token, verifier, policy, cap,
      name: 'limen-agent',
      validUntil: latest.sequence + 100_000,
      agentRaw: rawKey(agent),
      windowLedgers: 17_280,
    }),
    sign: signAs(owner, verifier, [0], expiry),
    label: 'install',
  });
  console.log(`install    : ${install.status ?? install.stage} ${install.hash ? explorer(install.hash) : install.error}`);
  if (!install.ok) return;

  const ruleId = contextRuleIdFrom(install.returnValue);
  console.log(`context rule installed with id ${ruleId}, cap ${cap} over 17280 ledgers`);

  // Over the cap, on a fresh window: the amount axis with nothing else changed.
  const denied = await attemptOverLimit({ deployer, agent, verifier, token, smartAccount, ruleId, cap, expiry });
  console.log(`rejected   : ${denied.status} ${denied.codes.map(describeContractError).join(',')} ${explorer(denied.hash)}`);
  console.log(`             boundary refusal: ${isBoundaryRefusal(denied.codes)}`);

  const permitted = await submitAuthorized({
    feeSource: deployer,
    func: transferFunc(token, smartAccount, deployer.publicKey(), cap),
    sign: signAs(agent, verifier, [ruleId], expiry),
    label: 'permitted',
  });
  console.log(`permitted  : ${permitted.status ?? permitted.stage} ${permitted.hash ? explorer(permitted.hash) : permitted.error}`);
}

/**
 * Submit an over-limit transfer on purpose.
 *
 * Its simulation fails, and a failed simulation yields no footprint — so
 * without borrowing one, the attempt could never reach a ledger and would have
 * no hash to show. The footprint comes from the enforcing simulation of the
 * permitted call: same nonce, same entries, one field different.
 */
async function attemptOverLimit({ deployer, agent, verifier, token, smartAccount, ruleId, cap, expiry }) {
  const permittedFunc = transferFunc(token, smartAccount, deployer.publicKey(), cap);
  const recording = await server.simulateTransaction(
    new TransactionBuilder(await server.getAccount(deployer.publicKey()), { fee: '2000000', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.invokeHostFunction({ func: permittedFunc, auth: [] }))
      .setTimeout(180)
      .build(),
  );
  if (rpc.Api.isSimulationError(recording)) throw new Error('over-limit baseline: ' + recording.error);

  const sign = signAs(agent, verifier, [ruleId], expiry);
  const baseline = new TransactionBuilder(await server.getAccount(deployer.publicKey()), { fee: '2000000', networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeHostFunction({ func: permittedFunc, auth: [await sign(xdr.SorobanAuthorizationEntry.fromXDR(recording.result.auth[0].toXDR()))] }))
    .setTimeout(180)
    .build();
  const enforcing = await server.simulateTransaction(baseline);
  if (rpc.Api.isSimulationError(enforcing)) throw new Error('over-limit baseline enforcing: ' + enforcing.error);

  const overEntry = xdr.SorobanAuthorizationEntry.fromXDR(recording.result.auth[0].toXDR());
  overEntry.rootInvocation().function().contractFn().args()[2] = i128(cap * 2n);
  const signedOver = await sign(overEntry);

  const tx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), { fee: '5000000', networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeHostFunction({ func: transferFunc(token, smartAccount, deployer.publicKey(), cap * 2n), auth: [signedOver] }))
    .setTimeout(180)
    .setSorobanData(enforcing.transactionData.build())
    .build();
  tx.sign(deployer);

  const sent = await server.sendTransaction(tx);
  const result = await waitFor(sent.hash);
  return { hash: sent.hash, status: result.status, codes: contractErrorCodes(result), opResult: opResultName(result) };
}

const [command] = process.argv.slice(2);
if (command === 'walkthrough') await walkthrough();
else {
  console.error('usage: testnet.mjs walkthrough');
  console.error('(deploy and survey are recorded in deployments/testnet.json; see PLAN-V3.md §Sequence)');
  process.exit(2);
}
