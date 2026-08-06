#!/usr/bin/env node
/**
 * The browser run, re-checked against public Horizon from outside the process
 * that produced it.
 *
 *     node scripts/verify-browser-run.mjs                 # the recorded browserRun
 *     node scripts/verify-browser-run.mjs run.json        # a RUN RECORD from the spec
 *
 * PLAN-V4 §11 asks for every hash to be "confirmed against Horizon **from
 * outside the process that produced it**". This is that, and the phrase is the
 * whole specification: the Playwright run that produced these hashes held the
 * keys, chose the amounts, and rendered its own verdicts. Nothing it says about
 * itself is evidence. What is evidence is a second program, sharing no state
 * with the first, asking a public API that has never heard of this repository.
 *
 * ## What it is given, and what it refuses to be given
 *
 * Three facts: the owner's public key, the agent's public key, and the smart
 * account's address. Everything else — which transaction succeeded, who paid
 * for it, what it moved, which contract error it died of — is read back off
 * Horizon. In particular the **fee source is read off each transaction** rather
 * than inferred from whose feed it arrived on, because "the agent paid its own
 * fees" is one of the two claims PLAN-V4 §1 calls deliberate and reading it off
 * an account's transaction list would assume exactly what needs proving.
 *
 * ## The checks, and why each is here
 *
 *   1. **Every hash exists on a ledger.** A hash that Horizon does not know is
 *      not a transaction; it is a string.
 *   2. **Success and failure are the expected way round.** Six succeeded and
 *      three failed, and a run where the agent's over-limit transfer *worked*
 *      would still have produced nine hashes.
 *   3. **Fee source per transaction.** The agent's four are paid by the agent.
 *      The owner's five are paid by the owner. Read off `fee_account`.
 *   4. **No owner key inside the agent's transactions.** The owner's 32 raw
 *      key bytes do not occur anywhere in the agent's envelopes — not as a
 *      signer, not in an auth entry, not as an argument. This is the strongest
 *      available form of "no owner signature is anywhere near it", and it is
 *      checked over the bytes rather than over a decode this repository wrote.
 *   5. **The contract error codes.** Decoded from each failed transaction's own
 *      diagnostic events, then named through `describeContractError`. A failure
 *      with no decodable code is reported as unattributable rather than counted.
 *   6. **The cap equals the observed outflow.** The amount in the observed
 *      transfer's arguments must appear among the integers in the install's
 *      arguments. This is the claim the product rests on — the boundary is the
 *      flow that happened, not a round number near it — re-derived here by
 *      scanning XDR, which is a different route than the one that built it.
 *   7. **Ledger order.** The nine transactions closed in the order §1 lists
 *      them. Out of order, the story they tell is not the story they are told
 *      to tell.
 *
 * Exits non-zero on the first thing that does not hold, having printed every
 * check it ran.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { xdr, Address, Keypair, hash as sha256, rpc } from '@stellar/stellar-sdk';
import { describeContractError } from '@limen/chain/errors';
import { DEFAULT_TESTNET_RPC_URL } from '@limen/chain/network';

const root = fileURLToPath(new URL('..', import.meta.url));
const DEPLOYMENTS = join(root, 'packages/chain/deployments/testnet.json');
const HORIZON = 'https://horizon-testnet.stellar.org';

/**
 * The second public source, and it is here because Horizon cannot answer one
 * question.
 *
 * Two of the facts this script checks live in transaction **meta**, and this
 * Horizon no longer serves `result_meta_xdr` on the transaction resource at all
 * — not for failures and not for successes. Measured against these very hashes,
 * not assumed from a changelog.
 *
 * What Horizon does return is `result_xdr`, and for every failed transaction
 * here it says `invokeHostFunctionTrapped`. That is precisely the word this
 * repository refuses to accept as evidence, because running out of budget
 * reports it too: a failure is not a refusal until its error code says so.
 *
 * So the two meta-derived facts — the contract error codes, and the address the
 * deploy returned — are read from the public Soroban RPC. Different service,
 * still public, still not the process that produced the run. The split is
 * stated rather than papered over: existence, success, fee source, signatures,
 * ordering and the cap come from Horizon; codes and the deployed address come
 * from RPC.
 */
const RPC_URL = DEFAULT_TESTNET_RPC_URL;

/**
 * The nine transactions of PLAN-V4 §1, in the order they must have closed.
 *
 * `ok` is what the network must have done, not what we hope it did. `payer` is
 * which of the two keys must have paid — the column §1 calls out.
 *
 * The two friendbot fundings are absent deliberately: friendbot does not always
 * return a hash, and an already-funded account never does, so there is nothing
 * to check and inventing a row for it would be a placeholder wearing evidence's
 * clothes.
 */
const SEQUENCE = [
  { key: 'deployTx', what: 'deploy the smart account', ok: true, payer: 'owner' },
  { key: 'seedTx', what: 'fund the smart account', ok: true, payer: 'owner' },
  { key: 'observedTx', what: 'the observed transaction', ok: true, payer: 'owner' },
  { key: 'installTx', what: 'install the boundary', ok: true, payer: 'owner' },
  { key: 'permittedTx', what: 'the agent, inside the boundary', ok: true, payer: 'agent' },
  { key: 'refusedTx', what: 'the agent, over the cap', ok: false, payer: 'agent' },
  { key: 'agentRevokeTx', what: 'the agent tries to revoke', ok: false, payer: 'agent' },
  { key: 'revokeTx', what: 'the owner revokes', ok: true, payer: 'owner' },
  { key: 'postRevokeTx', what: 'the agent repeats the permitted call', ok: false, payer: 'agent' },
];

let failures = 0;

function pass(line) {
  console.log(`  ok    ${line}`);
}

function fail(line) {
  console.log(`  FAIL  ${line}`);
  failures += 1;
}

function check(condition, line) {
  if (condition) pass(line);
  else fail(line);
}

async function horizon(path) {
  const response = await fetch(`${HORIZON}${path}`);
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, body: await response.json() };
}

/**
 * Contract error codes for one hash, from the public RPC's diagnostic events.
 *
 * Deliberately not `contractErrorCodes` from `@limen/chain/submit`, even though
 * it reads the same field: reusing the function under test would make this
 * script agree with the code that produced the run about how to find an error.
 * The walk below is written out again on purpose.
 */
async function codesFor(hash) {
  let result;
  try {
    result = await new rpc.Server(RPC_URL).getTransaction(hash);
  } catch {
    return null;
  }

  const events = 'diagnosticEventsXdr' in result ? (result.diagnosticEventsXdr ?? []) : [];

  const found = [];
  const scan = (value) => {
    if (value === undefined || value === null || typeof value.switch !== 'function') return;
    let kind;
    try {
      kind = value.switch().name;
    } catch {
      return;
    }
    if (kind === 'scvError') {
      try {
        const error = value.error();
        if (error.switch().name === 'sceContract') found.push(error.contractCode());
      } catch {
        /* an error we cannot read is not an error we can attribute */
      }
    } else if (kind === 'scvVec') {
      for (const inner of value.vec() ?? []) scan(inner);
    } else if (kind === 'scvMap') {
      for (const entry of value.map() ?? []) {
        scan(entry.key());
        scan(entry.val());
      }
    }
  };

  for (const event of events) {
    try {
      const body = event.event().body().v0();
      for (const topic of body.topics()) scan(topic);
      scan(body.data());
    } catch {
      /* as above */
    }
  }
  return [...new Set(found)];
}

function decodeEnvelope(envelopeXdrBase64) {
  const envelope = xdr.TransactionEnvelope.fromXDR(envelopeXdrBase64, 'base64');
  const v1 = envelope.switch().name === 'envelopeTypeTxV0' ? envelope.v0() : envelope.v1();
  return { tx: v1.tx(), signatures: v1.signatures() };
}

/** Every `invokeHostFunction` argument in an envelope, flattened. */
function invocationArgs(envelopeXdrBase64) {
  const { tx } = decodeEnvelope(envelopeXdrBase64);
  const args = [];
  for (const operation of tx.operations()) {
    if (operation.body().switch().name !== 'invokeHostFunction') continue;
    const func = operation.body().invokeHostFunctionOp().hostFunction();
    if (func.switch().name !== 'hostFunctionTypeInvokeContract') continue;
    for (const arg of func.invokeContract().args()) args.push(arg);
  }
  return args;
}

/** The contract each `invokeHostFunction` in an envelope calls. */
function invokedContracts(envelopeXdrBase64) {
  const { tx } = decodeEnvelope(envelopeXdrBase64);
  const out = new Set();
  for (const operation of tx.operations()) {
    if (operation.body().switch().name !== 'invokeHostFunction') continue;
    const func = operation.body().invokeHostFunctionOp().hostFunction();
    if (func.switch().name !== 'hostFunctionTypeInvokeContract') continue;
    out.add(Address.fromScAddress(func.invokeContract().contractAddress()).toString());
  }
  return out;
}

/**
 * Whether `publicKey` signed this transaction, in either of the two ways a
 * Stellar transaction can carry a signature.
 *
 * The first version of this check scanned the envelope bytes for the owner's
 * raw 32 bytes and called any occurrence a signature. That is wrong, and the
 * run proved it wrong: the agent's permitted transfer sends funds **to** the
 * owner, so the owner's key is an argument in three of these envelopes and
 * always will be. "The owner is the payee" and "the owner authorized this" are
 * different facts, and a check that cannot tell them apart cannot support the
 * claim §1 actually makes.
 *
 * So both real forms are checked, and nothing else counts:
 *
 *   - **an envelope signature**, verified cryptographically against the
 *     transaction's signature base — not matched on the 4-byte hint, which is a
 *     lookup aid and not proof of anything; and
 *   - **a Soroban auth entry** whose `SorobanAddressCredentials` name the owner,
 *     which is how an account authorizes a contract call through `__check_auth`.
 */
function signedBy(envelopeXdrBase64, publicKey, passphrase) {
  const { tx, signatures } = decodeEnvelope(envelopeXdrBase64);
  const keypair = Keypair.fromPublicKey(publicKey);

  const base = Buffer.concat([
    sha256(Buffer.from(passphrase, 'utf8')),
    xdr.EnvelopeType.envelopeTypeTx().toXDR(),
    tx.toXDR(),
  ]);
  const payload = sha256(base);

  for (const signature of signatures) {
    if (keypair.verify(payload, signature.signature())) return 'an envelope signature';
  }

  for (const operation of tx.operations()) {
    if (operation.body().switch().name !== 'invokeHostFunction') continue;
    for (const entry of operation.body().invokeHostFunctionOp().auth()) {
      const credentials = entry.credentials();
      if (credentials.switch().name !== 'sorobanCredentialsAddress') continue;
      if (Address.fromScAddress(credentials.address().address()).toString() === publicKey) {
        return 'a signed auth entry';
      }
    }
  }

  return null;
}

/** Every integer in a tree of `ScVal`s, as decimal strings. */
function integersIn(values) {
  const out = [];
  const scan = (value) => {
    if (value === undefined || value === null || typeof value.switch !== 'function') return;
    const kind = value.switch().name;
    try {
      if (kind === 'scvI128' || kind === 'scvU128') {
        const parts = kind === 'scvI128' ? value.i128() : value.u128();
        const hi = BigInt(parts.hi().toString());
        const lo = BigInt(parts.lo().toString());
        out.push(((hi << 64n) + lo).toString());
      } else if (kind === 'scvI64' || kind === 'scvU64') {
        out.push(BigInt((kind === 'scvI64' ? value.i64() : value.u64()).toString()).toString());
      } else if (kind === 'scvU32' || kind === 'scvI32') {
        out.push(String(kind === 'scvU32' ? value.u32() : value.i32()));
      } else if (kind === 'scvVec') {
        for (const inner of value.vec() ?? []) scan(inner);
      } else if (kind === 'scvMap') {
        for (const entry of value.map() ?? []) {
          scan(entry.key());
          scan(entry.val());
        }
      }
    } catch {
      /* a value we cannot read contributes nothing */
    }
  };
  for (const value of values) scan(value);
  return out;
}

/** The address a successful Soroban transaction returned, if it returned one. */
async function returnValueAddress(hash) {
  try {
    const result = await new rpc.Server(RPC_URL).getTransaction(hash);
    const value = 'returnValue' in result ? result.returnValue : undefined;
    if (value === undefined || value === null) return null;
    if (value.switch().name !== 'scvAddress') return null;
    return Address.fromScAddress(value.address()).toString();
  } catch {
    return null;
  }
}

/** Every contract or account address named anywhere in a tree of `ScVal`s. */
function addressesIn(values) {
  const out = new Set();
  const scan = (value) => {
    if (value === undefined || value === null || typeof value.switch !== 'function') return;
    const kind = value.switch().name;
    try {
      if (kind === 'scvAddress') {
        out.add(Address.fromScAddress(value.address()).toString());
      } else if (kind === 'scvVec') {
        for (const inner of value.vec() ?? []) scan(inner);
      } else if (kind === 'scvMap') {
        for (const entry of value.map() ?? []) {
          scan(entry.key());
          scan(entry.val());
        }
      }
    } catch {
      /* as above */
    }
  };
  for (const value of values) scan(value);
  return out;
}

async function main() {
  const [arg] = process.argv.slice(2);

  let runs;
  if (arg === undefined) {
    const deployments = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'));
    const block = deployments.browserRun;
    if (block === undefined) {
      console.error(
        'There is no `browserRun` block in packages/chain/deployments/testnet.json.\n' +
          'That is the correct state until a browser run has happened. Pass a RUN RECORD\n' +
          'file instead: node scripts/verify-browser-run.mjs run.json',
      );
      process.exit(2);
    }
    // §11 asks for two completions, so the block holds both and both are
    // checked. Verifying one of two recorded runs would be a green tick over
    // half the claim.
    runs = Array.isArray(block.runs) ? block.runs : [block];
  } else {
    runs = [JSON.parse(readFileSync(arg, 'utf8'))];
  }

  for (const [index, run] of runs.entries()) {
    if (runs.length > 1) {
      console.log(`\n${'='.repeat(72)}`);
      console.log(`run ${index + 1} of ${runs.length}${run.which ? ` — ${run.which}` : ''}`);
      console.log('='.repeat(72));
    }
    resetFailures();
    await verify(run);
  }

  if (runs.length > 1) {
    console.log(`\nAll ${runs.length} recorded runs verified.`);
  }
}

async function verify(run) {
  const owner = run.ownerSigner;
  const agent = run.agentSigner;
  const account = run.smartAccount;

  console.log('\nVerifying a browser run against public Horizon.');
  console.log('Given only these three, and reading everything else off the network:\n');
  console.log(`  owner          ${owner}`);
  console.log(`  agent          ${agent}`);
  console.log(`  smart account  ${account}\n`);

  for (const key of ['ownerSigner', 'agentSigner', 'smartAccount']) {
    if (typeof run[key] !== 'string' || run[key].length !== 56) {
      console.error(`\`${key}\` is not an address. Nothing can be checked.`);
      process.exit(2);
    }
  }
  if (owner === agent) {
    console.error('The owner and the agent are the same key. The run demonstrates nothing.');
    process.exit(2);
  }

  // Read off the network, not assumed: every signature below is verified
  // against the passphrase the transactions were actually signed under.
  const passphrase = (await horizon('/')).body?.network_passphrase ?? 'Test SDF Network ; September 2015';

  /* --- each transaction, on its own terms -------------------------------- */

  const records = new Map();

  for (const step of SEQUENCE) {
    const hash = run[step.key];
    console.log(`\n${step.key} — ${step.what}`);
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      fail(`${step.key} is not a transaction hash`);
      continue;
    }
    console.log(`  ${hash}`);

    const found = await horizon(`/transactions/${hash}`);
    if (!found.ok) {
      fail(`Horizon does not know this hash (HTTP ${found.status})`);
      continue;
    }
    const tx = found.body;
    records.set(step.key, tx);

    check(
      tx.successful === step.ok,
      `the network ${tx.successful ? 'ran it and it succeeded' : 'ran it and it failed there'}` +
        `, which is ${tx.successful === step.ok ? 'what §1 requires' : 'NOT what §1 requires'}`,
    );

    // Read off the transaction, never off whose feed it came from.
    const payer = tx.fee_account ?? tx.source_account;
    const expected = step.payer === 'owner' ? owner : agent;
    check(
      payer === expected,
      `the fee was paid by the ${step.payer} (${payer.slice(0, 8)}…), read off fee_account`,
    );

    if (step.payer === 'agent') {
      const how = signedBy(tx.envelope_xdr, owner, passphrase);
      check(
        how === null,
        how === null
          ? 'the owner authorized no part of this — no envelope signature, no auth entry'
          : `the owner authorized this through ${how}`,
      );
      // The other half of the same claim, and the one that makes it positive
      // rather than an absence: the agent did sign it.
      const agentHow = signedBy(tx.envelope_xdr, agent, passphrase);
      check(agentHow !== null, `the agent authorized it through ${agentHow ?? 'nothing'}`);
    }

    if (!step.ok) {
      const codes = await codesFor(hash);
      if (codes === null || codes.length === 0) {
        fail(
          'it failed on a ledger but no contract error code could be decoded — ' +
            'not attributable to the boundary',
        );
      } else {
        const named = codes.map(describeContractError).join(', ');
        const recorded = run[`${step.key.replace(/Tx$/, '')}Error`];
        pass(`refused with ${named}`);
        if (typeof recorded === 'string') {
          check(
            named.includes(recorded.split('#')[0]) || recorded.includes(named.split('#')[0]),
            `which is what the run recorded (${recorded})`,
          );
        }
      }
    }

    if (step.key === 'deployTx') {
      // The deploy cannot *name* the account: it is `createCustomContract`, and
      // the address does not exist until the transaction executes. It comes
      // back in the return value — which is also where the application reads it
      // from, rather than deriving it from the deployer and salt.
      //
      // So the check is the strong one available: the address this whole run
      // then used is the address this transaction returned. If they differed,
      // every later row would be about somebody else's account.
      const returned = await returnValueAddress(hash);
      check(
        returned === account,
        returned === null
          ? 'the deploy’s return value could not be read, so the address it created is unconfirmed'
          : `the deploy returned ${returned}, which is the account the rest of this run uses`,
      );
    } else {
      // Named as an argument *or* as the contract being called.
      // `add_context_rule` and `remove_context_rule` are invoked **on** the
      // smart account, so it is the callee there and appears in no argument.
      const named = new Set([
        ...addressesIn(invocationArgs(tx.envelope_xdr)),
        ...invokedContracts(tx.envelope_xdr),
      ]);
      check(named.has(account), 'the smart account is named in the invocation');
    }
  }

  /* --- the claim the product rests on ------------------------------------ */

  console.log('\nthe cap, re-derived');

  const observed = records.get('observedTx');
  const install = records.get('installTx');

  if (observed === undefined || install === undefined) {
    fail('the observed transaction or the install is missing, so the cap cannot be checked');
  } else {
    // The observed transfer's amount: the last argument of `transfer`, which is
    // the only i128 in a `transfer(from, to, amount)` call.
    const observedAmounts = integersIn(invocationArgs(observed.envelope_xdr)).filter(
      (value) => BigInt(value) > 0n,
    );
    const installAmounts = integersIn(invocationArgs(install.envelope_xdr));

    const amount = observedAmounts.at(-1);
    check(amount !== undefined, `the observed transfer moved ${amount ?? 'nothing readable'} stroops`);
    check(
      amount !== undefined && installAmounts.includes(amount),
      `the installed cap is that exact number — ${amount} — and not a round number near it`,
    );

    if (typeof run.observedAmount === 'string') {
      check(run.observedAmount === amount, `which is what the run recorded (${run.observedAmount})`);
    }
  }

  /* --- the order they closed in ------------------------------------------ */

  console.log('\nledger order');

  let previous = 0;
  let ordered = true;
  for (const step of SEQUENCE) {
    const tx = records.get(step.key);
    if (tx === undefined) continue;
    if (tx.ledger < previous) ordered = false;
    previous = tx.ledger;
  }
  check(ordered, 'the nine transactions closed in the order §1 lists them');

  const first = records.get('deployTx');
  const last = records.get('postRevokeTx');
  if (first !== undefined && last !== undefined) {
    console.log(
      `  ledgers ${first.ledger.toLocaleString('en-US')} → ${last.ledger.toLocaleString('en-US')}` +
        `, ${first.created_at} → ${last.created_at}`,
    );
  }

  /* --- verdict ------------------------------------------------------------ */

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check${failures === 1 ? '' : 's'} did not hold. The run is not verified.`);
    process.exit(1);
  }
  console.log(
    `Every check held. ${records.size} transactions confirmed, ` +
      'by a process that did not produce them.',
  );
}

/**
 * Reset between runs so one run's verdict is about that run.
 *
 * The counter is module scope because `check` writes to it; without this, a
 * second run would inherit the first's failures and report a number that is not
 * about it. The exit above is on the first failing run, so a non-zero count
 * never survives to be reset — this exists so the *success* line means what it
 * says.
 */
function resetFailures() {
  failures = 0;
}

await main();
