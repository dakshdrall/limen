/**
 * What a described agent is, and the line through the middle of it.
 *
 * A user writes a sentence — *"an agent that can pay approved suppliers up to
 * 50 USDC"* — and a model turns it into fields. This module is what those
 * fields are, what makes a set of them valid, and how a valid set becomes the
 * `ObservedTransaction` the existing deterministic pipeline already knows how
 * to derive a boundary from.
 *
 * ## The partition is the point, and it is structural rather than visual
 *
 * {@link AgentConfig} has two halves and they are not siblings:
 *
 *   `onChain`         the network refuses this. It is the only half that
 *                     reaches `synthesize`, `lower`, and `add_context_rule`.
 *   `enforcedOffChain` nothing refuses this today. It is recorded and it is
 *                     rendered, and no ledger asserts a word of it.
 *
 * They are separate objects with separate names so that a component physically
 * cannot render them in one list by accident. This is the same argument
 * `packages/db/src/schema.ts` makes for calling its column
 * `enforced_offchain_json` rather than `limits`: *"a column called `limits`
 * would let a screen list these beside the installed cap as though the network
 * refused both, which is the one misrepresentation this project cannot make."*
 *
 * Two fields are in the off-chain half and it is worth saying why each is,
 * because both look like they should be enforceable and neither is:
 *
 *   - **Recipients.** OpenZeppelin's `spending_limit` policy takes exactly two
 *     parameters, `spending_limit` and `period_ledgers`. It never sees the
 *     destination. There is no audited policy contract that constrains where a
 *     transfer goes, and writing one is Rust this project does not write.
 *   - **Per-transaction cap.** The same policy is a *rolling window total*.
 *     There is no per-call primitive to compose, so a per-transaction ceiling
 *     is a number Limen would have to check, and today nothing calls a payment
 *     to check it against.
 *
 * ## The model never supplies an address, and that is enforced here
 *
 * {@link AgentConfigDraft} carries `assetLabel` — the word the user typed,
 * *"USDC"* — and `assetContractId`, which starts empty and can only be filled
 * in by a person. Deriving a contract id from an asset name means recalling an
 * issuer address, and an address recalled rather than read is exactly the class
 * of claim this repository refuses everywhere else. A wrong one addresses a
 * contract that does not exist, or worse, one that does.
 *
 * The same rule puts `assetDecimals` under the user's hand with a default of 7
 * rather than under the model's. Every Stellar Asset Contract uses 7; a custom
 * token need not, and a model confidently returning 6 would scale every amount
 * on the screen by a factor of ten without anything looking wrong.
 *
 * ## Two shapes, because a person edits one and the chain takes the other
 *
 * {@link AgentConfigDraft} is decimal strings and option ids: what the model
 * proposes and what the review form binds to. {@link AgentConfig} is integer
 * smallest units and resolved ledger counts: what compiles. `validate` is the
 * only way to get from the first to the second, and it refuses rather than
 * coercing — see {@link toSmallestUnits}, which will not round a third decimal
 * place off an amount for an asset that has two.
 */

import {
  HEADROOM_SCALE,
  LEDGERS_PER_WEEK,
  type Address,
  type ObservedTransaction,
  type SynthesisOptions,
} from '@limen/core';

/** ~24h at roughly 5 seconds per ledger. The same figure `headroom-options.ts` uses. */
export const LEDGERS_PER_DAY = 17_280;

/**
 * The spending window, as a closed table.
 *
 * The `HEADROOM_OPTIONS` pattern, and for the same reason that file gives: a
 * model may choose *which* of these, and may not introduce a number. An id it
 * does not recognise is dropped rather than passed through, so the worst a
 * hallucinated window can do is fall back to the default.
 */
export interface WindowOption {
  id: string;
  label: string;
  ledgers: number;
}

export const WINDOW_OPTIONS: readonly WindowOption[] = [
  { id: 'daily', label: 'per day', ledgers: LEDGERS_PER_DAY },
  { id: 'weekly', label: 'per week', ledgers: LEDGERS_PER_WEEK },
] as const;

export const DEFAULT_WINDOW_ID = 'daily';

/**
 * How long the installed rule stays valid, counted from the ledger it is
 * derived at.
 *
 * Bounded above deliberately. An agent key is a key somebody holds, and the
 * only thing that reliably stops holding it mattering is the rule expiring —
 * so an unbounded "never" is not on this table, and the longest option is
 * ninety days rather than a year.
 */
export interface ExpiryOption {
  id: string;
  label: string;
  ledgers: number;
}

export const EXPIRY_OPTIONS: readonly ExpiryOption[] = [
  { id: '7d', label: '7 days', ledgers: 7 * LEDGERS_PER_DAY },
  { id: '30d', label: '30 days', ledgers: 30 * LEDGERS_PER_DAY },
  { id: '90d', label: '90 days', ledgers: 90 * LEDGERS_PER_DAY },
] as const;

export const DEFAULT_EXPIRY_ID = '30d';

export const WINDOW_OPTION_IDS = WINDOW_OPTIONS.map((option) => option.id);
export const EXPIRY_OPTION_IDS = EXPIRY_OPTIONS.map((option) => option.id);

export function resolveWindow(id: string): WindowOption | undefined {
  return WINDOW_OPTIONS.find((option) => option.id === id);
}

export function resolveExpiry(id: string): ExpiryOption | undefined {
  return EXPIRY_OPTIONS.find((option) => option.id === id);
}

/**
 * Whether a spending window outlives the rule that carries it.
 *
 * One line, and exported anyway, because no pair from the two tables above can
 * currently make it true — the longest window (`weekly`) and the shortest
 * expiry (`7d`) are the same number of ledgers. The branch it guards in
 * {@link validate} is therefore dormant, and a dormant branch reached only
 * through the shipped tables cannot be tested without reaching it by some other
 * invalid field, which is a test passing for the wrong reason.
 *
 * Pulling the comparison out means the refusal is provable against numbers this
 * module does not ship, and stays provable when someone adds a `monthly` window
 * or a `1d` expiry and makes it live. The same reason `ledger.ts` keeps its
 * arithmetic out of the hook that fetches: a rule that can only be checked by
 * arranging the world around it is one nobody checks.
 *
 * `>` rather than `>=`: a window exactly as long as the rule's life resets its
 * cap at the instant the rule expires, which is legal and is the `weekly` / `7d`
 * pair.
 */
export function windowOutlivesExpiry(windowLedgers: number, validityLedgers: number): boolean {
  return windowLedgers > validityLedgers;
}

/** Stellar Asset Contracts use 7. A custom token may not, which is why this is a field. */
export const DEFAULT_ASSET_DECIMALS = 7;

/** Names are stored in `agents.name`, which is `text`, but a screen has to render one. */
export const MAX_NAME_LENGTH = 64;

/** A description is the sentence the user typed. Bounded so a paste cannot be unbounded. */
export const MAX_DESCRIPTION_LENGTH = 2_000;

/**
 * More than this many recipients is a list nobody reviewed.
 *
 * The point of an allowlist a person approves is that they read it. It is also
 * the half of this configuration that no ledger enforces, so a long one is a
 * long list of addresses carrying a guarantee that does not exist.
 */
export const MAX_RECIPIENTS = 20;

/**
 * A `C…` contract address, by shape.
 *
 * Shape only, and the limit is stated rather than left to be discovered: a real
 * check is StrKey's, which verifies the version byte and the CRC16, and lives
 * in `@stellar/stellar-sdk`. This module is imported by a client component and
 * must not pull the SDK into that bundle — `chain-config.ts` documents the same
 * constraint for the same reason.
 *
 * So a typo that still checksums is caught here, and a typo that does not is
 * caught when `transferFunction` builds the call and `new Address(...)` throws.
 * Neither of those is this regex's job; its job is to stop an obviously
 * malformed value reaching either.
 */
const CONTRACT_ADDRESS = /^C[A-Z2-7]{55}$/;

/** A `G…` account address, by the same rule and with the same limit. */
const ACCOUNT_ADDRESS = /^G[A-Z2-7]{55}$/;

/** A non-negative decimal amount as a person writes one. No sign, no exponent. */
const DECIMAL_AMOUNT = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/**
 * What the model proposes and what the review form edits.
 *
 * Every field is a string or a string array, including the ones that are
 * conceptually numbers, because this is the shape a form binds to and a form
 * binds to text. Converting early would mean the review step held a number for
 * a field the user is midway through typing.
 */
export interface AgentConfigDraft {
  name: string;
  /** The sentence the user wrote. Carried through so `agents.description` holds it. */
  description: string;
  /** What the user called the asset. Display only — nothing on chain reads it. */
  assetLabel: string;
  /** `C…`. Empty until a person pastes one; never supplied by the model. */
  assetContractId: string;
  /** Decimal places the two amounts below are written in. */
  assetDecimals: string;
  /** The windowed cap, as a decimal amount. The half the network enforces. */
  cap: string;
  windowId: string;
  expiryId: string;
  /** A per-call ceiling, or empty for none. Enforced by nothing today. */
  perTransactionCap: string;
  /** `G…` or `C…`. Enforced by nothing today. */
  recipients: string[];
}

/** The validated, canonical form. Amounts are integer smallest units. */
export interface AgentConfig {
  name: string;
  description: string;

  /**
   * The half the network refuses. Only this reaches `synthesize` and `lower`.
   */
  onChain: {
    /** The token contract the context rule is installed against. */
    assetContractId: Address;
    /** Integer, smallest units. Becomes the `spending_limit`. */
    cap: string;
    windowLedgers: number;
    validityLedgers: number;
  };

  /**
   * The half nothing refuses. Recorded, rendered, and asserted by no ledger.
   *
   * There will never be a transaction hash for anything in here. A screen that
   * gives one of these a hash column, an explorer link, or the same heading as
   * the fields above is making a claim the network does not make.
   */
  enforcedOffChain: {
    /** Integer smallest units, or `null` for no per-call ceiling. */
    perTransactionCap: string | null;
    recipients: Address[];
  };

  /** Display only. Kept beside the config so a screen need not re-derive it. */
  display: {
    assetLabel: string;
    assetDecimals: number;
    windowId: string;
    expiryId: string;
  };
}

/** A refusal, named by the field it is about so the form can put it there. */
export interface FieldProblem {
  field: keyof AgentConfigDraft;
  message: string;
}

export type ValidationResult =
  | { ok: true; config: AgentConfig }
  | { ok: false; problems: FieldProblem[] };

/**
 * A decimal amount to integer smallest units, or `null` if it is not one.
 *
 * **Refuses rather than rounds.** `1.005` at two decimals is not `1.00`; it is
 * a number this asset cannot express, and quietly truncating it would install a
 * cap that is not the one on screen. `synthesize` takes the same position on
 * every amount it is given, and `types.ts` says why: there is no rounding in
 * the amount path that is not integer truncation biased toward less
 * permission, and silently dropping a digit is not that.
 *
 * Exported because it is the interesting half of this module to test.
 */
export function toSmallestUnits(decimal: string, decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;

  const match = DECIMAL_AMOUNT.exec(decimal.trim());
  if (match === null) return null;

  const fraction = match[1] ?? '';
  if (fraction.length > decimals) return null;

  const whole = decimal.trim().split('.')[0] ?? '0';
  const padded = fraction.padEnd(decimals, '0');

  // String concatenation rather than `* 10 ** decimals`: the second is float
  // arithmetic, and a cap is exactly the value that must not acquire a rounding
  // error on its way to the chain.
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return combined;
}

/** The inverse, for rendering a stored cap back into a form field. */
export function fromSmallestUnits(units: string, decimals: number): string {
  if (!/^\d+$/.test(units)) return '';
  if (decimals === 0) return units;

  const padded = units.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

/** An empty draft, which is what the describe step starts from. */
export function emptyDraft(): AgentConfigDraft {
  return {
    name: '',
    description: '',
    assetLabel: '',
    assetContractId: '',
    assetDecimals: String(DEFAULT_ASSET_DECIMALS),
    cap: '',
    windowId: DEFAULT_WINDOW_ID,
    expiryId: DEFAULT_EXPIRY_ID,
    perTransactionCap: '',
    recipients: [],
  };
}

/**
 * Every refusal, at once, rather than the first one.
 *
 * A form that reports one problem per submission makes the user discover its
 * rules one round trip at a time. Each problem names its field so the review
 * step can render it against the input it is about instead of in a list at the
 * bottom.
 */
export function validate(draft: AgentConfigDraft): ValidationResult {
  const problems: FieldProblem[] = [];
  const refuse = (field: keyof AgentConfigDraft, message: string) => {
    problems.push({ field, message });
  };

  const name = draft.name.trim();
  if (name.length === 0) refuse('name', 'The agent needs a name.');
  else if (name.length > MAX_NAME_LENGTH) {
    refuse('name', `A name is at most ${MAX_NAME_LENGTH} characters; this one is ${name.length}.`);
  }

  const description = draft.description.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    refuse('description', `A description is at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }

  const assetContractId = draft.assetContractId.trim();
  if (assetContractId.length === 0) {
    refuse(
      'assetContractId',
      'Paste the token contract this agent may spend. Limen will not guess one from a name — a contract id recalled rather than read is how an agent ends up addressing the wrong token.',
    );
  } else if (!CONTRACT_ADDRESS.test(assetContractId)) {
    refuse('assetContractId', 'A token contract is a 56-character address beginning with C.');
  }

  const assetDecimals = Number(draft.assetDecimals.trim());
  const decimalsValid = Number.isInteger(assetDecimals) && assetDecimals >= 0 && assetDecimals <= 18;
  if (!decimalsValid) refuse('assetDecimals', 'Decimals is a whole number between 0 and 18.');

  const window = resolveWindow(draft.windowId);
  if (window === undefined) refuse('windowId', 'Choose a spending window.');

  const expiry = resolveExpiry(draft.expiryId);
  if (expiry === undefined) refuse('expiryId', 'Choose when this agent stops being able to act.');

  // A window longer than the rule's life is a cap that never resets inside the
  // period it governs. `synthesize` throws on it; refusing here means the user
  // reads the reason on the field rather than as a synthesis error.
  if (window !== undefined && expiry !== undefined && windowOutlivesExpiry(window.ledgers, expiry.ledgers)) {
    refuse(
      'windowId',
      `A ${window.label} window outlives a ${expiry.label} agent, so the cap would never reset. Shorten the window or lengthen the expiry.`,
    );
  }

  let cap: string | null = null;
  const rawCap = draft.cap.trim();
  if (rawCap.length === 0) {
    refuse('cap', 'Set the amount this agent may spend in a window.');
  } else if (!decimalsValid) {
    // Deliberately silent: the decimals field already carries the refusal, and
    // a second message about an amount that cannot be scaled yet would blame
    // the wrong input.
  } else {
    cap = toSmallestUnits(rawCap, assetDecimals);
    if (cap === null) {
      refuse(
        'cap',
        `Not an amount this asset can express at ${assetDecimals} decimal places. Limen refuses rather than rounding it.`,
      );
    } else if (BigInt(cap) <= 0n) {
      refuse('cap', 'A cap of zero permits nothing; there would be no agent to deploy.');
    }
  }

  let perTransactionCap: string | null = null;
  const rawPerTransaction = draft.perTransactionCap.trim();
  if (rawPerTransaction.length > 0 && decimalsValid) {
    perTransactionCap = toSmallestUnits(rawPerTransaction, assetDecimals);
    if (perTransactionCap === null) {
      refuse(
        'perTransactionCap',
        `Not an amount this asset can express at ${assetDecimals} decimal places.`,
      );
    } else if (BigInt(perTransactionCap) <= 0n) {
      refuse('perTransactionCap', 'Leave this empty for no per-payment ceiling rather than setting zero.');
    } else if (cap !== null && BigInt(perTransactionCap) > BigInt(cap)) {
      // Not a contradiction the chain would catch — nothing on chain reads this
      // number at all — but a ceiling above the window total can never bind,
      // and a limit that cannot bind reads as protection that is not there.
      refuse(
        'perTransactionCap',
        'A per-payment ceiling above the window cap can never apply. Lower it, or leave it empty.',
      );
    }
  }

  const recipients: Address[] = [];
  const seen = new Set<string>();
  for (const raw of draft.recipients) {
    const recipient = raw.trim();
    if (recipient.length === 0) continue;
    if (!ACCOUNT_ADDRESS.test(recipient) && !CONTRACT_ADDRESS.test(recipient)) {
      refuse('recipients', `${recipient} is not a Stellar address. Addresses begin with G or C.`);
      continue;
    }
    if (seen.has(recipient)) continue;
    seen.add(recipient);
    recipients.push(recipient);
  }
  if (recipients.length > MAX_RECIPIENTS) {
    refuse('recipients', `At most ${MAX_RECIPIENTS} approved recipients, so the list stays one a person reads.`);
  }

  if (problems.length > 0) return { ok: false, problems };

  /**
   * Unreachable, and it throws rather than casting.
   *
   * Each of these four has a check above that records a problem when it is
   * missing, so reaching here with one of them unset means a check was deleted
   * and its `return` was not. A type assertion would let that edit through
   * silently and produce a config with an undefined cap; this fails at the
   * edit instead of at the install. Same argument `stores.ts` makes for
   * throwing on an inserted user that comes back without a credential.
   */
  if (cap === null || window === undefined || expiry === undefined || !decimalsValid) {
    throw new Error(
      'agent-config: validate recorded no problem but could not build a config. A validation branch was removed without its refusal.',
    );
  }

  return {
    ok: true,
    config: {
      name,
      description,
      onChain: {
        assetContractId,
        cap,
        windowLedgers: window.ledgers,
        validityLedgers: expiry.ledgers,
      },
      enforcedOffChain: { perTransactionCap, recipients },
      display: {
        assetLabel: draft.assetLabel.trim(),
        assetDecimals,
        windowId: window.id,
        expiryId: expiry.id,
      },
    },
  };
}

/**
 * The synthesis options a config implies.
 *
 * `headroomBps` is always exactly {@link HEADROOM_SCALE}. That is not a default
 * that could be widened later — it is what makes the derived cap equal the
 * number the user reviewed, to the unit. `synthesize` computes
 * `gross * headroom / SCALE` with integer truncation, so at 1.0 the cap out is
 * the amount in and there is nothing to round.
 *
 * A described agent is the case where headroom has no meaning anyway. Headroom
 * exists so that a boundary derived from *one observed transaction* is not so
 * tight that the next ordinary payment trips it. Here there is no observation
 * to be tight against: the user stated the limit.
 */
export function synthesisOptionsFor(config: AgentConfig): SynthesisOptions {
  return {
    headroomBps: HEADROOM_SCALE,
    windowLedgers: config.onChain.windowLedgers,
    validityLedgers: config.onChain.validityLedgers,
  };
}

/**
 * A config, as the transaction the boundary would have been derived from.
 *
 * This is the join between the described mode and everything that already
 * exists. `synthesize` derives a boundary from an {@link ObservedTransaction};
 * the demonstrated mode reads one back off the ledger, and the described mode
 * builds the one the user just described. The whole pipeline below this point —
 * `synthesize`, `lower`, `installFunctions`, `add_context_rule` — is unchanged
 * and unaware of which mode produced its input.
 *
 * `network: 'simulated'` is load-bearing rather than a placeholder. That member
 * has been in `@limen/core`'s union since the beginning for exactly this, and
 * it is what stops anything downstream reporting this as a transaction that
 * happened. There is no hash, and `policies.observed_tx_hash` stays null for a
 * described agent — the absence is the honest record that nothing was observed.
 *
 * `source` is the smart account, because that is the account the boundary is
 * installed on and `synthesize` sums outflow from it. `to` is the *account
 * itself*, which looks odd and is deliberate: a described agent has no
 * destination, the recipient allowlist is not enforced on chain, and naming any
 * real address here would put a destination into the derivation that the rule
 * does not constrain. `synthesize` reads `from` and never `to`.
 */
export function compileToObservation(
  config: AgentConfig,
  { smartAccountId, atLedger }: { smartAccountId: Address; atLedger: number },
): ObservedTransaction {
  return {
    // No hash exists, and inventing a plausible one would put a value in a
    // field every other part of this application treats as checkable.
    hash: '',
    network: 'simulated',
    ledger: atLedger,
    source: smartAccountId,
    invocations: [
      {
        contractId: config.onChain.assetContractId,
        functionName: 'transfer',
        args: [smartAccountId, smartAccountId, config.onChain.cap],
      },
    ],
    movements: [
      {
        asset: config.onChain.assetContractId,
        from: smartAccountId,
        to: smartAccountId,
        amount: config.onChain.cap,
      },
    ],
    // One invocation, so attribution is exact by `MovementAttribution`'s own
    // rule. Nothing renders this for a described agent, but reporting
    // `transaction-level` would be false about a single-call observation.
    attribution: 'exact',
  };
}
