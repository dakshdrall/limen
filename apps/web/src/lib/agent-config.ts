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
  /**
   * The token this agent may buy, as a contract address. Empty for none.
   *
   * With `assetContractId` — the token it may spend — this is the pair. Kept as
   * two fields rather than one `A/B` string because they are two different
   * questions on the form and the second is optional: an agent that only pays
   * has no output asset.
   */
  outputAssetContractId: string;
  /** Display only, like `assetLabel`. Nothing on chain reads it. */
  outputAssetLabel: string;
  /** The largest single trade, as a decimal amount. Empty for no ceiling. */
  maxPositionSize: string;
  /**
   * How far the price must fall before this agent trades, in basis points.
   *
   * With {@link AgentConfigDraft.triggerAmount} this is the whole of what the
   * builder collects about *when* to trade. The third number a trigger needs —
   * the reference the fall is measured from — is deliberately not here: it is a
   * price, and a person typing a price is a person reading numbers off a venue
   * and retyping them. The configure route reads it from the venue at the
   * moment the agent is configured and stamps it with the ledger it was read
   * at, so the stored rule means *"5% below where it was when I set this up"*,
   * which is what the sentence in the description says.
   */
  triggerDropBps: string;
  /** How much to trade when it fires, as a decimal amount. Empty for no trigger. */
  triggerAmount: string;
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
    /**
     * The pairs this agent may trade, as `INPUT/OUTPUT` contract ids.
     *
     * Empty when no output asset was given, and empty means **no pair is
     * allowed** — the runtime refuses every swap rather than permitting any.
     * Same direction as `recipients`, and for the same reason: a list nobody
     * filled in is not permission.
     */
    allowedPairs: string[];
    /** The largest single trade, in integer smallest units, or `null`. */
    maxPositionSize: string | null;
  };

  /**
   * What makes this agent act, or `null` for one that acts only when asked.
   *
   * A third half, and it is neither of the other two. `onChain` is what the
   * network refuses and `enforcedOffChain` is what Limen refuses; this refuses
   * nothing — it is the rule that *starts* a trade. Rendering it under either
   * heading would tell somebody a trigger bounds their agent, which is the
   * opposite of what it does.
   *
   * The reference price is absent by construction. `validate` runs in a browser
   * and in a route handler and neither can read a venue synchronously; the
   * configure route completes this into a stored trigger with a price it read
   * and the ledger it read it at.
   */
  trigger: {
    dropBps: number;
    /** Integer smallest units of the input asset. */
    amount: string;
  } | null;

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
    outputAssetContractId: '',
    outputAssetLabel: '',
    maxPositionSize: '',
    // Both empty, and that matters: an empty draft is a *payment* agent's
    // draft, and a prefilled `500` here would make every payment agent arrive
    // at the review step half-configured for trading, then be refused for a
    // trade size it was never asked for. The form offers 500 as a placeholder,
    // which suggests without filling in.
    triggerDropBps: '',
    triggerAmount: '',
  };
}

/**
 * A stored proposal, narrowed back into a draft — or the empty draft.
 *
 * `agents.draft_json` holds whatever a model produced, written without being
 * trusted, so this is the one place that turns `unknown` into an
 * `AgentConfigDraft`. It reads field by field and keeps only strings, falling
 * back to the empty draft's value for anything missing, mistyped or absent.
 *
 * It cannot fail. A malformed stored draft yields a draft with empty fields,
 * which is the same state a person sees before a model has answered — and which
 * `validate` will refuse for the ordinary reason if they try to continue. That
 * is deliberately not an error path: a proposal is a suggestion, and the
 * failure mode for a bad suggestion is an empty field, not a broken screen.
 *
 * What it must never do is widen anything. Nothing here fills a value in on a
 * model's behalf, and `recipients` keeps only strings, so a stored
 * `["ok", {"$ne": null}]` becomes `["ok"]` rather than reaching a form as an
 * object.
 */
export function reviveDraft(stored: unknown, description = ''): AgentConfigDraft {
  const empty = emptyDraft();
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return { ...empty, description };
  }

  const row = stored as Record<string, unknown>;
  const text = (key: keyof AgentConfigDraft): string => {
    const value = row[key];
    return typeof value === 'string' ? value : (empty[key] as string);
  };

  const recipients = Array.isArray(row.recipients)
    ? row.recipients.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    name: text('name'),
    // The description on the row wins over any the proposal carried: the row is
    // what the person actually wrote, and the proposal only echoes it.
    description: description.length > 0 ? description : text('description'),
    assetLabel: text('assetLabel'),
    assetContractId: text('assetContractId'),
    outputAssetContractId: text('outputAssetContractId'),
    outputAssetLabel: text('outputAssetLabel'),
    maxPositionSize: text('maxPositionSize'),
    triggerDropBps: text('triggerDropBps'),
    triggerAmount: text('triggerAmount'),
    assetDecimals: text('assetDecimals'),
    cap: text('cap'),
    windowId: text('windowId'),
    expiryId: text('expiryId'),
    perTransactionCap: text('perTransactionCap'),
    recipients,
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

  /**
   * The output asset, and the pair it makes.
   *
   * Optional: an agent that only pays has no output asset, and requiring one
   * would refuse a payment agent for lacking a field it does not use. When one
   * is given it has to be a real contract address and it has to differ from the
   * input, because a pair of one token is not a trade.
   */
  const outputAssetContractId = draft.outputAssetContractId.trim();
  const allowedPairs: string[] = [];
  if (outputAssetContractId.length > 0) {
    if (!CONTRACT_ADDRESS.test(outputAssetContractId)) {
      refuse(
        'outputAssetContractId',
        `${outputAssetContractId} is not a token contract address. Contract addresses begin with C.`,
      );
    } else if (outputAssetContractId === assetContractId) {
      refuse('outputAssetContractId', 'A pair needs two different tokens.');
    } else {
      allowedPairs.push(`${assetContractId}/${outputAssetContractId}`);
    }
  }

  /**
   * The maximum position, parsed the same way the cap is.
   *
   * A per-trade ceiling, and deliberately not compared against the cap here.
   * One larger than the window cap is not a contradiction — it simply never
   * binds, because the network refuses first — and refusing it would be Limen
   * having an opinion about a number the chain already governs.
   */
  let maxPositionSize: string | null = null;
  const rawPosition = draft.maxPositionSize.trim();
  if (rawPosition.length > 0 && decimalsValid) {
    maxPositionSize = toSmallestUnits(rawPosition, assetDecimals);
    if (maxPositionSize === null) {
      refuse(
        'maxPositionSize',
        `Not an amount this asset can express at ${assetDecimals} decimal places.`,
      );
    } else if (BigInt(maxPositionSize) <= 0n) {
      refuse('maxPositionSize', 'Leave this empty for no per-trade ceiling rather than setting zero.');
    }
  }

  /**
   * The trigger: what makes this agent act, rather than what bounds it.
   *
   * Both fields together or neither. A drop with no amount is a rule that fires
   * and trades nothing; an amount with no drop is a size for a trade nothing
   * starts. Either alone is a half-configured strategy that would look
   * configured on the screen, so both are refused with a message naming the
   * missing half.
   *
   * A trigger also needs somewhere to fire: a price is quoted for a pair, so an
   * agent with no output asset has nothing to measure a fall in. That refusal
   * lands on the pair field rather than on the trigger, because the pair is the
   * thing to go and fill in.
   */
  let trigger: { dropBps: number; amount: string } | null = null;
  const rawDropBps = draft.triggerDropBps.trim();
  const rawTriggerAmount = draft.triggerAmount.trim();

  if (rawDropBps.length > 0 || rawTriggerAmount.length > 0) {
    const dropBps = Number(rawDropBps);
    const dropValid =
      /^[0-9]+$/.test(rawDropBps) && Number.isInteger(dropBps) && dropBps >= 1 && dropBps < 10_000;

    // The missing half and the malformed value are two different messages, and
    // exactly one of them applies. Both at once would put two refusals on one
    // empty field and make the form look angrier than the mistake.
    if (rawDropBps.length === 0) {
      refuse(
        'triggerDropBps',
        'Set how far the price must fall, or clear the trade size for an agent with no trigger.',
      );
    } else if (!dropValid) {
      refuse(
        'triggerDropBps',
        'A fall is a whole number of basis points between 1 and 9,999 — 500 is five percent. ' +
          '10,000 would be the price reaching zero, which is not a trigger.',
      );
    }

    let triggerAmount: string | null = null;
    if (rawTriggerAmount.length === 0) {
      refuse(
        'triggerAmount',
        'Set how much to trade when this fires. A trigger with no size is a rule that fires and trades nothing.',
      );
    } else if (decimalsValid) {
      triggerAmount = toSmallestUnits(rawTriggerAmount, assetDecimals);
      if (triggerAmount === null) {
        refuse('triggerAmount', `Not an amount this asset can express at ${assetDecimals} decimal places.`);
      } else if (BigInt(triggerAmount) <= 0n) {
        refuse('triggerAmount', 'Clear both trigger fields for an agent with no trigger rather than trading zero.');
      }
    }

    if (allowedPairs.length === 0) {
      refuse(
        'outputAssetContractId',
        'A trigger measures a fall in a price, and a price is quoted for a pair. Set the token this agent may buy, or clear the trigger.',
      );
    }

    // Two numbers Limen computes locally, contradicting each other. Unlike the
    // window cap — which the network governs, so Limen has no business having
    // an opinion about it — both of these are Limen's, and a trigger that
    // proposes more than the position ceiling would be refused by `gate.ts` on
    // every single cycle. That is a configuration guaranteed never to trade,
    // and it is better said here than discovered in an activity log.
    if (
      triggerAmount !== null &&
      maxPositionSize !== null &&
      BigInt(triggerAmount) > BigInt(maxPositionSize)
    ) {
      refuse(
        'triggerAmount',
        `This trades ${rawTriggerAmount} but Limen refuses any single trade over ${draft.maxPositionSize.trim()}, so this trigger could never trade. Lower the size or raise the maximum position.`,
      );
    }

    if (dropValid && triggerAmount !== null) {
      trigger = { dropBps, amount: triggerAmount };
    }
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
      enforcedOffChain: { perTransactionCap, recipients, allowedPairs, maxPositionSize },
      trigger,
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
 * The account a described observation names, which is not an account.
 *
 * Deliberately not a `C…`. A described agent's boundary is derived **before a
 * smart account exists** — the review step comes before the deploy step — so
 * there is no address to name, and naming a plausible one would be inventing a
 * fact at the exact moment this flow is asking a person to check the facts.
 *
 * It is safe to be a non-address because nothing downstream reads it. See
 * {@link compileToObservation} for the argument, which is checked by test
 * rather than asserted here. The value never leaves memory: only the derived
 * `PolicyProposal` is stored, and a proposal contains no source.
 *
 * Written to be obviously wrong if it ever does appear on a screen. A sentinel
 * that looked like an address would be a bug that renders as data.
 */
export const DESCRIBED_SOURCE = 'described-agent:no-account-yet';

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
 * ## There is no account parameter, and that is a claim rather than a shortcut
 *
 * `synthesize` reads `source` for exactly one purpose: deciding which movements
 * are outflows, by comparing it against `movement.from`. It never copies it
 * into the result. A `PolicyProposal` has a context rule, policies, rationale
 * and a flag, and not one of them names an account — the account is supplied
 * separately, at install time, by `installFunctions(plan, { smartAccount })`.
 *
 * So the derived boundary is **the same boundary whatever account it is
 * derived for**, and `test/agent-config.test.ts` proves it by deriving with
 * several sources and comparing byte for byte. That is what lets the review
 * step derive the real proposal before an account exists, and what lets the
 * deploy step install *that* proposal rather than re-deriving a second one and
 * hoping the two agree.
 *
 * `to` is the source again, for a related reason: a described agent has no
 * destination, the recipient allowlist is not enforced on chain, and naming a
 * real address here would put a destination into the derivation that the
 * installed rule does not constrain. `synthesize` reads `from` and never `to`.
 */
export function compileToObservation(
  config: AgentConfig,
  { atLedger }: { atLedger: number },
): ObservedTransaction {
  const source: Address = DESCRIBED_SOURCE;

  return {
    // No hash exists, and inventing a plausible one would put a value in a
    // field every other part of this application treats as checkable.
    hash: '',
    network: 'simulated',
    ledger: atLedger,
    source,
    invocations: [
      {
        contractId: config.onChain.assetContractId,
        functionName: 'transfer',
        args: [source, source, config.onChain.cap],
      },
    ],
    movements: [
      {
        asset: config.onChain.assetContractId,
        from: source,
        to: source,
        amount: config.onChain.cap,
      },
    ],
    // One invocation, so attribution is exact by `MovementAttribution`'s own
    // rule. Nothing renders this for a described agent, but reporting
    // `transaction-level` would be false about a single-call observation.
    attribution: 'exact',
  };
}
