/**
 * The interface, shipped without the dependency.
 *
 * §7.5.3, adopted as written: the interface ships now, a real KMS does not.
 * Two implementations are foreseen and exactly one exists —
 * `EnvMasterKeyProvider` reads a master key from an environment variable, and
 * `KmsKeyProvider` calls AWS KMS / GCP KMS / Vault and **is not written**.
 *
 * ## What this buys, stated as a threat model rather than as reassurance
 *
 * | Threat                         | Env-var master | Real KMS |
 * |--------------------------------|----------------|----------|
 * | Database dump                  | Protected      | Protected |
 * | Backup leak                    | Protected      | Protected |
 * | SQL injection                  | Protected      | Protected |
 * | Read-only DB access, operator  | Protected      | Protected |
 * | **Full host compromise**       | **Not protected** | Protected |
 *
 * The two differ in exactly one row. That row is the exposure
 * `LIMEN_DEMO_SECRET` already carries today — on testnet, deliberately, and
 * documented — so adding a second value with the same profile widens an
 * accepted risk rather than introducing a new class of one. Three conditions
 * were attached to accepting that trade and they are not optional:
 *
 *   1. It is stated on `/docs/custody`, in the same register as everything
 *      else, not in a config comment. **That page does not exist yet** — it
 *      lands with the key it describes, at M2/M3, for the same reason
 *      `LIMEN HOLDS THE AGENT KEY` renders at M3 rather than at M1.
 *   2. Real KMS is a documented **mainnet precondition**, listed beside "not
 *      audited" as a thing that must become true first — not a `TODO(roadmap)`
 *      that decays.
 *   3. **Swapping it is a module, not a refactor.** Which is what the rest of
 *      this file is for.
 *
 * ## Condition 3, in three mechanisms
 *
 *   - `kms_key_id` is recorded on every `agent_keys` row from migration 0000,
 *     so rows stay attributable to the provider that wrapped them after a swap.
 *     A schema test asserts it is `NOT NULL`.
 *   - **Exactly one module constructs a provider** — `provider.ts` — and
 *     `test/single-construction-site.test.ts` scans every workspace to prove
 *     it. A second construction site is how "swap the module" becomes "find
 *     every place that makes one".
 *   - The env-var implementation **refuses to construct** in production against
 *     a non-testnet network. A fence, in the shape `demo-signer.ts` and
 *     `assertTestnet` already use: a hard throw, not a warning.
 *
 * ## Why the interface is this small
 *
 * It wraps and unwraps a data key and says who it is. It does not encrypt the
 * seed — that is envelope encryption's other half and belongs with the code
 * that holds the seed for the length of one signature. Keeping this interface
 * to the two operations a KMS actually offers is what makes `KmsKeyProvider` a
 * drop-in later: every KMS in the table above exposes wrap and unwrap, and none
 * of them will encrypt an arbitrary payload of unbounded size.
 */

/**
 * A data key, encrypted under a master key.
 *
 * Carries the id of the provider that produced it rather than relying on the
 * caller to remember. An unwrap handed a `WrappedKey` from a different provider
 * must fail loudly, and it can only do that if the wrapped value says where it
 * came from.
 */
export interface WrappedKey {
  /** The ciphertext, and whatever the provider needs to reverse it. */
  readonly bytes: Uint8Array;
  /** The `id` of the `KeyProvider` that wrapped it. */
  readonly keyId: string;
}

export interface KeyProvider {
  wrapDataKey(plaintext: Uint8Array): Promise<WrappedKey>;
  unwrapDataKey(wrapped: WrappedKey): Promise<Uint8Array>;
  /** Recorded on every `agent_keys` row, as `kms_key_id`. */
  readonly id: string;
}

/**
 * Thrown when a provider is asked to unwrap something it did not wrap.
 *
 * Its own type because the caller's response differs from every other failure
 * here: a wrong master key is an operational problem, and a `WrappedKey` from
 * another provider is a *migration* problem — the row was written before a
 * swap and needs the old provider, which is exactly what `kms_key_id` on the
 * row exists to make answerable.
 */
export class WrongKeyProviderError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `This wrapped key was produced by provider "${actual}" and cannot be unwrapped by "${expected}". ` +
        'Every agent_keys row records its kms_key_id for exactly this case: unwrap it with the provider named there.',
    );
    this.name = 'WrongKeyProviderError';
  }
}
