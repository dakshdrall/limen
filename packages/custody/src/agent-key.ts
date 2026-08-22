/**
 * The key Limen holds. Generated here, sealed here, and opened for the length
 * of one turn.
 *
 * This is the module PLAN-V8 §3 has been pointing at since M0, and the module
 * `local-key-label.test.ts` was extended to watch before it existed. Everything
 * about its placement is deliberate: it is in `packages/custody` so that the
 * tripwire's discovered scan roots cover it, it carries `AGENT_KEY_LABEL`
 * rather than `LOCAL_KEY_LABEL` because the key is on a server rather than in a
 * browser, and it constructs no `KeyProvider` — it takes one, because
 * `provider.ts` is the only module in this repository permitted to decide which.
 *
 * ## The envelope, and why it has two layers rather than one
 *
 * ```
 *   seed (32 bytes)  ──sealed under──▶  data key  ──wrapped under──▶  master key
 *        │                              (per agent)                   (per deployment)
 *        └── agent_keys.ciphertext      └── agent_keys.wrapped_data_key
 * ```
 *
 * One layer would mean the master key encrypts every seed directly. That works
 * and it is worse in two specific ways. Rotating the master key would require
 * decrypting and re-encrypting every seed in the table rather than re-wrapping
 * a data key per row. And a real KMS — the mainnet precondition in §7.5.3 —
 * will not encrypt an arbitrary payload for you; it wraps a key you generated
 * and hands it back. The interface in `key-provider.ts` is small for exactly
 * that reason, and this file is the shape that fits it.
 *
 * ## What the AAD binds, and the attack it closes
 *
 * The data key is bound to the provider id, as it always was. The **seed is
 * bound to the agent id**, which is new and is the reason `gcmSeal` requires an
 * AAD rather than defaulting one.
 *
 * Without it, a sealed seed is portable between rows. Someone with write access
 * to `agent_keys` — a SQL injection, a compromised migration, an operator —
 * could copy agent A's `ciphertext` and `wrapped_data_key` onto agent B's row.
 * Both would open cleanly, and agent A's key would then be signing under agent
 * B's context rule, which may have a wider cap, a different token, or a later
 * expiry. Binding the agent id means that copy fails to open at all.
 *
 * It is worth being exact about what that does *not* buy. The boundary is still
 * enforced by the account rather than by this check: a key that opens is still
 * only able to do what its context rule permits. What the binding prevents is a
 * key being used under a rule that was never installed for it.
 *
 * ## The seed's lifetime
 *
 * `withAgentKey` opens the seed, runs one turn, and wipes it. Nothing here
 * returns a seed to a caller and nothing caches one across turns, because a
 * cache of decrypted seeds is a second place the key lives and the whole point
 * of the table is that there is one.
 *
 * The wipe is honest rather than complete, and `aes-gcm.ts` says why: V8 may
 * have copied the buffer already and this cannot reach those copies. What it
 * genuinely buys is that a heap dump taken after a turn does not contain the
 * seed. `Keypair` holds its own copy of the secret for its lifetime and there
 * is no API to clear it — so the `Keypair` is scoped to the turn too, and that
 * is stated rather than glossed.
 */

import { Keypair, type Transaction } from '@stellar/stellar-sdk';
import { AGENT_KEY_LABEL } from '@limen/shared/status-labels';
import { gcmOpen, gcmSeal, randomGcmKey, wipe } from './aes-gcm.js';
import type { KeyProvider } from './key-provider.js';

/**
 * What goes in the two ciphertext columns, plus the two that say how.
 *
 * Named to match `agent_keys` exactly. A shape that renamed these on the way to
 * the database would be a second vocabulary for one row, and the column that
 * matters most — `kms_key_id`, which is how a row stays attributable across a
 * provider swap — is the one most likely to be dropped in the translation.
 */
export interface SealedAgentKey {
  /** The seed, sealed under the data key. `agent_keys.ciphertext`. */
  readonly ciphertext: Uint8Array;
  /** The data key, wrapped under the master key. `agent_keys.wrapped_data_key`. */
  readonly wrappedDataKey: Uint8Array;
  /** Which `KeyProvider` wrapped it. `agent_keys.kms_key_id`. */
  readonly kmsKeyId: string;
  /** How, so a row written today can still be read after this file changes. */
  readonly algorithm: string;
}

/**
 * The algorithm string written to every row.
 *
 * Versioned in the value rather than implied by the code that happens to be
 * deployed. A row is opened by whatever is running months later, and "the
 * format is whatever `agent-key.ts` currently does" is not a thing a row can
 * say. If the layering changes, this string changes with it and the old one
 * keeps naming rows written under the old shape.
 */
export const AGENT_KEY_ALGORITHM = 'ed25519-seed:aes-256-gcm/aes-256-gcm-envelope-v1';

/** A newly generated agent key: the public half, and the sealed private half. */
export interface GeneratedAgentKey {
  /** `G…`. Safe to display, log, store in `agent_accounts.agent_public_key`. */
  readonly publicKey: string;
  readonly sealed: SealedAgentKey;
  /**
   * Which label any surface showing this key must render.
   *
   * Carried on the value rather than left for a screen to look up, because the
   * failure this closes is a screen picking `LOCAL_KEY_LABEL` — the familiar
   * one, the one every other key path in this repository uses — for a key that
   * is on a server. The label travels with the thing it describes.
   */
  readonly label: typeof AGENT_KEY_LABEL;
}

/**
 * The agent key, open, for the length of one turn.
 *
 * Satisfies `@limen/chain`'s `Ed25519Signer` structurally — `rawPublicKey()`
 * and `sign()` are exactly its two members — so `chain.signAs({ signer })`
 * takes this with no adapter. That is the same trick `sign.ts` documents for
 * the browser's `localStorage` key, working a second time for a key that lives
 * somewhere entirely different, which is what a narrow interface is for.
 */
export interface OpenAgentKey {
  /** `G…`, the agent's classic account: fee source and auth-entry signer both. */
  readonly publicKey: string;
  /** The raw 32 bytes, as the ed25519 verifier contract stores them. */
  rawPublicKey(): Uint8Array;
  /** Detached signature over a 32-byte digest. What `signAs` needs. */
  sign(message: Uint8Array): Uint8Array;
  /** Signs a transaction envelope, for the agent paying its own fee. */
  signEnvelope: <T extends Transaction>(tx: T) => T;
  readonly label: typeof AGENT_KEY_LABEL;
}

/** The AAD binding a sealed seed to the agent it was generated for. */
function seedAad(agentId: string): string {
  if (agentId.length === 0) {
    throw new Error(
      'agent-key: an agent id is required. It is the associated data binding a sealed seed to its row, ' +
        'and an empty one would make every sealed seed portable between agents.',
    );
  }
  return `limen:agent-key:v1:${agentId}`;
}

/**
 * Generate an agent keypair and seal it. The seed never leaves this function.
 *
 * `Keypair.random()` is the line the tripwire watches for, and this file
 * carries `AGENT_KEY_LABEL` because of it. The seed is read out with
 * `rawSecretKey()`, sealed, and wiped; the `Keypair` itself is dropped on
 * return, and only the `G…` address survives the call.
 */
export async function generateAgentKey({
  provider,
  agentId,
}: {
  provider: KeyProvider;
  agentId: string;
}): Promise<GeneratedAgentKey> {
  const aad = seedAad(agentId);
  const keypair = Keypair.random();
  const seed = new Uint8Array(keypair.rawSecretKey());
  const dataKey = randomGcmKey();

  try {
    const ciphertext = gcmSeal({ key: dataKey, aad, plaintext: seed });
    const wrapped = await provider.wrapDataKey(dataKey);

    return {
      publicKey: keypair.publicKey(),
      sealed: {
        ciphertext,
        wrappedDataKey: wrapped.bytes,
        kmsKeyId: wrapped.keyId,
        algorithm: AGENT_KEY_ALGORITHM,
      },
      label: AGENT_KEY_LABEL,
    };
  } finally {
    // Both, and in a `finally`: a provider that throws mid-wrap must not leave
    // a plaintext seed and a plaintext data key sitting in the heap.
    wipe(seed);
    wipe(dataKey);
  }
}

/**
 * Open a sealed agent key, run one turn with it, and wipe it.
 *
 * The callback shape is the fence. An `openAgentKey` returning a signer would
 * let a caller hold it indefinitely — in a module-level map, in a request
 * context, in a closure that outlives the turn — and the property this design
 * rests on is that a decrypted seed exists for one unit of work and then does
 * not. A caller cannot forget to close what it never opened.
 *
 * The `Keypair` is created inside and dropped on return. It holds its own copy
 * of the secret with no way to clear it, so what is guaranteed is its *scope*,
 * not its erasure — see this file's header, which declines to overstate this.
 */
export async function withAgentKey<T>(
  {
    provider,
    agentId,
    sealed,
  }: {
    provider: KeyProvider;
    agentId: string;
    sealed: SealedAgentKey;
  },
  turn: (key: OpenAgentKey) => Promise<T>,
): Promise<T> {
  if (sealed.algorithm !== AGENT_KEY_ALGORITHM) {
    // Named, not guessed at. A row written under a format this build does not
    // know is a migration problem and reads exactly like a corruption problem
    // if the check is left out.
    throw new Error(
      `agent-key: this row was sealed as "${sealed.algorithm}" and this build opens "${AGENT_KEY_ALGORITHM}". ` +
        'The algorithm is recorded per row so a format change stays readable; open it with the build that wrote it.',
    );
  }

  const aad = seedAad(agentId);
  // Throws `WrongKeyProviderError` when the row's `kms_key_id` names a provider
  // this deployment is not running. That is the case the column exists for, and
  // it is deliberately not caught here — the caller can say which agent, which
  // this function cannot say anything more useful about.
  const dataKey = await provider.unwrapDataKey({
    bytes: sealed.wrappedDataKey,
    keyId: sealed.kmsKeyId,
  });

  let seed: Uint8Array | undefined;
  try {
    seed = gcmOpen({ key: dataKey, aad, sealed: sealed.ciphertext, who: 'agent-key: sealed seed' });
    const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seed));

    return await turn({
      publicKey: keypair.publicKey(),
      rawPublicKey: () => new Uint8Array(keypair.rawPublicKey()),
      sign: (message) => new Uint8Array(keypair.sign(Buffer.from(message))),
      signEnvelope: <T2 extends Transaction>(tx: T2): T2 => {
        tx.sign(keypair);
        return tx;
      },
      label: AGENT_KEY_LABEL,
    });
  } finally {
    wipe(dataKey);
    if (seed !== undefined) wipe(seed);
  }
}
