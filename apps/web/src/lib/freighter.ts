/**
 * Freighter, as a fee source and an identity. Not as an owner.
 *
 * That sentence is the whole module, and it is the one thing a reader of this
 * file must not come away confused about — because the confusion is the risk
 * the feature carries.
 *
 * ## What PLAN-V4's F4 decided, and what changed
 *
 * F4 measured two wallet paths on 2026-08-05 and declined both.
 *
 * The first was a wallet as the account's *owner signer*. A wallet cannot be
 * `Signer::External` — `External` hands raw bytes to a verifier contract and
 * wallets do not sign arbitrary 32-byte digests — so a wallet can only be
 * `Delegated`, which resolves inside `__check_auth` as
 * `addr.require_auth_for_args((auth_digest,))`. That is a *nested* auth
 * requirement, the enforcing simulation traps on it rather than reporting it,
 * and a failed simulation hands a wallet nothing to sign. That finding stands
 * and this module does not touch it.
 *
 * The second was this: the wallet connecting as fee source and identity while
 * the owner signer stays the browser key. F4 declined it too, in these words —
 * *"shipping a wallet button that quietly leaves the browser key in charge
 * would be the worst available outcome. A screen disclosing that in prose does
 * not fix it. Someone who connects a wallet has told you what they believe is
 * about to happen, and a caption underneath correcting them is worse than never
 * offering the button."*
 *
 * The objection is precise and it is about **placement**: a caption *underneath*
 * a button that has already made a promise. It is not an argument that the
 * arrangement cannot be disclosed; it is an argument that disclosure arriving
 * after the promise does not undo the promise.
 *
 * So the arrangement ships with the disclosure moved into the promise itself.
 * The connect control does not say "Connect wallet" with a correction beneath
 * it. It says what the wallet will do and what it will not do in the same
 * sentence, before it is clicked — see `FreighterControl`. Whether that is
 * enough is a judgement, and it is recorded as one in the README rather than
 * presented as though F4 had been satisfied by argument.
 *
 * ## Why this file holds no key and names no key label
 *
 * `local-key-label.test.ts` requires every file that generates or stores key
 * material to name its status label. This file does neither: Freighter holds
 * the secret, and what crosses this boundary is a `G…` address, an envelope
 * handed out for signature, and an envelope handed back. There is deliberately
 * no code path here that could produce a secret to label.
 */

import type { Transaction } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '@/lib/network';

/**
 * What a connected wallet is allowed to be, stated as a type.
 *
 * `feeSource` and `signEnvelope` are the two capabilities `chain-actions.ts`
 * takes from `LocalKey`, and they are the only two Freighter can supply. There
 * is deliberately no `signer` field: `Ed25519Signer.sign(digest)` is what
 * `chain.signAs` needs for an auth entry, it is what a wallet cannot do, and a
 * type that offered it would be a type that let a call site try.
 */
export interface WalletFeeSource {
  /** `G…`, the connected account. Public, safe to display and log. */
  publicKey: string;
  /** Signs a transaction envelope through the extension. */
  signEnvelope: <T extends Transaction>(tx: T) => Promise<T>;
}

export type FreighterState =
  | { status: 'unavailable' }
  | { status: 'disconnected' }
  | { status: 'wrong-network'; network: string }
  | { status: 'connected'; publicKey: string };

/** Loaded lazily: the extension shim should not be in the landing's bundle. */
async function api() {
  return import('@stellar/freighter-api');
}

/** Is the extension installed at all? */
export async function detect(): Promise<boolean> {
  const { isConnected } = await api();
  const result = await isConnected();
  return result.error === undefined && result.isConnected;
}

/**
 * The network check, and why it refuses rather than warns.
 *
 * Every fence in this repository about networks is a refusal — `assertTestnet`
 * throws, `NETWORK_PASSPHRASE` is a one-member union. A wallet pointed at
 * mainnet must not be able to fund anything here, and the failure has to happen
 * before a signature is requested rather than after one is given.
 */
export async function currentNetwork(): Promise<{ passphrase: string; name: string }> {
  const { getNetwork } = await api();
  const result = await getNetwork();
  if (result.error !== undefined) throw new Error(`Freighter: ${result.error}`);
  return { passphrase: result.networkPassphrase, name: result.network };
}

/** Ask the extension for access. Returns the address, or throws. */
export async function connect(): Promise<string> {
  const { requestAccess } = await api();
  const result = await requestAccess();
  if (result.error !== undefined) throw new Error(`Freighter: ${result.error}`);
  return result.address;
}

/** The current address without prompting, when access was already granted. */
export async function currentAddress(): Promise<string | null> {
  const { getAddress } = await api();
  const result = await getAddress();
  if (result.error !== undefined || result.address === '') return null;
  return result.address;
}

/**
 * Sign a login challenge, and hand back exactly what the extension returned.
 *
 * The one capability wallet sign-in needs, and the only place in the product
 * that asks a wallet to sign something that is not a transaction.
 *
 * ## `signedMessage` is passed through untouched, on purpose
 *
 * The return type is `unknown` rather than `string`, and that is not laziness.
 * `signMessage` has two documented response shapes — v3 answered with a
 * `Buffer`, v4 with a base64 `string` — and only v4 was measured against this
 * deployment (the probe at `/app/dev/freighter`, recorded in PLAN-V8: an
 * 88-character base64 string, 64 signature bytes, verifying under SEP-53).
 *
 * Coercing here would destroy the distinction. `String(buffer)` produces
 * something that looks like a signature and is not one, and the server would
 * then refuse it as "not base64" — an accurate message about the wrong problem,
 * telling a person on an old Freighter nothing they can act on. So the value
 * crosses this boundary as it arrived and `wallet-auth.ts` decides what it is,
 * where the v3 shape is named as a legacy wallet and the answer is "update
 * Freighter".
 *
 * ## The address comes back too, and the server trusts neither
 *
 * `signerAddress` is what the extension says signed. It is returned so the
 * caller can post it, not so anything here can rely on it: the server verifies
 * the signature against that address, so a wallet claiming an address it does
 * not hold the key for fails verification. What it is genuinely useful for is
 * the case where a person switches accounts in Freighter mid-ceremony — the
 * address that signed is then not the one that was connected, and posting the
 * signer rather than the connected address is what keeps those consistent.
 */
export async function signChallenge(
  challenge: string,
  address: string,
): Promise<{ signerAddress: string; signedMessage: unknown }> {
  const { signMessage } = await api();
  const result = await signMessage(challenge, { networkPassphrase: NETWORK_PASSPHRASE, address });
  const record = result as unknown as Record<string, unknown>;
  if (record.error !== undefined) throw new Error(`Freighter: ${JSON.stringify(record.error)}`);
  return {
    signerAddress: typeof record.signerAddress === 'string' ? record.signerAddress : '',
    signedMessage: record.signedMessage,
  };
}

/**
 * A connected wallet as a fee source.
 *
 * `signEnvelope` round-trips XDR through the extension rather than mutating the
 * transaction in place, which is the one shape difference from `LocalKey`'s
 * synchronous `tx.sign(keypair)`. Callers must therefore treat the returned
 * transaction as the one to submit — `submitAuthorized` already does, because
 * `LocalKey.signEnvelope` returns the transaction too.
 */
export function asFeeSource(publicKey: string): WalletFeeSource {
  return {
    publicKey,
    signEnvelope: async <T extends Transaction>(tx: T): Promise<T> => {
      const { signTransaction } = await api();
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');
      const result = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      });
      if (result.error !== undefined) throw new Error(`Freighter: ${result.error}`);
      return TransactionBuilder.fromXDR(result.signedTxXdr, NETWORK_PASSPHRASE) as T;
    },
  };
}
