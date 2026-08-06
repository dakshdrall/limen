/**
 * Creating a smart account.
 *
 * PLAN-V4 F1: no deploy code existed anywhere in this repository before this
 * file. The recorded account at `CBNPFNPW…` was deployed by hand with the
 * `stellar` CLI, which is why `deployments/testnet.json` records the result and
 * not the producer. Nothing was moved here from Node; this is written from the
 * contract sources.
 *
 * It is small because the constructor does the work:
 *
 *     // examples/multisig-smart-account/account/src/contract.rs:32
 *     pub fn __constructor(e: &Env, signers: Vec<Signer>, policies: Map<Address, Val>)
 *
 * and because of one fact that decides whether a stranger with no wallet can
 * create an account at all: **the smart account signs nothing at deploy.** The
 * constructor runs as part of contract creation, so the only signature the
 * network requires is the fee source's on the envelope. There is no chicken and
 * egg — the account does not need to authorize its own existence.
 *
 * No Node API is reachable from this module. `crypto.getRandomValues` is the
 * web standard, present in browsers and in Node since 19.
 */

import { Address, Operation, xdr } from '@stellar/stellar-sdk';
import { delegatedSigner, externalSigner } from './authpayload.js';
import { fromHex } from './bytes.js';

/**
 * The one signer the account is created with.
 *
 * Fixed at creation, and that is worth stating where it is decided rather than
 * discovering it at install time: browser key or connected wallet is chosen on
 * `/app/accounts/new` and not afterwards. `batch_add_signer` exists on the
 * contract and could add a second owner signer later, authorized by the first;
 * it is out of scope, and named here so nobody plans around its absence.
 *
 * `delegated` is the only shape a connected wallet can take — `External` hands
 * raw bytes to a verifier contract, and wallets sign envelopes and auth
 * entries, not arbitrary 32-byte digests. Whether `Delegated` is *practical*
 * from a browser is the open question at PLAN-V4 gate G4; the encoding is here
 * either way, because it costs one line and the experiment needs it.
 */
export type OwnerSigner =
  | { kind: 'external'; verifier: string; publicKey: Uint8Array }
  | { kind: 'delegated'; address: string };

export function ownerSignerScVal(owner: OwnerSigner): xdr.ScVal {
  return owner.kind === 'external'
    ? externalSigner(owner.verifier, owner.publicKey)
    : delegatedSigner(owner.address);
}

export interface DeployAccountOptions {
  /**
   * Hex hash of the uploaded multisig account wasm.
   *
   * From `wasm/manifest.json`, which records the tag and toolchain the hash came
   * from. Not the upload transaction hash — `deployments/testnet.json` records
   * that separately, and confusing the two deploys nothing.
   */
  accountWasmHash: string;
  owner: OwnerSigner;
  /** The account that signs the envelope and pays the creation fee. */
  deployer: string;
  /** Defaults to 32 fresh random bytes. */
  salt?: Uint8Array;
}

/** 32 random bytes, from the platform CSPRNG. */
export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * `createCustomContract`, with the constructor arguments the account expects.
 *
 * The policy map is empty on purpose. The constructor's Default rule is a rule
 * like any other, named `multisig`, holding the owner signer and no policy —
 * and its id comes from the same on-chain counter every other rule's does. It
 * is read back, never assumed to be `0`.
 */
export function deployAccountOperation({
  accountWasmHash,
  owner,
  deployer,
  salt = randomSalt(),
}: DeployAccountOptions): xdr.Operation {
  return Operation.createCustomContract({
    address: new Address(deployer),
    wasmHash: fromHex(accountWasmHash),
    salt,
    constructorArgs: [
      xdr.ScVal.scvVec([ownerSignerScVal(owner)]),
      xdr.ScVal.scvMap([]),
    ],
  });
}

/**
 * The same creation as a bare host function, for `submitAuthorized`.
 *
 * Extracted from the SDK's own operation rather than assembled here from
 * `CreateContractV2` parts. The SDK already knows how that envelope is shaped;
 * a second hand-rolled construction of it would be a second thing to keep
 * correct across SDK versions, for no benefit.
 */
export function deployAccountFunction(options: DeployAccountOptions): xdr.HostFunction {
  return deployAccountOperation(options).body().invokeHostFunctionOp().hostFunction();
}

/**
 * The contract address `createCustomContract` produced, read out of the
 * transaction's return value.
 *
 * Read rather than predicted. The address is derivable from the deployer and
 * the salt, and deriving it would mean this repository agreeing with itself
 * about what the network did instead of asking. Anything that cannot be read
 * back is reported as a failure rather than filled in.
 */
export function deployedContractAddress(returnValue: xdr.ScVal | undefined): string {
  if (returnValue === undefined) {
    throw new Error('contract creation returned no value; the deployed address is not knowable from this result');
  }
  return Address.fromScVal(returnValue).toString();
}
