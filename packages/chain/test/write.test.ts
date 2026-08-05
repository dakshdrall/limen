/**
 * What deploy, install and revoke actually put on the wire.
 *
 * Same standing as `authpayload.test.ts`: these pin shapes, they cannot prove
 * the shapes are right, and the host is what proves that. Each shape below has
 * been executed against live testnet by `scripts/acceptance.mjs run`, and the
 * hashes are in `deployments/testnet.json` under `v4ChainRun`.
 *
 * The function signatures are transcribed from the deployed wasm's own
 * `contractspecv0` section, read off the ledger rather than from a summary of
 * the Rust:
 *
 *     __constructor(signers: Vec, policies: Map)
 *     add_context_rule(context_type: Udt, name: String, valid_until: Option<u32>,
 *                      signers: Vec, policies: Map)
 *     remove_context_rule(context_rule_id: u32)
 *     remove_policy(context_rule_id: u32, policy_id: u32)
 */

import { describe, expect, it } from 'vitest';
import { Address, scValToNative, xdr } from '@stellar/stellar-sdk';
import { deployAccountFunction, ownerSignerScVal, randomSalt } from '../src/deploy.js';
import { addContextRuleFunction, contextRuleIdFrom, installFunctions } from '../src/install.js';
import { removeContextRuleFunction, removePolicyFunction } from '../src/revoke.js';
import { isBoundaryRefusal, isRevokedRule } from '../src/errors.js';
import { toHex } from '../src/bytes.js';
import type { InstallPlan, PlannedContextRule } from '../src/plan.js';

const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const VERIFIER = 'CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const POLICY = 'CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE';
const ACCOUNT = 'CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V';
const DEPLOYER = 'GAROIM2HS4IQ4Q2A7GEANZK2RVH3HYX7RGY6FUOHLL7IVEYNELBFNXQT';
const WASM_HASH = '1815dda1b96ea6d23865be8a16ffcbe0b8336d15fc0d3d5ada776c06cb17afde';

const OWNER = new Uint8Array(32).fill(2);
const AGENT = new Uint8Array(32).fill(1);

const context = {
  smartAccount: ACCOUNT,
  verifier: VERIFIER,
  spendingLimitPolicy: POLICY,
  agentPublicKey: AGENT,
  ownerPublicKey: OWNER,
};

const rule = (over: Partial<PlannedContextRule> = {}): PlannedContextRule => ({
  contract: TOKEN,
  name: 'limen-0',
  validUntilLedger: 4_097_692,
  policies: [{ kind: 'spending_limit', asset: TOKEN, limit: '1000000', windowLedgers: 120_960 }],
  ...over,
});

describe('deploy', () => {
  const options = {
    accountWasmHash: WASM_HASH,
    deployer: DEPLOYER,
    owner: { kind: 'external', verifier: VERIFIER, publicKey: OWNER } as const,
  };

  it('creates a contract from the wasm hash in the manifest', () => {
    const func = deployAccountFunction(options);
    expect(func.switch().name).toBe('hostFunctionTypeCreateContractV2');
    expect(toHex(new Uint8Array(func.createContractV2().executable().wasmHash()))).toBe(WASM_HASH);
  });

  it('passes the constructor one signer and no policies', () => {
    // The empty policy map is not an oversight. The constructor's Default rule
    // holds the owner signer and nothing else; policies arrive later, attached
    // to rules the owner installs deliberately.
    const args = deployAccountFunction(options).createContractV2().constructorArgs();
    expect(args).toHaveLength(2);
    expect(args[0]!.vec()).toHaveLength(1);
    expect(args[1]!.map()).toHaveLength(0);
  });

  it('refuses a wasm hash that is not hex rather than truncating it', () => {
    // A hash silently cut short at the first bad character deploys a different
    // contract than the one that was named.
    expect(() => deployAccountFunction({ ...options, accountWasmHash: 'not a hash' })).toThrow(/hex/);
    expect(() => deployAccountFunction({ ...options, accountWasmHash: WASM_HASH.slice(0, 63) })).toThrow(/hex/);
  });

  it('encodes External and Delegated owners as different signers', () => {
    // A wallet cannot be an `External` signer: `External` hands raw bytes to a
    // verifier contract, and wallets sign envelopes, not arbitrary digests.
    // These being distinct encodings is what makes that a choice at creation.
    const external = ownerSignerScVal({ kind: 'external', verifier: VERIFIER, publicKey: OWNER });
    const delegated = ownerSignerScVal({ kind: 'delegated', address: DEPLOYER });
    expect(external.vec()![0]!.sym().toString()).toBe('External');
    expect(delegated.vec()![0]!.sym().toString()).toBe('Delegated');
  });

  it('salts each creation differently, so one owner can hold several accounts', () => {
    expect(toHex(randomSalt())).not.toBe(toHex(randomSalt()));
    expect(randomSalt()).toHaveLength(32);
  });
});

describe('install', () => {
  it('calls add_context_rule on the account with five arguments', () => {
    const func = addContextRuleFunction(rule(), context);
    const call = func.invokeContract();
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(ACCOUNT);
    expect(call.functionName().toString()).toBe('add_context_rule');
    expect(call.args()).toHaveLength(5);
  });

  it('pins the rule to one contract, not to Default', () => {
    // A Default rule authorizes any context — including a call to the account
    // itself, which is how a revoke is authorized. Installing the agent under
    // one would hand it the power the whole demonstration says it lacks.
    const [contextType] = addContextRuleFunction(rule(), context).invokeContract().args();
    expect(contextType!.vec()![0]!.sym().toString()).toBe('CallContract');
    expect(Address.fromScVal(contextType!.vec()![1]!).toString()).toBe(TOKEN);
  });

  it('gives the rule the agent signer, not the owner', () => {
    const signers = addContextRuleFunction(rule(), context).invokeContract().args()[3]!;
    const key = signers.vec()![0]!.vec()![2]!.bytes();
    expect(toHex(new Uint8Array(key))).toBe(toHex(AGENT));
  });

  it('encodes Option<u32> valid_until as the value, and no expiry as void', () => {
    // `u32(0)` for "no expiry" would install a rule that expired at ledger
    // zero, which reads on a screen as a rule that is simply gone.
    const withExpiry = addContextRuleFunction(rule(), context).invokeContract().args()[2]!;
    expect(withExpiry.switch().name).toBe('scvU32');
    expect(withExpiry.u32()).toBe(4_097_692);

    const without = addContextRuleFunction(rule({ validUntilLedger: null }), context)
      .invokeContract()
      .args()[2]!;
    expect(without.switch().name).toBe('scvVoid');
  });

  it('attaches the spending limit under the policy contract address', () => {
    const policies = addContextRuleFunction(rule(), context).invokeContract().args()[4]!;
    const entry = policies.map()![0]!;
    expect(Address.fromScVal(entry.key()).toString()).toBe(POLICY);
    expect(scValToNative(entry.val())).toEqual({ spending_limit: 1000000n, period_ledgers: 120960 });
  });

  it('refuses to build a plan whose agent is its owner', () => {
    const plan: InstallPlan = { rules: [rule()], notes: [] };
    expect(() => installFunctions(plan, { ...context, agentPublicKey: OWNER })).toThrow(/same key/);
  });

  it('emits one call per rule, because each returns its own id', () => {
    const plan: InstallPlan = { rules: [rule(), rule({ name: 'limen-1' })], notes: [] };
    expect(installFunctions(plan, context)).toHaveLength(2);
  });
});

describe('the installed rule id is read, never assumed', () => {
  const returned = (entries: Array<[string, xdr.ScVal]>) =>
    xdr.ScVal.scvMap(
      entries.map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })),
    );

  it('reads the id out of the returned ContextRule', () => {
    expect(contextRuleIdFrom(returned([['id', xdr.ScVal.scvU32(7)]]))).toBe(7);
  });

  it('throws rather than defaulting to 0 when there is no id', () => {
    // Ids come from an on-chain counter. Defaulting to zero would drive the
    // account's own Default rule — the one that can revoke — by accident.
    expect(() => contextRuleIdFrom(returned([['name', xdr.ScVal.scvString('limen-0')]]))).toThrow();
    expect(() => contextRuleIdFrom(undefined)).toThrow();
  });
});

describe('revoke', () => {
  it('removes a context rule by id', () => {
    const call = removeContextRuleFunction(ACCOUNT, 3).invokeContract();
    expect(call.functionName().toString()).toBe('remove_context_rule');
    expect(call.args()[0]!.u32()).toBe(3);
  });

  it('removes a policy by policy id, not by address', () => {
    // The contract stores an id; the address is what a person sees. Passing an
    // address here would not typecheck on-chain and would fail at simulation
    // with an error about the wrong thing.
    const call = removePolicyFunction(ACCOUNT, 3, 0).invokeContract();
    expect(call.functionName().toString()).toBe('remove_policy');
    expect(call.args().map((a) => a.u32())).toEqual([3, 0]);
  });
});

describe('a revoked rule is not a boundary refusal', () => {
  /**
   * Measured, not predicted.
   *
   * `scripts/acceptance.mjs run` submitted the agent's previously-permitted
   * transfer after the owner revoked the rule, and the transaction failed
   * on-ledger at `631f211bbb1a1a94c759e5ce754f9060fa94187c00d260d0f56ea6a2af639ef3`
   * with exactly this code. The prediction in PLAN-V4 F3 held; had it not, the
   * measurement would have won.
   */
  const REVOKED = [3000];
  const OVER_LIMIT = [3221];
  const AGENT_TRIED_TO_REVOKE = [3002];

  it('classifies ContextRuleNotFound as revoked, not refused', () => {
    expect(isRevokedRule(REVOKED)).toBe(true);
    expect(isBoundaryRefusal(REVOKED)).toBe(false);
  });

  it('classifies a spending limit refusal as refused, not revoked', () => {
    expect(isBoundaryRefusal(OVER_LIMIT)).toBe(true);
    expect(isRevokedRule(OVER_LIMIT)).toBe(false);
  });

  it('classifies the agent attempting its own revoke as a boundary refusal', () => {
    // F2. The agent's rule is `CallContract(token)`; revoking is a call to the
    // account itself, and that context does not match. The refusal comes from
    // the contract, not from Limen withholding a button.
    expect(isBoundaryRefusal(AGENT_TRIED_TO_REVOKE)).toBe(true);
    expect(isRevokedRule(AGENT_TRIED_TO_REVOKE)).toBe(false);
  });

  it('says nothing about an empty code list', () => {
    // A transaction whose diagnostics yielded no contract code is a transaction
    // we cannot attribute. Neither predicate may claim it.
    expect(isBoundaryRefusal([])).toBe(false);
    expect(isRevokedRule([])).toBe(false);
  });
});
