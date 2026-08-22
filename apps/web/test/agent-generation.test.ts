/**
 * The model is untrusted, and these are the places that has to be true.
 *
 * Two of them are structural and matter more than the rest:
 *
 *   1. **The output schema has no field that can hold an address.** Not "the
 *      prompt asks it not to" — there is no property, and `additionalProperties`
 *      is false. A plausible-looking `C…` in a form field is indistinguishable
 *      from a correct one, and every check downstream would pass it.
 *   2. **`draftFromModel` re-derives every field from `unknown`.** The only
 *      thing that has inspected the response at that point is a schema the
 *      model was *asked* to follow, so the function is tested against responses
 *      that ignore it entirely.
 *
 * The rest is the contract with the review step: a generated draft is the same
 * kind of thing as a typed one, so it goes through `validate` and comes out
 * with the same refusals.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSET_DECIMALS,
  DEFAULT_EXPIRY_ID,
  DEFAULT_WINDOW_ID,
  EXPIRY_OPTIONS,
  MAX_RECIPIENTS,
  WINDOW_OPTIONS,
  validate,
} from '@/lib/agent-config';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, draftFromModel, userPrompt } from '@/lib/agent-generation';

const DESCRIPTION = 'an agent that can pay approved suppliers up to 50 USDC';
const SUPPLIER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUFXH';
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/** A well-formed response, so each test can break one thing about it. */
function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Supplier payments',
    assetLabel: 'USDC',
    cap: '50',
    windowId: 'daily',
    expiryId: '30d',
    perTransactionCap: '',
    recipients: [],
    ...overrides,
  };
}

describe('the schema cannot express an address', () => {
  const properties = Object.keys(OUTPUT_SCHEMA.properties);

  it('has no property for a token contract', () => {
    // The fence. Adding one here — however well-intentioned — reopens the hole
    // this whole arrangement exists to close.
    expect(properties).not.toContain('assetContractId');
    expect(properties).not.toContain('contractId');
    expect(properties).not.toContain('asset');
    expect(properties).not.toContain('issuer');
    expect(properties).not.toContain('address');
  });

  it('has no property for decimal places', () => {
    // A model returning 6 where the asset uses 7 scales every amount on the
    // review screen by ten, with nothing looking wrong.
    expect(properties).not.toContain('assetDecimals');
    expect(properties).not.toContain('decimals');
  });

  it('refuses fields it did not ask for', () => {
    // Without this, a model that returned `assetContractId` anyway would have
    // it arrive as a valid response with an extra key.
    expect(OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it('is not vacuous: it does ask for the fields it should', () => {
    expect(new Set(properties)).toEqual(
      new Set(['name', 'assetLabel', 'cap', 'windowId', 'expiryId', 'perTransactionCap', 'recipients']),
    );
  });

  it('constrains the two option fields to the shipped tables', () => {
    // The `HEADROOM_OPTIONS` rule: the model selects from a table and never
    // introduces a value. Pinned in both directions so a table that grows a
    // member without the schema growing one is caught.
    expect([...OUTPUT_SCHEMA.properties.windowId.enum]).toEqual(WINDOW_OPTIONS.map((o) => o.id));
    expect([...OUTPUT_SCHEMA.properties.expiryId.enum]).toEqual(EXPIRY_OPTIONS.map((o) => o.id));
  });
});

describe('the prompt says the thing that matters most', () => {
  it('forbids inventing an address in the system prompt, not only in the schema', () => {
    // Belt and braces, and they fail differently: the schema stops a returned
    // address, and the prompt stops the model deciding an invented one belongs
    // in a field that does exist, like the name.
    expect(SYSTEM_PROMPT).toContain('NEVER invent a Stellar address');
    expect(SYSTEM_PROMPT).toContain('empty recipients list');
  });

  it('offers the tables in the user prompt, so the ids are not guessed from memory', () => {
    const prompt = userPrompt(DESCRIPTION);
    expect(prompt).toContain(DESCRIPTION);
    for (const option of WINDOW_OPTIONS) expect(prompt).toContain(option.id);
    for (const option of EXPIRY_OPTIONS) expect(prompt).toContain(option.id);
  });
});

describe('every field is re-derived from the response', () => {
  it('reads a well-formed response', () => {
    const { draft, notes } = draftFromModel(response(), DESCRIPTION);
    expect(draft.name).toBe('Supplier payments');
    expect(draft.assetLabel).toBe('USDC');
    expect(draft.cap).toBe('50');
    expect(draft.windowId).toBe('daily');
    expect(draft.expiryId).toBe('30d');
    expect(notes).toEqual([]);
  });

  it('never takes a contract id from the response, even one that is offered', () => {
    // The schema forbids it, so this is the second line: a response carrying
    // the field anyway — a schema change, a different model, a proxy — must
    // still not reach the draft.
    const { draft } = draftFromModel(
      response({ assetContractId: TOKEN, assetDecimals: '2', asset: TOKEN }),
      DESCRIPTION,
    );
    expect(draft.assetContractId).toBe('');
    expect(draft.assetDecimals).toBe(String(DEFAULT_ASSET_DECIMALS));
  });

  it('takes the description from the argument, never from the response', () => {
    // The description is this application's record of what was asked for. A
    // model paraphrase in that column would make the stored history a summary.
    const { draft } = draftFromModel(
      response({ description: 'something the model made up' }),
      DESCRIPTION,
    );
    expect(draft.description).toBe(DESCRIPTION);
  });

  it('falls back to the default option and says so when an id is unrecognised', () => {
    const { draft, notes } = draftFromModel(
      response({ windowId: 'monthly', expiryId: 'forever' }),
      DESCRIPTION,
    );
    expect(draft.windowId).toBe(DEFAULT_WINDOW_ID);
    expect(draft.expiryId).toBe(DEFAULT_EXPIRY_ID);
    // Silence here would let a model's rejected choice look like the user's.
    expect(notes).toHaveLength(2);
  });

  it('survives a response that ignores the schema completely', () => {
    for (const garbage of [null, undefined, 'a string', 42, [], { name: 12, recipients: 'nope' }]) {
      const { draft } = draftFromModel(garbage, DESCRIPTION);
      expect(draft.description).toBe(DESCRIPTION);
      expect(draft.assetContractId).toBe('');
      expect(draft.recipients).toEqual([]);
    }
  });

  it('bounds every string it copies', () => {
    const { draft } = draftFromModel(
      response({ name: 'x'.repeat(500), assetLabel: 'y'.repeat(500), cap: '9'.repeat(500) }),
      DESCRIPTION,
    );
    expect(draft.name.length).toBeLessThanOrEqual(64);
    expect(draft.assetLabel.length).toBeLessThanOrEqual(32);
    expect(draft.cap.length).toBeLessThanOrEqual(64);
  });
});

describe('a made-up recipient is shown, not swallowed', () => {
  it('passes a malformed address through so the reviewer sees it', () => {
    // The single most useful thing the review step can show about the model it
    // is relying on. Cleaning this would erase the evidence.
    const { draft } = draftFromModel(response({ recipients: ['alice', SUPPLIER] }), DESCRIPTION);
    expect(draft.recipients).toEqual(['alice', SUPPLIER]);

    // And validation refuses it, by name, on the field.
    const result = validate({ ...draft, name: 'x', assetContractId: TOKEN, cap: '50' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((problem) => problem.message.includes('alice'))).toBe(true);
  });

  it('drops entries that are not text, and says it did', () => {
    const { draft, notes } = draftFromModel(
      response({ recipients: [SUPPLIER, 42, null, { address: SUPPLIER }] }),
      DESCRIPTION,
    );
    expect(draft.recipients).toEqual([SUPPLIER]);
    expect(notes).toHaveLength(1);
  });

  it('caps the list at the number a person reads', () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 10 }, () => SUPPLIER);
    const { draft } = draftFromModel(response({ recipients: many }), DESCRIPTION);
    expect(draft.recipients).toHaveLength(MAX_RECIPIENTS);
  });
});

describe('a generated draft is an ordinary draft', () => {
  it('is incomplete on arrival, because the asset can only come from a person', () => {
    // The generated draft never validates on its own. That is the design: the
    // review step is not a formality a good enough model could skip.
    const { draft } = draftFromModel(response(), DESCRIPTION);
    const result = validate(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.field)).toContain('assetContractId');
  });

  it('validates once a person supplies what only a person can', () => {
    const { draft } = draftFromModel(response(), DESCRIPTION);
    const result = validate({ ...draft, assetContractId: TOKEN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.onChain.cap).toBe('500000000');
  });
});
