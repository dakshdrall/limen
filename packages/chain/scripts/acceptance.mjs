#!/usr/bin/env node
/**
 * The PLAN-V4 §1 acceptance test, driven from a browser-shaped code path.
 *
 * This script exists to answer one question that a browser cannot be asked
 * until the screens are built: **does the write path work without Node?**
 *
 * So it observes the browser's constraints rather than Node's, deliberately and
 * checkably:
 *
 *   - No `node:` import anywhere in this file. Not `node:fs`, not `node:crypto`,
 *     not `node:path`. `test/browser-path.test.ts` asserts that, because a rule
 *     kept by intention is kept until the first time someone is in a hurry.
 *   - No `process.env`, and no secret read from anywhere. The keys are generated
 *     here and funded from friendbot, which is what the browser will do on
 *     `/app/accounts/new`: a stranger with no wallet creates an account. The one
 *     `process` reference is `argv` at the very bottom, which is the CLI shell
 *     around the flow rather than part of it.
 *   - No `Buffer`. Bytes are `Uint8Array`, hex goes through `@limen/chain`'s own
 *     helpers, and randomness comes from `crypto.getRandomValues`.
 *   - Reads are JSON module imports, which is what a bundler resolves too.
 *
 * What it is NOT: proof that the code runs in a browser. It runs in Node, on
 * the Node build of the SDK. `test/browser-bundle.test.ts` is the other half —
 * it runs the same modules against the SDK's *browser* build with
 * `globalThis.Buffer` deleted. Neither alone is sufficient and both are cheap.
 *
 * Nothing here runs in CI. Every subcommand submits real transactions and
 * spends testnet funds.
 *
 *   node scripts/acceptance.mjs deploy   friendbot x2, then create a smart
 *                                        account owned by a generated key
 *   node scripts/acceptance.mjs run      the whole §1 flow, eleven transactions,
 *                                        ending with a JSON record on stdout
 *   node scripts/acceptance.mjs f4       the F4 experiment: does the enforcing
 *                                        simulation surface a Delegated owner's
 *                                        nested auth requirement?
 *
 * `run` is one process on purpose. The keys are generated in memory and never
 * written anywhere, so the flow cannot be resumed — the same property the
 * browser has, and the reason the screens will say that clearing site data
 * destroys the account.
 */

import { Address, Asset, Keypair, Operation, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { synthesize } from '@limen/core';
import {
  DEFAULT_TESTNET_RPC_URL,
  FRIENDBOT_URL,
  TESTNET_PASSPHRASE,
  assertDistinctSigners,
  authPayload,
  contextRuleIdFrom,
  delegatedSigner,
  deployAccountFunction,
  deployedContractAddress,
  describeContractError,
  i128,
  installFunctions,
  isBoundaryRefusal,
  isRevokedRule,
  lower,
  ownerSignerScVal,
  readAllContextRules,
  recordAuthEntries,
  removeContextRuleFunction,
  scvBytes,
  sha256,
  signAs,
  simulationErrorCode,
  structMap,
  submitAuthorized,
  submitWithBorrowedFootprint,
  toHex,
} from '../dist/browser.js';
import manifest from '../src/wasm/manifest.json' with { type: 'json' };
import deployments from '../deployments/testnet.json' with { type: 'json' };

const RPC_URL = DEFAULT_TESTNET_RPC_URL;
const VERIFIER = deployments.shared.ed25519Verifier.contract;
const POLICY = deployments.shared.spendingLimitPolicy.contract;
const TOKEN = Asset.native().contractId(TESTNET_PASSPHRASE);

/** Stroops. 100 XLM seeded, 0.1 XLM observed; the derived cap follows from it. */
const SEED_AMOUNT = 1_000_000_000n;
const OBSERVED_AMOUNT = 1_000_000n;
/**
 * Deliberately below the derived cap.
 *
 * If the agent's permitted transfer spent the whole cap, its repeat after the
 * revoke would fail whether or not the rule had been removed —
 * `SpendingLimitExceeded` and `ContextRuleNotFound` would be indistinguishable
 * from outside, and step 10 would prove nothing. The headroom is what makes the
 * post-revoke failure attributable to the revoke.
 */
const AGENT_SPEND = 400_000n;

const explorer = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
const named = (list) => (list.length === 0 ? '(none)' : list.map(describeContractError).join(','));

function invoke(contract, fn, args) {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contract).toScAddress(),
      functionName: fn,
      args,
    }),
  );
}

const transferFunc = (from, to, amount) =>
  invoke(TOKEN, 'transfer', [new Address(from).toScVal(), new Address(to).toScVal(), i128(amount)]);

/**
 * Fund an account from friendbot.
 *
 * `fetch`, not a Node HTTP client, because the open question is whether the
 * browser can do this. PLAN-V4 §6: if CORS blocks the call from a page, the
 * fallback is a thin `/api/fund` route that forwards an address and nothing
 * else — a question for the screens, not for this script.
 */
async function fund(publicKey) {
  const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    throw new Error(`friendbot refused ${publicKey}: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  return body.hash ?? body.id ?? '(friendbot returned no hash)';
}

/** A generated, disposable testnet key. The browser's `local-key.ts` in miniature. */
function localKey(role) {
  const keypair = Keypair.random();
  return {
    role,
    publicKey: keypair.publicKey(),
    raw: keypair.rawPublicKey(),
    /** Satisfies `Ed25519Signer` structurally; `signAs` never learns it is a Keypair. */
    signer: { rawPublicKey: () => keypair.rawPublicKey(), sign: (message) => keypair.sign(message) },
    signEnvelope: (tx) => {
      tx.sign(keypair);
      return tx;
    },
  };
}

function report(label, result) {
  if (result.stage !== 'ledger') {
    console.log(`${label.padEnd(13)}: FAILED at ${result.stage} — ${result.error}`);
    return false;
  }
  console.log(`${label.padEnd(13)}: ${result.status} ${explorer(result.hash)}`);
  if (!result.ok) console.log(`${''.padEnd(13)}  op ${result.opResult}, codes ${named(result.codes)}`);
  return result.ok;
}

async function deploySmartAccount(owner) {
  return submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    signEnvelope: owner.signEnvelope,
    func: deployAccountFunction({
      accountWasmHash: manifest.contracts.account.wasmHash,
      deployer: owner.publicKey,
      owner: { kind: 'external', verifier: VERIFIER, publicKey: owner.raw },
    }),
    label: 'deploy',
  });
}

async function deploy() {
  const owner = localKey('OWNER');
  const agent = localKey('AGENT');
  assertDistinctSigners(owner.raw, agent.raw);

  console.log(`owner        : ${owner.publicKey}`);
  console.log(`agent        : ${agent.publicKey}`);
  console.log(`friendbot#1  : ${explorer(await fund(owner.publicKey))}`);
  console.log(`friendbot#2  : ${explorer(await fund(agent.publicKey))}`);

  const result = await deploySmartAccount(owner);
  if (!report('deploy', result)) return;
  console.log(`smartAccount : ${deployedContractAddress(result.returnValue)}`);
}

/**
 * The observed transaction, read back off the ledger.
 *
 * Read rather than remembered: the amount that reaches `synthesize` comes from
 * the envelope the network recorded, not from the constant this script sent. A
 * boundary derived from a local variable would be a boundary derived from this
 * script's intent, which is the one thing the whole product claims it is not.
 *
 * Scope, stated rather than glossed: this reads the *invocation*, not the
 * contract events. For a single-invocation SAC `transfer` the two agree by
 * construction — the call's `(from, to, amount)` is the movement. The general
 * case is `apps/web/src/lib/extract.ts`, which reads events, refuses metadata
 * versions it does not recognise, and is what the browser path uses. This is a
 * deliberately narrow reader for a transaction whose shape this script chose.
 */
async function readObservedTransfer(hash, ledger, smartAccount) {
  const server = new rpc.Server(RPC_URL);
  const result = await server.getTransaction(hash);
  if (result.status !== 'SUCCESS') throw new Error(`observed transaction ${hash} is ${result.status}`);

  const tx = TransactionBuilder.fromXDR(result.envelopeXdr, TESTNET_PASSPHRASE);
  const operation = tx.operations.find((op) => op.type === 'invokeHostFunction');
  if (operation === undefined) throw new Error(`observed transaction ${hash} has no invokeHostFunction operation`);

  const call = operation.func.invokeContract();
  const contractId = Address.fromScAddress(call.contractAddress()).toString();
  const functionName = call.functionName().toString();
  const args = call.args().map((arg) => scValToNative(arg));

  return {
    hash,
    network: 'testnet',
    ledger,
    source: smartAccount,
    invocations: [{ contractId, functionName, args: args.map((a) => String(a)) }],
    movements: [
      { asset: contractId, from: String(args[0]), to: String(args[1]), amount: String(args[2]) },
    ],
    attribution: 'exact',
  };
}

async function run() {
  const server = new rpc.Server(RPC_URL);
  const record = { network: 'testnet', producedBy: 'node packages/chain/scripts/acceptance.mjs run' };

  // --- 1, 2: two keys, two friendbot calls -------------------------------
  const owner = localKey('OWNER');
  const agent = localKey('AGENT');
  assertDistinctSigners(owner.raw, agent.raw);
  record.ownerSigner = owner.publicKey;
  record.agentSigner = agent.publicKey;
  console.log(`owner        : ${owner.publicKey}`);
  console.log(`agent        : ${agent.publicKey}`);

  record.fundOwnerTx = await fund(owner.publicKey);
  record.fundAgentTx = await fund(agent.publicKey);
  console.log(`friendbot#1  : ${explorer(record.fundOwnerTx)}`);
  console.log(`friendbot#2  : ${explorer(record.fundAgentTx)}`);

  // --- 3: deploy ---------------------------------------------------------
  const deployed = await deploySmartAccount(owner);
  if (!report('deploy', deployed)) return;
  const smartAccount = deployedContractAddress(deployed.returnValue);
  record.deployTx = deployed.hash;
  record.smartAccount = smartAccount;
  console.log(`smartAccount : ${smartAccount}`);

  // --- the Default rule, read back rather than assumed to be 0 -----------
  const readOptions = { rpcUrl: RPC_URL, simulationSource: owner.publicKey };
  const initialRules = await readAllContextRules(readOptions, smartAccount);
  const defaultRule = initialRules.find((rule) => rule.contextType === 'Default');
  if (defaultRule === undefined) {
    console.log('the constructor did not leave a Default rule; nothing below can be signed');
    return;
  }
  record.defaultRuleId = defaultRule.id;
  console.log(`defaultRule  : id ${defaultRule.id} name ${JSON.stringify(defaultRule.name)}`);

  const expiry = (await server.getLatestLedger()).sequence + 200;
  const ownerSigns = signAs({
    signer: owner.signer,
    verifier: VERIFIER,
    contextRuleIds: [defaultRule.id],
    expirationLedger: expiry,
    passphrase: TESTNET_PASSPHRASE,
  });

  // --- 4: fund the smart account, owner's classic auth --------------------
  const seeded = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    signEnvelope: owner.signEnvelope,
    func: transferFunc(owner.publicKey, smartAccount, SEED_AMOUNT),
    label: 'seed',
  });
  if (!report('seed', seeded)) return;
  record.seedTx = seeded.hash;

  // --- 5: the observed transaction — the person's own -------------------
  const observed = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    signEnvelope: owner.signEnvelope,
    func: transferFunc(smartAccount, agent.publicKey, OBSERVED_AMOUNT),
    signAuthEntry: ownerSigns,
    label: 'observe',
  });
  if (!report('observe', observed)) return;
  record.observedTx = observed.hash;

  const observedLedger = (await server.getTransaction(observed.hash)).ledger;
  const observedTransaction = await readObservedTransfer(observed.hash, observedLedger, smartAccount);
  record.observedLedger = observedLedger;
  record.observedAmount = observedTransaction.movements[0].amount;

  // --- derive, then lower. Both pure; neither touches the network. -------
  const proposal = synthesize(observedTransaction);
  const plan = lower(proposal);
  const derivedCap = plan.rules[0].policies[0].limit;
  record.derivedCap = derivedCap;
  record.windowLedgers = plan.rules[0].policies[0].windowLedgers;
  record.validUntilLedger = plan.rules[0].validUntilLedger;
  console.log(`derived      : cap ${derivedCap} over ${record.windowLedgers} ledgers, valid until ${record.validUntilLedger}`);
  if (derivedCap !== String(OBSERVED_AMOUNT)) {
    console.log(`             ! derived cap ${derivedCap} != observed outflow ${OBSERVED_AMOUNT}`);
  }

  // --- 6: install the derived boundary -----------------------------------
  const [installFunc, ...rest] = installFunctions(plan, {
    smartAccount,
    verifier: VERIFIER,
    spendingLimitPolicy: POLICY,
    agentPublicKey: agent.raw,
    ownerPublicKey: owner.raw,
  });
  if (rest.length > 0) {
    console.log(`             ! plan lowered to ${rest.length + 1} rules; this script installs one`);
  }

  const installed = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    signEnvelope: owner.signEnvelope,
    func: installFunc,
    signAuthEntry: ownerSigns,
    label: 'install',
  });
  if (!report('install', installed)) return;
  record.installTx = installed.hash;

  const ruleId = contextRuleIdFrom(installed.returnValue);
  record.contextRuleId = ruleId;
  console.log(`contextRule  : id ${ruleId}`);

  const agentSigns = signAs({
    signer: agent.signer,
    verifier: VERIFIER,
    contextRuleIds: [ruleId],
    expirationLedger: expiry,
    passphrase: TESTNET_PASSPHRASE,
  });

  // --- 7: the agent's permitted transfer, paid for by the agent ----------
  const permittedFunc = transferFunc(smartAccount, owner.publicKey, AGENT_SPEND);
  const permitted = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: agent.publicKey,
    signEnvelope: agent.signEnvelope,
    func: permittedFunc,
    signAuthEntry: agentSigns,
    label: 'permitted',
  });
  if (!report('permitted', permitted)) return;
  record.permittedTx = permitted.hash;

  // --- 8: over the cap. Refused on a ledger, not only in simulation. -----
  const overAmount = BigInt(derivedCap) * 2n;
  const [recorded] = await recordAuthEntries({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: agent.publicKey,
    func: permittedFunc,
  });
  const overEntry = xdr.SorobanAuthorizationEntry.fromXDR(recorded.toXDR());
  overEntry.rootInvocation().function().contractFn().args()[2] = i128(overAmount);

  const refused = await submitWithBorrowedFootprint({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: agent.publicKey,
    signEnvelope: agent.signEnvelope,
    func: transferFunc(smartAccount, owner.publicKey, overAmount),
    transactionData: permitted.transactionData,
    auth: [await agentSigns(overEntry)],
    label: 'over-limit',
  });
  report('over-limit', refused);
  if (refused.stage !== 'ledger') return;
  record.refusedTx = refused.hash;
  record.refusedCodes = refused.codes.map(describeContractError);
  record.refusedIsBoundaryRefusal = isBoundaryRefusal(refused.codes);
  console.log(`             boundary refusal: ${record.refusedIsBoundaryRefusal}`);

  // --- the owner's revoke, simulated but not yet submitted ---------------
  // Its footprint is what lets the agent's *attempt* at the same call reach a
  // ledger. Without a borrowed footprint the attempt fails in simulation, has
  // no hash, and becomes this repository's word for what would have happened.
  const revokeFunc = removeContextRuleFunction(smartAccount, ruleId);
  const revokeFootprint = await enforcingFootprint({
    feeSource: owner.publicKey,
    func: revokeFunc,
    sign: ownerSigns,
  });

  // --- 8b (F2): the agent tries to remove its own boundary ---------------
  // Refused by the contract, not by Limen declining to offer a button. The
  // agent's rule is CallContract(token); revoking is a call to the account
  // itself, which that context does not match.
  const [agentRevokeEntry] = await recordAuthEntries({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: agent.publicKey,
    func: revokeFunc,
  });
  const agentRevoke = await submitWithBorrowedFootprint({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: agent.publicKey,
    signEnvelope: agent.signEnvelope,
    func: revokeFunc,
    transactionData: revokeFootprint,
    auth: [await agentSigns(agentRevokeEntry)],
    label: 'agent-revoke',
  });
  report('agent-revoke', agentRevoke);
  if (agentRevoke.stage === 'ledger') {
    record.agentRevokeTx = agentRevoke.hash;
    record.agentRevokeCodes = agentRevoke.codes.map(describeContractError);
    record.agentRevokeSucceeded = agentRevoke.ok;
    console.log(`             boundary refusal: ${isBoundaryRefusal(agentRevoke.codes)}`);
  }

  // --- 9: the owner revokes ----------------------------------------------
  const revoked = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    signEnvelope: owner.signEnvelope,
    func: revokeFunc,
    signAuthEntry: ownerSigns,
    label: 'revoke',
  });
  if (!report('revoke', revoked)) return;
  record.revokeTx = revoked.hash;

  // Re-read rather than assume the write landed.
  const afterRevoke = await readAllContextRules(readOptions, smartAccount);
  record.rulesAfterRevoke = afterRevoke.map((rule) => rule.id);
  console.log(`rules after  : [${record.rulesAfterRevoke.join(', ')}]`);

  // --- 10: the agent repeats the call that worked ------------------------
  const postRevoke = await submitWithBorrowedFootprint({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: agent.publicKey,
    signEnvelope: agent.signEnvelope,
    func: permittedFunc,
    transactionData: permitted.transactionData,
    auth: permitted.signedAuth,
    label: 'post-revoke',
  });
  report('post-revoke', postRevoke);
  if (postRevoke.stage === 'ledger') {
    record.postRevokeTx = postRevoke.hash;
    record.postRevokeCodes = postRevoke.codes.map(describeContractError);
    record.postRevokeIsBoundaryRefusal = isBoundaryRefusal(postRevoke.codes);
    record.postRevokeIsRevokedRule = isRevokedRule(postRevoke.codes);
    console.log(`             boundary refusal: ${record.postRevokeIsBoundaryRefusal}`);
    console.log(`             revoked rule    : ${record.postRevokeIsRevokedRule}`);
  }

  console.log('\n--- record ---');
  console.log(JSON.stringify(record, null, 2));
}

/**
 * The footprint from an enforcing simulation, without submitting.
 *
 * Same two-simulation dance as `submitAuthorized`, stopped one step early. The
 * caller wants the footprint, not the transaction.
 */
async function enforcingFootprint({ feeSource, func, sign }) {
  const server = new rpc.Server(RPC_URL);
  const auth = [];
  for (const entry of await recordAuthEntries({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource,
    func,
  })) {
    auth.push(await sign(entry));
  }

  const tx = new TransactionBuilder(await server.getAccount(feeSource), {
    fee: '2000000',
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`enforcing simulation failed: ${sim.error}`);
  return sim.transactionData.build();
}

/**
 * F4: can a browser discover the nested authorization a `Delegated` owner needs?
 *
 * `Signer::Delegated(addr)` resolves by calling `addr.require_auth_for_args`
 * from inside `__check_auth` (`storage.rs:353`), which raises a *nested*
 * authorization requirement. Recording-mode simulation never executes
 * `__check_auth`, so that requirement cannot appear in its `result.auth`.
 *
 * The question is whether the **enforcing** simulation — the second one, with
 * the outer entry already attached, which this project runs anyway for
 * footprint reasons — surfaces it. If it does, the wallet owner path costs
 * almost nothing. If it does not, the nested entry must be hand-constructed,
 * and step 5 of the plan is expensive.
 *
 * This deploys a throwaway account owned by `Delegated(G…)` and asks. It
 * answers a question; it does not build the wallet path.
 */
async function f4() {
  const owner = localKey('OWNER');
  const walletOwner = localKey('WALLET');

  console.log(`feeSource    : ${owner.publicKey}`);
  console.log(`delegatedTo  : ${walletOwner.publicKey}`);
  console.log(`friendbot#1  : ${explorer(await fund(owner.publicKey))}`);
  console.log(`friendbot#2  : ${explorer(await fund(walletOwner.publicKey))}`);

  const deployed = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    signEnvelope: owner.signEnvelope,
    func: deployAccountFunction({
      accountWasmHash: manifest.contracts.account.wasmHash,
      deployer: owner.publicKey,
      owner: { kind: 'delegated', address: walletOwner.publicKey },
    }),
    label: 'deploy(delegated)',
  });
  if (!report('deploy', deployed)) return;
  const smartAccount = deployedContractAddress(deployed.returnValue);
  console.log(`smartAccount : ${smartAccount}`);
  console.log(`ownerSigner  : ${JSON.stringify(scValToNative(ownerSignerScVal({ kind: 'delegated', address: walletOwner.publicKey })))}`);

  const readOptions = { rpcUrl: RPC_URL, simulationSource: owner.publicKey };
  const rules = await readAllContextRules(readOptions, smartAccount);
  const defaultRule = rules.find((rule) => rule.contextType === 'Default');
  console.log(`defaultRule  : id ${defaultRule?.id} signers ${JSON.stringify(defaultRule?.signers)}`);
  if (defaultRule === undefined) return;

  // Seed it, so the observed call has something to move.
  const seeded = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    signEnvelope: owner.signEnvelope,
    func: transferFunc(owner.publicKey, smartAccount, SEED_AMOUNT),
    label: 'seed',
  });
  if (!report('seed', seeded)) return;

  const server = new rpc.Server(RPC_URL);
  const func = transferFunc(smartAccount, owner.publicKey, OBSERVED_AMOUNT);

  // Recording simulation: the outer entry only, as expected.
  const recording = await recordAuthEntries({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: owner.publicKey,
    func,
  });
  console.log(`\nrecording simulation returned ${recording.length} auth entr${recording.length === 1 ? 'y' : 'ies'}:`);
  for (const entry of recording) describeEntry(entry);

  // Two enforcing simulations, because the first shape of this experiment
  // asked the wrong question and got a confident answer to it.
  //
  // The payload has to *name* the Delegated signer. `check_auth` matches the
  // rule's signers against `signatures.signers.keys()` and, for a rule with no
  // policies, requires every one of them to be present (`storage.rs:313-319`)
  // — so an empty map fails at the threshold check with UnvalidatedContext
  // #3002, from inside `__check_auth`, before the Delegated branch is ever
  // reached. That failure looks exactly like a genuine "nested auth cannot be
  // discovered" result and is nothing of the kind.
  //
  // The bytes mapped to the signer are irrelevant: `authenticate` ignores
  // `sig_data` entirely for `Signer::Delegated` and calls
  // `addr.require_auth_for_args((auth_digest,))` (`storage.rs:353-356`). Empty
  // bytes are therefore the honest value — there is no signature here, and a
  // placeholder that looked like one would be a lie in the payload.
  //
  // So: the empty map is kept as a control, and the named signer is the real
  // question. Running both is what makes the answer readable.
  const expiry = (await server.getLatestLedger()).sequence + 200;
  const delegated = delegatedSigner(walletOwner.publicKey);

  const shapes = [
    ['control: signers {} (expected to fail the threshold check)', emptyAuthPayload([defaultRule.id])],
    [
      'the question: signers { Delegated(G…): 0 bytes }',
      authPayload([{ signer: delegated, signature: new Uint8Array(0) }], [defaultRule.id]),
    ],
  ];

  for (const [label, payload] of shapes) {
    const attached = [];
    for (const entry of recording) {
      const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
      const credentials = clone.credentials().address();
      credentials.signatureExpirationLedger(expiry);
      credentials.signature(payload);
      attached.push(clone);
    }

    const tx = new TransactionBuilder(await server.getAccount(owner.publicKey), {
      fee: '2000000',
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(Operation.invokeHostFunction({ func, auth: attached }))
      .setTimeout(180)
      .build();

    console.log(`\n--- ${label}`);
    const enforcing = await server.simulateTransaction(tx);
    const surfaced = enforcing.result?.auth ?? [];
    if (rpc.Api.isSimulationError(enforcing)) {
      // The decoded contract code is the whole point of reading this failure.
      // #3002 means the payload never got past the threshold check and the
      // Delegated branch did not run; anything else means it did.
      const code = simulationErrorCode(enforcing.error);
      console.log(`enforcing simulation FAILED: ${enforcing.error.split('\n')[0]}`);
      console.log(`decoded contract error: ${code === null ? 'none' : describeContractError(code)}`);
      console.log(enforcing.error);
    } else {
      console.log('enforcing simulation SUCCEEDED');
    }
    console.log(`result.auth entries: ${surfaced.length}`);
    for (const entry of surfaced) describeEntry(entry);

    // The finding, stated by the script rather than by whoever reads its log:
    // a nested entry is one whose credentials name the wallet rather than the
    // smart account.
    const nested = surfaced.filter((entry) => {
      const credentials = entry.credentials();
      if (credentials.switch().name !== 'sorobanCredentialsAddress') return false;
      return Address.fromScAddress(credentials.address().address()).toString() === walletOwner.publicKey;
    });
    console.log(
      nested.length > 0
        ? `NESTED REQUIREMENT SURFACED for ${walletOwner.publicKey} — the wallet path is cheap`
        : 'no nested requirement naming the wallet was surfaced',
    );
  }
}

/** An `AuthPayload` naming rules but carrying no signatures. */
function emptyAuthPayload(contextRuleIds) {
  const ids = xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id)));
  return xdr.ScVal.scvMap(
    [
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('context_rule_ids'), val: ids }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signers'), val: xdr.ScVal.scvMap([]) }),
    ].sort((a, b) => (a.key().sym().toString() < b.key().sym().toString() ? -1 : 1)),
  );
}

function describeEntry(entry) {
  const credentials = entry.credentials();
  const kind = credentials.switch().name;
  const address =
    kind === 'sorobanCredentialsAddress'
      ? Address.fromScAddress(credentials.address().address()).toString()
      : '(source account)';
  const invocation = entry.rootInvocation().function();
  let what = invocation.switch().name;
  try {
    const fn = invocation.contractFn();
    what = `${Address.fromScAddress(fn.contractAddress()).toString()}::${fn.functionName().toString()}`;
  } catch {
    // A non-contract invocation has no contract function to name.
  }
  console.log(`  - ${kind} ${address} -> ${what}`);
}

/* ===================================================================== *
 * PLAN-V7 §5: the passkey path, proven from a script before any UI.
 * ===================================================================== */

const WEBAUTHN_VERIFIER = deployments.shared.webauthnVerifier.contract;

/** The order of the P-256 curve, for the low-S question §5.2 says to read. */
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/**
 * base64url, no padding — what `clientDataJSON.challenge` is compared against.
 *
 * The verifier does not decode the challenge. It base64url-encodes the 32-byte
 * payload itself and compares 43 bytes of ASCII, so this must match its encoder
 * exactly: no padding, `-` and `_`, no trailing `=`.
 */
function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bigIntFromBytes(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bytesFromBigInt(value, length) {
  const out = new Uint8Array(length);
  let rest = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/**
 * A synthetic authenticator: a P-256 key that signs the way a passkey would.
 *
 * **Deliberately WebCrypto rather than `node:crypto`, which §5.1 named.** This
 * file forbids `node:` imports and `test/browser-path.test.ts` enforces it, so
 * reaching for `node:crypto` here would have traded a real invariant for a
 * convenience. It is also the better instrument: `crypto.subtle` produces
 * IEEE-P1363 `r‖s` directly rather than DER, which is the encoding the verifier
 * wants, and it is the same API the browser path would use — so what this
 * proves is closer to what would ship.
 *
 * What it is not: a real authenticator. No hardware, no user gesture, no
 * biometric. It proves the *contract* side — the half that can actually refuse —
 * which is what §5.1 asks for and all it claims.
 */
async function syntheticAuthenticator() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error(`expected a 65-byte uncompressed SEC1 key, got ${raw.length} bytes`);
  }
  return {
    /** `key_data`: the 65-byte uncompressed point, as `canonicalize_key` slices it. */
    keyData: raw,
    async signRaw(message) {
      return new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, message),
      );
    },
  };
}

/**
 * One WebAuthn assertion over `authDigest`, encoded the way the verifier reads it.
 *
 * Every field below is what the source at `a9c42169` actually requires, read
 * rather than guessed — the four §5.2 unknowns and three the plan did not list:
 *
 *   - `key_data` is 65-byte uncompressed SEC1, optionally with a credential id
 *     after it, which `canonicalize_key` strips.
 *   - `sig_data` is **XDR-encoded `WebAuthnSigData`** carried in `Bytes`, not a
 *     struct argument: `{ authenticator_data, client_data, signature }` with
 *     `signature` a raw 64-byte `r‖s`, never DER.
 *   - `clientDataJSON` is parsed for exactly two fields, `type` and `challenge`.
 *     Origin is **not** checked — the contract documents that omission and
 *     leaves origin to the authenticator. `rpIdHash` is not checked either.
 *   - the challenge is base64url of the **first 32 bytes of the payload the
 *     account passes the verifier**, which `storage.rs::authenticate` shows is
 *     the `auth_digest`, not the host's `signature_payload`.
 *   - `authenticator_data` must be ≥ 37 bytes, and its flags byte at offset 32
 *     must have **UP (0x01) and UV (0x04) both set** — a verifier-side
 *     requirement no part of §5 anticipated.
 *   - the signed message is `authenticator_data ‖ sha256(client_data)`, hashed
 *     again by the contract before `secp256r1_verify`, which is what signing
 *     with SHA-256 over that message produces.
 */
async function webauthnAssertion(authenticator, digest, { challengeOverride, forceHighS } = {}) {
  const challenge = challengeOverride ?? base64Url(digest);

  // `origin` is present because a real authenticator always sends one, and
  // absent from the checks because the contract deliberately ignores it. Both
  // halves are the point: this is the shape a browser produces.
  const clientData = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'https://limen.invalid',
      crossOrigin: false,
    }),
  );

  // 32 bytes rpIdHash, 1 byte flags, 4 bytes counter. The rpIdHash is not
  // validated by this verifier, so it is filled with a recognisable constant
  // rather than a real one — a fake this script can point at, not a fake it
  // hides.
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(sha256(new TextEncoder().encode('limen.invalid')), 0);
  authenticatorData[32] = 0x01 | 0x04; // UP | UV, with BE and BS both clear.

  const signed = new Uint8Array([...authenticatorData, ...sha256(clientData)]);
  let signature = await authenticator.signRaw(signed);
  if (signature.length !== 64) {
    throw new Error(`expected a 64-byte r‖s signature, got ${signature.length}`);
  }

  // The low-S question, answered by construction and then measured by the
  // control case below rather than assumed either way.
  const r = signature.slice(0, 32);
  const s = bigIntFromBytes(signature.slice(32));
  const high = s > P256_ORDER / 2n;
  const wantHigh = forceHighS === true;
  const useS = high === wantHigh ? s : P256_ORDER - s;
  signature = new Uint8Array([...r, ...bytesFromBigInt(useS, 32)]);

  const sigData = structMap([
    ['authenticator_data', scvBytes(authenticatorData)],
    ['client_data', scvBytes(clientData)],
    ['signature', scvBytes(signature)],
  ]);

  return {
    bytes: new Uint8Array(sigData.toXDR()),
    sWasHigh: high,
    sIsHigh: useS > P256_ORDER / 2n,
  };
}

/**
 * The host-level reason a transaction failed, when there is no contract code.
 *
 * `result.codes` carries *contract* errors, and a signature the host's own
 * crypto rejects never reaches contract code to raise one. Reporting `(none)`
 * there would read as a decode that failed, when what actually happened is that
 * the refusal came from a layer below the contract. This reads the reason off
 * the transaction's own diagnostic events so the deny step still ends in a hash
 * *and* a decoded reason, which is what §1 asks of every refusal.
 */
async function hostErrorFor(hash) {
  const result = await new rpc.Server(RPC_URL).getTransaction(hash);
  const events = 'diagnosticEventsXdr' in result ? (result.diagnosticEventsXdr ?? []) : [];
  // The readable half of an event is the string data the host logs beside the
  // error. Walk topics and data, and keep any string that names the failure.
  const messages = [];
  for (const event of events) {
    try {
      const body = event.event().body().v0();
      for (const value of [...body.topics(), body.data()]) {
        const native = scValToNative(value);
        if (typeof native === 'string' && /signature|normal|invalid|crypto/i.test(native)) {
          messages.push(native);
        } else if (Array.isArray(native)) {
          for (const item of native) {
            if (typeof item === 'string' && /signature|normal|invalid|crypto/i.test(item)) {
              messages.push(item);
            }
          }
        }
      }
    } catch {
      /* an event we cannot read contributes nothing */
    }
  }
  return [...new Set(messages)];
}

/** A `signAs`-shaped signer backed by the synthetic authenticator. */
function passkeySigner(authenticator, options = {}) {
  return {
    rawPublicKey: () => authenticator.keyData,
    sign: async (digest) => (await webauthnAssertion(authenticator, digest, options)).bytes,
  };
}

async function webauthn() {
  const server = new rpc.Server(RPC_URL);
  const record = {
    network: 'testnet',
    producedBy: 'node packages/chain/scripts/acceptance.mjs webauthn',
    verifier: WEBAUTHN_VERIFIER,
  };

  console.log(`verifier     : ${WEBAUTHN_VERIFIER}`);

  // The passkey owns the account; a classic key pays the fees, because a
  // passkey cannot pay a Stellar transaction fee. That split is inherent, not
  // a shortcut, and it is what the UI would do too.
  const payer = localKey('PAYER');
  record.feePayer = payer.publicKey;
  console.log(`fee payer    : ${payer.publicKey}`);
  record.fundPayerTx = await fund(payer.publicKey);
  console.log(`friendbot    : ${explorer(record.fundPayerTx)}`);

  const authenticator = await syntheticAuthenticator();
  record.passkeyPublicKey = toHex(authenticator.keyData);
  console.log(`passkey key  : ${record.passkeyPublicKey.slice(0, 32)}… (${authenticator.keyData.length} bytes)`);

  // --- 1: an account whose owner is External(webauthnVerifier, key_data) ---
  const deployed = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: payer.publicKey,
    signEnvelope: payer.signEnvelope,
    func: deployAccountFunction({
      accountWasmHash: manifest.contracts.account.wasmHash,
      deployer: payer.publicKey,
      owner: { kind: 'external', verifier: WEBAUTHN_VERIFIER, publicKey: authenticator.keyData },
    }),
    label: 'deploy',
  });
  if (!report('deploy', deployed)) return record;
  const smartAccount = deployedContractAddress(deployed.returnValue);
  record.deployTx = deployed.hash;
  record.smartAccount = smartAccount;
  console.log(`smartAccount : ${smartAccount}`);

  const rules = await readAllContextRules(
    { rpcUrl: RPC_URL, simulationSource: payer.publicKey },
    smartAccount,
  );
  const defaultRule = rules.find((rule) => rule.contextType === 'Default');
  if (defaultRule === undefined) {
    console.log('no Default rule; nothing below can be signed');
    return record;
  }
  record.defaultRuleId = defaultRule.id;
  console.log(`defaultRule  : id ${defaultRule.id}`);

  // --- 2: seed it, so it has something to move ----------------------------
  const seeded = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: payer.publicKey,
    signEnvelope: payer.signEnvelope,
    func: transferFunc(payer.publicKey, smartAccount, SEED_AMOUNT),
    label: 'seed',
  });
  if (!report('seed', seeded)) return record;
  record.seedTx = seeded.hash;

  const expiry = (await server.getLatestLedger()).sequence + 200;
  const signOptions = {
    verifier: WEBAUTHN_VERIFIER,
    contextRuleIds: [defaultRule.id],
    expirationLedger: expiry,
    passphrase: TESTNET_PASSPHRASE,
  };

  // --- 3: a transfer the passkey authorizes, which must land --------------
  const spend = await submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: payer.publicKey,
    signEnvelope: payer.signEnvelope,
    func: transferFunc(smartAccount, payer.publicKey, OBSERVED_AMOUNT),
    signAuthEntry: signAs({ signer: passkeySigner(authenticator), ...signOptions }),
    label: 'passkey spend',
  });
  const spendLanded = report('passkey spend', spend);
  record.passkeySpendTx = spend.hash;
  record.passkeySpendOk = spendLanded;
  if (!spendLanded) {
    record.passkeySpendCodes = spend.codes ?? [];
    console.log('\nThe passkey signature was not accepted. Everything below is moot.');
    return record;
  }

  // --- 4 and 5: the control cases -----------------------------------------
  //
  // Both are *refusals*, and §1's first rule applies to them exactly as it does
  // to the boundary: never assert a refusal from an absence. A bad signature
  // fails the enforcing simulation, which produces no hash — and "the network
  // would have rejected this" in this repository's own voice is not evidence.
  //
  // So each borrows the footprint of the spend that just succeeded, which is
  // the same call with the same shape, and reaches a ledger to be refused
  // there. What comes back is a hash and a decoded code.
  const spendFunc = transferFunc(smartAccount, payer.publicKey, OBSERVED_AMOUNT);
  const refusalCase = async ({ label, options }) => {
    const [entry] = await recordAuthEntries({
      rpcUrl: RPC_URL,
      passphrase: TESTNET_PASSPHRASE,
      feeSource: payer.publicKey,
      func: spendFunc,
    });
    const signed = await signAs({ signer: passkeySigner(authenticator, options), ...signOptions })(
      xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR()),
    );
    const result = await submitWithBorrowedFootprint({
      rpcUrl: RPC_URL,
      passphrase: TESTNET_PASSPHRASE,
      feeSource: payer.publicKey,
      signEnvelope: payer.signEnvelope,
      func: spendFunc,
      transactionData: spend.transactionData,
      auth: [signed],
      label,
    });
    report(label, result);
    return result;
  };

  // §5.1 step 4: a challenge that does not match the digest must be refused.
  // F4's first version asked the wrong question and got a confident answer to
  // it, which is why this is here at all.
  const wrongChallenge = await refusalCase({
    label: 'wrong challenge',
    options: { challengeOverride: base64Url(new Uint8Array(32)) },
  });
  record.wrongChallengeStage = wrongChallenge.stage;
  record.wrongChallengeTx = wrongChallenge.hash;
  record.wrongChallengeRefusedOnLedger = wrongChallenge.stage === 'ledger' && !wrongChallenge.ok;
  record.wrongChallengeCodes = (wrongChallenge.codes ?? []).map(describeContractError);

  // §5.2's third unknown: is low-S normalisation required? Asked by signing the
  // same assertion with the high-S form of the same signature, which is
  // mathematically just as valid an ECDSA signature.
  const highS = await refusalCase({ label: 'high-S', options: { forceHighS: true } });
  record.highSStage = highS.stage;
  record.highSTx = highS.hash;
  record.highSAcceptedOnLedger = highS.stage === 'ledger' && highS.ok === true;
  record.highSCodes = (highS.codes ?? []).map(describeContractError);
  if (highS.stage === 'ledger' && !highS.ok && record.highSCodes.length === 0) {
    record.highSHostError = await hostErrorFor(highS.hash);
    console.log(`             host reason: ${record.highSHostError.join(' | ') || '(unreadable)'}`);
  }

  const verdict = (result) =>
    result.stage !== 'ledger'
      ? `INCONCLUSIVE — never reached a ledger (${result.stage}), which is evidence of nothing`
      : result.ok
        ? `ACCEPTED on a ledger (${result.hash})`
        : (result.codes ?? []).length > 0
          ? `REFUSED on a ledger with ${named(result.codes)} (${result.hash})`
          : `REFUSED on a ledger below contract level — ${(record.highSHostError ?? []).join(' | ') || 'no contract code, host reason unreadable'} (${result.hash})`;

  console.log('\n--- what this run establishes -------------------------------');
  console.log(`passkey-owned account signed a transfer that landed : ${record.passkeySpendOk ? `YES (${record.passkeySpendTx})` : 'NO'}`);
  console.log(`a challenge that does not match the digest          : ${verdict(wrongChallenge)}`);
  console.log(`the same signature in high-S form                   : ${verdict(highS)}`);
  console.log('\nRUN RECORD ' + JSON.stringify(record));
  return record;
}

const [command] = process.argv.slice(2);
if (command === 'deploy') await deploy();
else if (command === 'run') await run();
else if (command === 'f4') await f4();
else if (command === 'webauthn') await webauthn();
else {
  console.error('usage: acceptance.mjs deploy | run | f4 | webauthn');
  process.exit(2);
}
