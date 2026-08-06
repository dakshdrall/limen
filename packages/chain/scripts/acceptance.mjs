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
  signAs,
  simulationErrorCode,
  submitAuthorized,
  submitWithBorrowedFootprint,
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

const [command] = process.argv.slice(2);
if (command === 'deploy') await deploy();
else if (command === 'run') await run();
else if (command === 'f4') await f4();
else {
  console.error('usage: acceptance.mjs deploy | run | f4');
  process.exit(2);
}
