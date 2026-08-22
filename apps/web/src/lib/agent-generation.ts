/**
 * What the model is asked for, and what is done with what it returns.
 *
 * `/api/explain` already established the posture this file inherits: the model
 * may **select from a table and phrase things**, and may not introduce a
 * number. That file says it plainly — *"Validation, not trust. Every id is
 * resolved against the server-side table; anything unrecognised is dropped
 * rather than passed through."* This is the same rule applied to a bigger
 * output, and the reason it needs stating twice is that the output here looks
 * much more like a decision.
 *
 * It is not one. What comes back from {@link draftFromModel} is an
 * `AgentConfigDraft` — the same type a person typing into an empty form
 * produces, with no privileged channel and no extra trust. It goes on screen,
 * a person corrects it, and `validate` is what decides whether it may become a
 * configuration. Nothing here can install anything.
 *
 * ## The schema has no field for an address, and that is a fence
 *
 * {@link OUTPUT_SCHEMA} has `additionalProperties: false` and no property for a
 * token contract id. So the model has no way to return one, rather than being
 * asked politely not to: the only path to `assetContractId` is a person pasting
 * one. `test/agent-generation.test.ts` asserts the absence, because the failure
 * this prevents is silent — a plausible-looking `C…` in a form field is
 * indistinguishable from a correct one, and every downstream check would pass.
 *
 * The same argument covers `assetDecimals`, which is also absent. A model
 * returning 6 for an asset that uses 7 scales every amount on the review screen
 * by a factor of ten with nothing looking wrong.
 *
 * ## Recipients are passed through rather than cleaned
 *
 * A malformed recipient the model invented is left in the field exactly as it
 * returned it, and `validate` refuses it by name. Quietly dropping it would
 * erase the evidence that the model made something up — which is the single
 * most useful thing the review step can show a person about the model they are
 * relying on.
 *
 * What that does **not** catch is a hallucinated address that happens to be
 * well-formed, and nothing here can. Only a person reading the list can, which
 * is the reason the list is on a screen and not in a config file.
 */

import {
  DEFAULT_ASSET_DECIMALS,
  DEFAULT_EXPIRY_ID,
  DEFAULT_WINDOW_ID,
  EXPIRY_OPTIONS,
  MAX_NAME_LENGTH,
  MAX_RECIPIENTS,
  WINDOW_OPTIONS,
  emptyDraft,
  resolveExpiry,
  resolveWindow,
  type AgentConfigDraft,
} from '@/lib/agent-config';

/** The model, and the shape of the call. Matched to `/api/explain`. */
export const GENERATION_MODEL = 'claude-opus-5';

export const SYSTEM_PROMPT = `You turn a one-sentence description of a payment agent into a draft configuration for a human to review.

You are NOT authoring a security policy. Everything you return is a suggestion that appears in a form, which a person then corrects before anything is deployed. The actual limits are enforced by a smart contract on the Stellar network, configured from what the person approves — not from what you return.

Rules you must follow:

1. NEVER invent a Stellar address. If the description does not contain an explicit address (a 56-character string starting with G or C), return an empty recipients list. "approved suppliers", "my team", "the contractor" are NOT addresses. A wrong address sends money to the wrong place.
2. Do not return a token contract id. There is no field for one. The person supplies it.
3. Only use windowId and expiryId values from the lists given below. Do not invent ids.
4. If the description does not state an amount, leave cap empty rather than choosing one for them.
5. Amounts are plain decimal numbers as a person writes them — "50", "12.5". No currency symbols, no thousands separators, no words.
6. The name is a short label, at most a few words. Derive it from what the agent does.

Write for someone who is about to give a piece of software the ability to move their money. Be conservative: if the description is ambiguous about a limit, prefer the smaller reading, and leave anything you are guessing at empty so they have to fill it in deliberately.`;

/**
 * The output contract.
 *
 * `additionalProperties: false` is doing real work rather than being tidy: it
 * is what makes "the model cannot return an address" a property of the schema
 * instead of a hope about the prompt.
 */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'A short label for this agent, a few words at most.',
    },
    assetLabel: {
      type: 'string',
      description:
        'What the description called the asset — "USDC", "XLM". Display only. Empty if it named none.',
    },
    cap: {
      type: 'string',
      description:
        'The most the agent may spend in one window, as a plain decimal number. Empty if the description did not state an amount.',
    },
    windowId: {
      type: 'string',
      description: 'How often the cap resets.',
      enum: WINDOW_OPTIONS.map((option) => option.id),
    },
    expiryId: {
      type: 'string',
      description: 'How long the agent may act before its permission expires.',
      enum: EXPIRY_OPTIONS.map((option) => option.id),
    },
    perTransactionCap: {
      type: 'string',
      description:
        'An optional ceiling on any single payment, as a plain decimal number. Empty if the description did not state one.',
    },
    recipients: {
      type: 'array',
      description:
        'Stellar addresses the description explicitly named. Empty unless the description contains actual addresses.',
      items: { type: 'string' },
    },
  },
  required: ['name', 'assetLabel', 'cap', 'windowId', 'expiryId', 'perTransactionCap', 'recipients'],
  additionalProperties: false,
} as const;

/** The user-facing half of the call: the description, and the tables. */
export function userPrompt(description: string): string {
  return [
    'Description of the agent:',
    `  ${description}`,
    '',
    'Allowed windowId values:',
    ...WINDOW_OPTIONS.map((option) => `  ${option.id} — ${option.label}`),
    '',
    'Allowed expiryId values:',
    ...EXPIRY_OPTIONS.map((option) => `  ${option.id} — ${option.label}`),
  ].join('\n');
}

/**
 * What was changed on the way in, so the person reviewing can be told.
 *
 * Not an error list. Each of these is the model returning something outside the
 * contract and this module declining to pass it on — which the reviewer should
 * know about, because it is a small signal about how much the rest of the draft
 * is worth.
 */
export interface GenerationNote {
  message: string;
}

export interface GeneratedDraft {
  draft: AgentConfigDraft;
  notes: GenerationNote[];
}

/** A string, trimmed, or `''` for anything that is not one. */
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * A model response, as a draft a person can edit.
 *
 * Takes `unknown` rather than a typed body on purpose: this is the boundary,
 * and the only thing that has checked the shape at this point is a schema the
 * model was *asked* to follow. Every field is re-derived here from scratch.
 */
export function draftFromModel(raw: unknown, description: string): GeneratedDraft {
  const notes: GenerationNote[] = [];
  const base = emptyDraft();

  const proposed = (raw ?? {}) as Record<string, unknown>;

  const window = resolveWindow(text(proposed.windowId, 32));
  if (window === undefined && proposed.windowId !== undefined) {
    notes.push({
      message: `The model proposed a spending window Limen does not offer, so this is set to the default. Choose the one you want.`,
    });
  }

  const expiry = resolveExpiry(text(proposed.expiryId, 32));
  if (expiry === undefined && proposed.expiryId !== undefined) {
    notes.push({
      message: `The model proposed an expiry Limen does not offer, so this is set to the default. Choose the one you want.`,
    });
  }

  // Passed through as returned — see the header. A person reading "alice" in
  // the recipients box learns something a cleaned list would have hidden.
  const recipients = Array.isArray(proposed.recipients)
    ? proposed.recipients.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_RECIPIENTS)
    : [];

  if (Array.isArray(proposed.recipients) && proposed.recipients.length > recipients.length) {
    notes.push({
      message: 'Some proposed recipients were not text and were dropped.',
    });
  }

  return {
    draft: {
      ...base,
      name: text(proposed.name, MAX_NAME_LENGTH),
      // The description is this application's record of what was asked for, not
      // the model's paraphrase of it. It is never taken from the response.
      description,
      assetLabel: text(proposed.assetLabel, 32),
      // Absent from the schema, and absent here. The only way either of these
      // gets a value is a person typing one.
      assetContractId: '',
      assetDecimals: String(DEFAULT_ASSET_DECIMALS),
      cap: text(proposed.cap, 64),
      windowId: window?.id ?? DEFAULT_WINDOW_ID,
      expiryId: expiry?.id ?? DEFAULT_EXPIRY_ID,
      perTransactionCap: text(proposed.perTransactionCap, 64),
      recipients,
    },
    notes,
  };
}
