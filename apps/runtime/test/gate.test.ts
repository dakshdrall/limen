/**
 * The refusal table, and the two entries that are deliberately not in it.
 *
 * `decide` is pure so that every branch of it can be checked here rather than
 * against a testnet. Two properties matter more than the rest and are asserted
 * from both directions:
 *
 *   1. **Limen does not refuse what the network enforces.** An over-cap payment
 *      is *permitted* by the gate, because §X requires the network to be the
 *      thing that refuses it — with a hash and a contract error code. A gate
 *      that pre-empted the cap would turn the product's central demonstration
 *      into Limen's opinion about what would have happened.
 *   2. **Every Limen refusal says what the ledger would have done.** §4.4
 *      requires it, and the honest answer is sometimes "permit" — a paused
 *      agent's boundary is still installed, and saying otherwise would claim
 *      the network's authority for a Limen decision.
 */

import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { rawEd25519FromAddress, toHex } from '@limen/chain';
import { decide, signerFor, type Boundary, type GateInput } from '../src/policy/gate.js';

const AGENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const VERIFIER = 'CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const DESTINATION = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const boundary = (overrides: Partial<Boundary> = {}): Boundary => ({
  ruleId: 1,
  contract: TOKEN,
  validUntilLedger: 5_000,
  policyContract: 'CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE',
  limit: 100n,
  spentInWindow: 10n,
  remaining: 90n,
  periodLedgers: 17_280,
  signers: [{ verifier: VERIFIER, publicKey: toHex(rawEd25519FromAddress(AGENT)) }],
  ledger: 4_000,
  ...overrides,
});

const input = (overrides: Partial<GateInput> = {}): GateInput => ({
  agentStatus: 'ACTIVE',
  agentPublicKey: AGENT,
  request: { token: TOKEN, destination: DESTINATION, amount: 50n },
  enforcedOffchain: null,
  boundary: boundary(),
  ...overrides,
});

describe('what the network enforces, the gate does not pre-empt', () => {
  it('permits a payment inside the remaining cap', () => {
    expect(decide(input()).decision).toBe('permit');
  });

  it('permits a payment OVER the cap, so the refusal can come from the ledger', () => {
    // The load-bearing case. §X: "Ask for more than the cap: the network
    // refuses, with a hash and a contract error code." If this ever returns
    // `refuse`, that demonstration becomes Limen's opinion and the sentence
    // this repository repeats — a refusal that never reached a ledger is
    // evidence of nothing — describes its own behaviour.
    expect(decide(input({ request: { token: TOKEN, destination: DESTINATION, amount: 10_000n } })).decision).toBe(
      'permit',
    );
  });

  it('permits a payment that exactly exhausts the remaining cap', () => {
    expect(decide(input({ request: { token: TOKEN, destination: DESTINATION, amount: 90n } })).decision).toBe(
      'permit',
    );
  });
});

describe('what only Limen can see, Limen refuses', () => {
  it('refuses for a paused agent, and says the ledger would have permitted it', () => {
    const decision = decide(input({ agentStatus: 'PAUSED' }));
    expect(decision.decision).toBe('refuse');
    if (decision.decision !== 'refuse') return;
    expect(decision.constraint).toBe('agent_not_active');
    // The honest half: pausing installs nothing on chain. Claiming the ledger
    // would also have refused would borrow the network's authority for a
    // decision the network had no part in.
    expect(decision.ledgerWould).toBe('permit');
  });

  it('says the ledger WOULD have refused when a paused agent is also over its cap', () => {
    const decision = decide(
      input({ agentStatus: 'PAUSED', request: { token: TOKEN, destination: DESTINATION, amount: 10_000n } }),
    );
    if (decision.decision !== 'refuse') throw new Error('expected a refusal');
    expect(decision.ledgerWould).toBe('refuse');
  });

  it('refuses a recipient outside the allowlist, and says so as a local computation', () => {
    const decision = decide(input({ enforcedOffchain: { recipients: [OTHER] } }));
    if (decision.decision !== 'refuse') throw new Error('expected a refusal');
    expect(decision.constraint).toBe('recipient_not_allowed');
    // B8: no audited on-chain primitive can express a recipient allowlist, so
    // the reason has to say that this refusal has no hash. A refusal that read
    // like a network one would be the single misrepresentation this project
    // cannot make.
    expect(decision.reason).toMatch(/computed\s+locally/i);
    expect(decision.reason).toMatch(/no transaction hash|never reached a ledger/i);
  });

  it('permits a recipient that is on the allowlist', () => {
    expect(decide(input({ enforcedOffchain: { recipients: [DESTINATION, OTHER] } })).decision).toBe('permit');
  });

  it('treats an empty allowlist as no allowlist rather than as "nobody"', () => {
    // An empty array is what an agent with no recipient restriction stores.
    // Reading it as "no recipient is allowed" would silently disable every
    // agent that had ever had the field written.
    expect(decide(input({ enforcedOffchain: { recipients: [] } })).decision).toBe('permit');
  });
});

describe('what the chain says, read every turn', () => {
  it('refuses when the rule is not on the account, and names the ledger as agreeing', () => {
    const decision = decide(input({ boundary: undefined }));
    if (decision.decision !== 'refuse') throw new Error('expected a refusal');
    expect(decision.constraint).toBe('rule_not_installed');
    expect(decision.ledgerWould).toBe('refuse');
  });

  it('refuses an expired rule, at the ledger AFTER valid_until and not at it', () => {
    // `isLive` is inclusive, matching `get_validated_context_by_id`. Off by one
    // here would refuse a rule for the last ledger of its life.
    expect(decide(input({ boundary: boundary({ validUntilLedger: 4_000, ledger: 4_000 }) })).decision).toBe(
      'permit',
    );
    const decision = decide(input({ boundary: boundary({ validUntilLedger: 3_999, ledger: 4_000 }) }));
    if (decision.decision !== 'refuse') throw new Error('expected a refusal');
    expect(decision.constraint).toBe('rule_expired');
  });

  it('refuses a token the rule does not authorize', () => {
    const decision = decide(
      input({ request: { token: OTHER_TOKEN, destination: DESTINATION, amount: 1n } }),
    );
    if (decision.decision !== 'refuse') throw new Error('expected a refusal');
    expect(decision.constraint).toBe('asset_not_authorized');
  });

  it('refuses when the installed rule does not name the key Limen holds', () => {
    // The deployment-time verification's runtime twin: a rule bounding some
    // other key is a boundary Limen cannot sign within, and it would otherwise
    // fail deep inside `__check_auth` with nothing useful to say.
    const decision = decide({
      ...input(),
      boundary: boundary({ signers: [{ verifier: VERIFIER, publicKey: toHex(rawEd25519FromAddress(OTHER)) }] }),
    });
    if (decision.decision !== 'refuse') throw new Error('expected a refusal');
    expect(decision.constraint).toBe('agent_key_not_a_signer');
  });
});

describe('the verifier comes from the installed rule', () => {
  it('finds the signer entry for the agent key, case-insensitively', () => {
    expect(signerFor(boundary(), AGENT)?.verifier).toBe(VERIFIER);
  });

  it('finds nothing for a key the rule does not name', () => {
    expect(signerFor(boundary(), OTHER)).toBeUndefined();
  });

  it('is the same lookup the gate refuses on, so the key that passes is the key that signs', () => {
    // One function, two callers. If these could disagree, a payment could pass
    // the gate and then be signed against a verifier the account never
    // registered for it.
    const withOther = boundary({
      signers: [{ verifier: VERIFIER, publicKey: toHex(rawEd25519FromAddress(OTHER)) }],
    });
    expect(signerFor(withOther, AGENT)).toBeUndefined();
    expect(decide({ ...input(), boundary: withOther }).decision).toBe('refuse');
  });
});

const OTHER_TOKEN = 'CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE';
