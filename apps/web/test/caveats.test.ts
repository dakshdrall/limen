/**
 * Caveat strings, pinned.
 *
 * Every honesty caveat in this project is one careless edit away from being
 * softened into marketing. These assertions exist so that softening one is a
 * red build rather than a quiet improvement in tone.
 *
 * ## This file was deleted, and the README went on citing it for two versions
 *
 * Restored in PLAN-V8 M0. It was deleted in `c034cb8`, which removed the
 * rendering layer wholesale — and this suite pinned sentences on a landing page
 * that ceased to exist, so it went with it. `local-key-label.test.ts` was
 * restored in the same commit and re-pointed at its new home; this one was not.
 *
 * `README.md` continued to say, in two places, *"pinned in both directions by
 * `apps/web/test/caveats.test.ts`"*. For the whole of V6 and V7 the README named
 * a nonexistent test as the guarantee behind two of the project's caveats, and
 * every suite stayed green, because nothing asserted that a file the README
 * cites is a file that exists. `scripts/evidence.mjs` noticed the deletion in a
 * comment of its own and the README was not updated with it — the information
 * was in the repository and did not reach the claim.
 *
 * That gap is now closed from the outside, in `evidence.test.ts`, under *every
 * file the README cites is a file that exists*. It is deliberately not in this
 * file: a suite cannot assert its own existence, and being deleted again is the
 * specific fault being guarded against.
 *
 * ## What the restore changed, and what it deliberately did not
 *
 * 45 of the 60 original assertions still passed against the rebuilt tree. Of
 * the 15 that did not, none had become false — every one was a claim that had
 * *moved*:
 *
 *   - the closed label set, `components/StatusLabel.tsx` -> `lib/status-labels.ts`
 *     (and again, in V8 M1, to `packages/shared/src/status-labels.ts`)
 *   - the four verdict sentences, `AgentRunSteps.tsx` -> `lib/verdict.ts`
 *   - the two-runs seam, from typed JSX -> read out of the deployments file
 *   - four docs claims, from one `/docs` page -> the README, when V6 split it
 *
 * Each is re-pointed at where the claim now lives, with the move recorded at the
 * assertion. Two findings are recorded rather than repaired, because both are
 * copy decisions and M0 is a repair of the fence rather than a rewrite of the
 * product: the landing's limits list lost two entries in the rebuild, and the
 * landing no longer mentions the browser run at all. Both are noted at the tests
 * that found them and carried into PLAN-V8 for a decision.
 *
 * Scope, stated plainly: these read source, not rendered DOM. They prove the
 * string is still in the code that renders it — they do not prove it reached
 * the screen. A full render assertion would need jsdom and a testing library;
 * the wording is the thing that actually decays over time, and it is what is
 * guarded here.
 *
 * Comparisons run on whitespace-collapsed text so that reflowing a JSX line or
 * rewrapping a Markdown paragraph does not fail the build. Only the words are
 * load-bearing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Collapses every run of whitespace to a single space. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

const source = (relative: string) =>
  flat(readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8'));

/**
 * The same, for a claim that no longer lives inside this app.
 *
 * V8 M1 lifted the closed label set, the key roles and the redactor into
 * `packages/shared`, because `apps/web` is about to stop being the only surface
 * that states a limit to a person. A caveat suite that could only read
 * `apps/web/src` would have quietly stopped guarding them — which is the
 * failure this whole file was restored to close, one directory over.
 *
 * Unflattened, unlike `source`. Its one caller has to strip comments before
 * collapsing whitespace, and doing that in the other order lets a `//` from a
 * wrapped comment line land in the middle of a sentence — which is precisely the
 * accident that made the old `NO CUSTODY` assertion pass for a reason nobody
 * chose.
 */
const shared = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/shared/src/${relative}`, import.meta.url)), 'utf8');

const README = flat(readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf8'));

describe('the fixture caveat survives verbatim', () => {
  it('marks simulated transactions as never observed on a live network', () => {
    // Including the em dash: a fixture that stopped announcing itself as a
    // fixture would let an illustrative transaction read as a real one.
    expect(source('components/ObservedSection.tsx')).toContain(
      '(shipped fixture — not observed on a live network)',
    );
  });

  it('still keys that caveat off the simulated network value', () => {
    expect(source('components/ObservedSection.tsx')).toContain("observed.network === 'simulated'");
  });

  it('marks live ingests as observed on testnet, in the same slot', () => {
    expect(source('components/ObservedSection.tsx')).toContain('(observed on testnet');
  });
});

describe('the evaluator caveat survives', () => {
  it('says refusal is adjudicated by this repository, not enforced on-chain', () => {
    const stepper = source('components/simulator/SimulatorStepper.tsx');
    // `&rsquo;` rather than a literal apostrophe: this is JSX source, and the
    // entity is what the component actually contains.
    expect(stepper).toContain('adjudicated by this repository&rsquo;s evaluator');
    expect(stepper).toContain('not by a deployed policy contract');
  });

  it('is stated in the README too, and scoped to the screens it is true of', () => {
    // The chain layer produces genuine network refusals, so the unqualified
    // form of this caveat became false. The scoped form must survive, because
    // the simulator still adjudicates locally and a reader who conflates the two
    // would credit it with something it does not do.
    //
    // Rescoped three times: it said "the two screens that exist" until the
    // interface screens landed and there were more than two; it named `/demo`
    // until that page moved to `/app/simulator`; and it named `/` until step 12
    // replaced the landing's local deny table with the recorded testnet survey.
    // The names are in it, so neither a new screen nor a moved one can silently
    // widen it.
    expect(README).toContain(
      "On `/app/simulator`, the deny table proves refusal as adjudicated by this repository's evaluator, not as enforced on-chain.",
    );
    expect(README).toContain("the ones with transaction hashes above are the network's");
  });

  it('does not still claim the landing adjudicates locally', () => {
    // The other direction, and the one a rescope forgets. A caveat that names a
    // screen which has since stopped needing it is not harmless: it tells a
    // reader the strongest page in the project is weaker than it is, and it is
    // the kind of wrong that survives review because it errs modestly.
    expect(README).not.toContain('On `/` and `/app/simulator`, the deny table');
    expect(source('app/page.tsx')).not.toContain('DenyTable');
  });

  it('says the refusal screen keeps locally adjudicated rows off itself', () => {
    expect(README).toContain('no locally adjudicated row appears on it');
  });
});

describe('a failure is not a refusal until its error code says so', () => {
  // The trap that nearly put a false claim in this README: a transaction built
  // on a recording-mode footprint fails with `resourceLimitExceeded` before the
  // policy is ever reached, and reports the same operation result a genuine
  // refusal does. If this wording goes, so does the reason anyone checks.
  it('is stated in the README', () => {
    expect(README).toContain('A failure is not a refusal until its error code says so.');
    expect(README).toContain('never runs `__check_auth` and therefore never reaches the policy');
  });

  it('is enforced in the chain layer, not only described', () => {
    const errors = flat(
      readFileSync(fileURLToPath(new URL('../../../packages/chain/src/errors.ts', import.meta.url)), 'utf8'),
    );
    expect(errors).toContain('export function isBoundaryRefusal');
    expect(errors).toContain('resourceLimitExceeded');
  });
});

describe('the composition-only claim is not quietly widened', () => {
  it('says no Rust is generated and none is hand-written either', () => {
    expect(README).toContain('No Rust is generated, and none is written by hand either.');
  });

  it('names what refusing to write that policy costs', () => {
    // A rule with no stated cost reads as a rule nobody was tempted to break.
    expect(README).toContain('would close the multi-contract gap tomorrow');
  });
});

describe('the install caveat survives', () => {
  it('does not claim an install happened, and gives the reason that is true now', () => {
    // This said the payload could not be submitted because the MVP does not
    // deploy a smart account. It does deploy one now — the hashes are in
    // `deployments/testnet.json` — so the old wording was a caveat that had
    // outlived its reason, which is its own kind of inaccuracy: it would have
    // had a reviewer believe the project was less far along than it is, and it
    // would have stopped being load-bearing the moment someone noticed.
    //
    // What remains true is why *this screen* submits nothing: no account to
    // write to, and no signature to authorize the write.
    const stepper = source('components/simulator/SimulatorStepper.tsx');
    expect(stepper).not.toContain('which this MVP does not deploy');
    expect(stepper).toContain('would need a smart account to write to and an owner signature');
    expect(stepper).toContain('nothing here is submitted');
  });
});

describe('the custody claim stays accurate as signers are added', () => {
  // This claim has now been narrowed twice, and each narrowing is pinned in
  // both directions. First the demo signer made the unqualified sentence false;
  // then the browser key made the qualified one false too, because that key can
  // move the funds in the account it owns. What is asserted here is the claim
  // that survives — Limen holds nothing — plus the absence of the two wordings
  // that no longer hold.
  it('drops both superseded wordings', () => {
    expect(README).not.toContain(
      'There is no code path in this repository that can move user funds.',
    );
    // False since v4: the local key exists precisely so it can move funds.
    expect(README).not.toContain(
      "There is no code path in this repository that can move a user's funds.",
    );
    expect(README).not.toContain('There is exactly one code path that can move any funds at all');
  });

  it('states the claim that survives, about custody rather than capability', () => {
    expect(README).toContain(
      'There is no code path in this repository that gives Limen custody of a user',
    );
    expect(README).toContain('no server-side signer for a user');
    expect(README).toContain("neither of them is Limen's to hold");
  });

  it('does not soften the browser key into something it is not', () => {
    // The honest half of the narrowing. A key in browser storage is a user
    // secret in browser storage, and the rule used to forbid exactly that.
    expect(README).toContain('It used to forbid a user secret reaching browser storage at all');
    expect(README).toContain('clearing site data destroys it');
    expect(README).toContain('There is no export, no backup, and no import field');
  });

  it('still describes the demo account as disposable', () => {
    expect(README).toContain('disposable and holds trivial funds');
  });

  // Re-pointed twice, and neither time did the claim change.
  //
  // V6 moved the closed label set from `components/StatusLabel.tsx` to
  // `lib/status-labels.ts`, because `lib/local-key.ts` was importing a string
  // from the rendering layer and the rule that every key-handling file names
  // its label was resting on a component file continuing to exist. The M0
  // restore re-pointed this assertion at that new home.
  //
  // V8 M1 moved it again, to `packages/shared/src/status-labels.ts`, for the
  // reason one level up: the runtime and the Telegram adapter will state limits
  // too, and a closed set inside `apps/web` is not closed against them.
  /**
   * The live set, sliced out of the module that also records its own history.
   *
   * This distinction was forced by the retirement rather than anticipated.
   * `status-labels.ts` keeps a note saying what `NO CUSTODY` used to claim and
   * why each wording stopped being true — which is most of that file's value,
   * because a label set with no memory is one that can quietly re-adopt a claim
   * it already retired. But it means the file legitimately *contains* strings
   * the live set must not, and an assertion reading the whole file cannot tell a
   * retired claim from a current one.
   *
   * Before this, that only worked by accident: the old note happened to break
   * the quoted sentence across two comment lines, so `flat()` left a `//` in the
   * middle of it and the `not.toContain` passed for a reason nobody chose. A
   * fence that holds because of where a line wrapped is not a fence.
   *
   * Comments are stripped rather than the note being moved out of the object.
   * Each retirement note belongs *at* the label it replaced — that adjacency is
   * what makes it findable by the next person editing that line — and the same
   * reasoning `local-key-label.test.ts` gives for its own `code()` stripper
   * applies here: a claim in a comment is a record of a claim, never a live one.
   */
  const liveLabels = flat(
    (/export const STATUS_LABELS = \{[\s\S]*?\n\} as const;/.exec(shared('status-labels.ts'))?.[0] ?? '').replace(
      /(^|[^:])\/\/.*$/gm,
      '$1',
    ),
  );

  it('reads the live set, not the module that records its history', () => {
    // Guard on the slice itself. If the regex above stops matching, every
    // assertion below becomes a claim about an empty string and passes forever.
    expect(liveLabels).toContain("'TESTNET ONLY'");
    expect(liveLabels).toContain('} as const;');
  });

  it('has retired NO CUSTODY, and not by softening it', () => {
    // The first direction. `NO CUSTODY` said "any key that can move funds here
    // was generated in your browser", and PLAN-V8 §3 makes that false rather
    // than imprecise: an agent that answers a message with no browser open
    // signs with a key generated on a Limen server.
    //
    // What this asserts is that the *name* is gone, not just the sentence. One
    // label cannot carry two opposite facts, and rewording the description
    // while keeping the name would leave the part a reader actually remembers
    // saying the thing that stopped being true. The literal string appears in
    // this test and in the retirement note in `status-labels.ts` — both are
    // records of the retirement — so the assertion is on the label set's own
    // keys and constants rather than on the file containing the characters.
    expect(liveLabels).not.toContain("'NO CUSTODY':");
    expect(liveLabels).not.toContain('There is no code path here that can move your funds');
    expect(liveLabels).not.toContain('Any key that can move funds here was generated in your browser');
  });

  it('replaced it with two labels, because it was carrying two facts', () => {
    // The second direction, and the one a retirement forgets. Deleting a label
    // and replacing it with nothing would also pass the test above, and would
    // be the landing quietly dropping a limit — which is the exact failure M0
    // found in the limits list and recorded as B12.
    expect(liveLabels).toContain("'NO OWNER CUSTODY':");
    expect(liveLabels).toContain("'LIMEN HOLDS THE AGENT KEY':");
  });

  it('keeps the owner half a claim about custody, not about capability', () => {
    // The surviving half of the original narrowing, which is the whole reason
    // `NO OWNER CUSTODY` is worth having: it is a statement about who holds the
    // key, and it must not drift back into a statement about what can move
    // funds.
    const owner = /'NO OWNER CUSTODY':\s*'([^']*)'/.exec(liveLabels)?.[1] ?? '';
    expect(owner).toContain('never reaches a Limen server');
    expect(owner).toContain('cannot remove that boundary');
  });

  it('does not let the agent half read as reassurance', () => {
    // This label exists to tell someone a thing they will not like. Every one
    // of these clauses is the part that makes it a limit rather than a feature
    // announcement, and losing any of them turns it into one.
    const agent = /'LIMEN HOLDS THE AGENT KEY':\s*'([^']*)'/.exec(liveLabels)?.[1] ?? '';
    expect(agent).toContain('a key Limen stores and can use while your browser is closed');
    expect(agent).toContain('the account enforces that, not Limen');
    expect(agent).toContain('It cannot revoke itself; you can revoke it.');
  });

  it('has LIMEN HOLDS THE AGENT KEY in the closed set and rendered nowhere', () => {
    // Deliberate, and asserted in both directions so M3 has to flip it rather
    // than someone noticing later that it was never shown.
    //
    // M1's done-when in PLAN-V8 asks for both replacements to be rendered. This
    // is a recorded deviation from it, not a slip: at M1 there is no agent key,
    // `packages/custody` is M2, and no key is held for a user until M3.
    // Rendering it now would put a present-tense claim on a public preview
    // about a risk this project has not yet taken on — and overstating a risk
    // you have not taken on is still stating something false. A claim is true
    // when it is read, not when the plan intends it.
    //
    // The ordering precedent is B4's third label, which enters the set at M1
    // and is unused until the key it names exists. Same rule, same reason: the
    // closed set gains a label before anything can render it, and the label
    // goes up when the fact does.
    //
    // The other half of the argument is that a label meaning nothing the first
    // time a reader meets it means less the second time. Landing it with the
    // fact is what keeps it worth reading.
    const rendered = [
      source('app/page.tsx'),
      source('app/docs/page.tsx'),
      source('components/StatusLabel.tsx'),
    ];
    for (const screen of rendered) {
      expect(screen).not.toContain('LIMEN HOLDS THE AGENT KEY');
    }
    // And it is genuinely available to render, so this is an unrendered label
    // rather than a missing one.
    expect(liveLabels).toContain("'LIMEN HOLDS THE AGENT KEY':");
  });

  it('renders the owner half where NO CUSTODY used to be', () => {
    // The replacement is not merely defined. The spec strip and the docs
    // overview both carried the retired label, and a retirement that left both
    // slots empty would shorten the limits list by one — which is how the
    // landing lost two entries in the V6 rebuild without anything going red.
    expect(source('app/page.tsx')).toContain("'NO OWNER CUSTODY'");
    expect(source('app/docs/page.tsx')).toContain("'NO OWNER CUSTODY'");
  });

  it('narrows local-key.ts to this browser rather than to signing as such', () => {
    // PLAN-V8 B5. "It is the only one" was true when written and stops being
    // true in v8. The narrowed form is true both before and after, which is why
    // it lands at M1 rather than with the code that breaks the old one.
    const localKey = source('lib/local-key.ts');
    expect(localKey).toContain('This module is the only way this browser signs');
    expect(localKey).not.toContain('is not one of two ways to sign — it is the only one');
    // The other half of B5: the "no server involvement" paragraph is a true
    // statement about these keys and was never one about the application.
    expect(localKey).toContain('No server involvement of any kind — in this module');
  });

  it('retires store.ts\'s "no server", in the commit that made it false', () => {
    // PLAN-V8 B6, and the rule the plan states for it: the prose changes in the
    // commit that changes the fact, never before and never after. `/api/auth`
    // is what makes this sentence false — there are user accounts and there is
    // a server — so the sentence goes in the same commit as the routes.
    const store = source('lib/store.ts');
    expect(store).not.toContain('No user accounts, no passwords, no email, no server');
  });

  it('replaces it with what the browser holds and what the server holds instead', () => {
    // Both halves, because deleting the claim and stopping there would leave a
    // module whose header describes a world it no longer lives in. The
    // replacement has to say where the data went.
    const store = source('lib/store.ts');
    expect(store).toContain('There is a server now');
    expect(store).toContain('packages/db/src/schema.ts');
    // The half of the retired sentence that is still true, kept rather than
    // dropped with the rest: a passkey means there is nothing to type.
    expect(store).toContain('**No passwords** survives');
  });

  it('keeps the rule the server inherits, which was the valuable half', () => {
    // The discipline this module is actually worth having — no cached claim
    // about chain state — is unaffected by any of the above, and the schema
    // took it on for the same reason. Pinned in both places so that neither can
    // quietly acquire a `current_cap` column.
    expect(source('lib/store.ts')).toContain('no cached claim about chain state');
    const schema = readFileSync(
      fileURLToPath(new URL('../../../packages/db/src/schema.ts', import.meta.url)),
      'utf8',
    );
    expect(schema).toContain('A cached claim about chain state');
    expect(schema).toContain("This is `lib/store.ts`'s rule, inherited by the server");
  });

  it('keeps the label out of the rendering layer, which is why it survived the rebuild', () => {
    // The other direction of that move, and the reason it is worth pinning: if
    // the constant drifts back into the component, the next deletion of the
    // rendering layer takes the safety rule with it exactly as it did in V6.
    const component = source('components/StatusLabel.tsx');
    expect(component).not.toContain('No key of yours reaches a Limen server');
    expect(component).toContain('status-labels');
  });
});

describe('the activity feed does not imply it is complete', () => {
  // Contract events are emitted on success only. A feed that quietly contained
  // nothing but successes while reading as a full history would be the most
  // flattering possible misrepresentation of a permissions tool: every boundary
  // looks perfectly obeyed if you only show the transactions that got through.
  it('says on screen that events are success-only', () => {
    const screen = source('components/app/ActivityScreen.tsx');
    expect(screen).toContain('emitted on success only');
    expect(screen).toContain('Refused attempts publish no events');
  });

  it('states the ledger range it actually scanned', () => {
    // Every claim of absence is only as good as the range, and a reader who
    // cannot see the range cannot judge the absence.
    expect(source('components/app/ActivityScreen.tsx')).toContain('Scanned ledgers');
  });

  it('distinguishes the RPC forgetting from nothing having happened', () => {
    const screen = source('components/app/ActivityScreen.tsx');
    expect(screen).toContain('retention floor');
    expect(screen).toContain('it is the endpoint&rsquo;s');
  });

  it('says so when a scan was truncated rather than showing it as complete', () => {
    expect(source('components/app/ActivityScreen.tsx')).toContain('This feed is incomplete');
    expect(
      flat(readFileSync(fileURLToPath(new URL('../../../packages/chain/src/events.ts', import.meta.url)), 'utf8')),
    ).toContain('truncated');
  });
});

describe('the refusal screen keeps its two sources apart', () => {
  it('says the refusals came from the network, not from this repository', () => {
    const table = source('components/app/RefusalTable.tsx');
    expect(table).toContain('own evaluator also produces DENY rows');
    expect(table).toContain('None of them appear here');
  });

  it('does not fill a missing hash', () => {
    expect(source('components/app/RefusalTable.tsx')).toContain('never reached a ledger');
  });

  it('does not over-attribute an error it could not decode on-ledger', () => {
    // The expiry axis reached a ledger, but that run's diagnostic scan did not
    // recover the contract code, so only the simulation error is attributable.
    expect(source('components/app/RefusalTable.tsx')).toContain('simulation only');
  });

  it('does not invent which rule a recorded attempt was made under', () => {
    const recorded = source('lib/recorded-runs.ts');
    expect(recorded).toContain('It does not carry a rule id per row');
    expect(recorded).toContain('never as "this');
  });
});

describe('local provenance stays outside the on-chain block', () => {
  it('says why validFromLedger is not rendered as chain state', () => {
    // Design decision 5: `validFromLedger` has no on-chain counterpart, so a
    // field rendered inside the on-chain block would read as something the
    // network enforces.
    const detail = source('components/app/PolicyDetail.tsx');
    expect(detail).toContain('has no counterpart on an OpenZeppelin context rule');
    expect(detail).toContain('deliberately absent from the on-chain block');
  });

  it('keeps the install plan to exactly the fields that go to the chain', () => {
    expect(source('components/app/InstallPlanTable.tsx')).toContain(
      'The install summary shows the fields that go to',
    );
  });
});

describe('a boundary that could not be read is not shown as an absent one', () => {
  it('is stated where the wire contract is defined', () => {
    expect(source('lib/account-contract.ts')).toContain(
      'an account we could not read are different screens',
    );
  });

  it('reports an unreadable policy as unreadable rather than as no limit', () => {
    // "no cap" and "we could not read the cap" are opposite claims.
    expect(source('lib/account-contract.ts')).toContain('and "we could not read the cap" are opposite claims');
  });

  it('calls a rule with no policy unbounded rather than leaving it blank', () => {
    expect(source('components/app/RulesTable.tsx')).toContain('unbounded — no policy attached');
  });
});

describe('the install step, now that it can sign', () => {
  // Retired in v4 step 6, and retired the way PLAN-V4 §9 requires: by the thing
  // the caveat described becoming possible, not by deleting the sentence. Both
  // directions are asserted, because a caveat that outlives its reason
  // understates the work and that is its own kind of inaccuracy.
  it('no longer claims neither signer path exists', () => {
    const screen = source('components/app/NewPolicyScreen.tsx');
    expect(screen).not.toContain('Neither signer path exists in the browser yet');
    expect(screen).not.toContain('not built yet');
  });

  it('rules out ever taking a secret key from a form — on both screens', () => {
    // The survivor. It was true when nothing could sign and it is more
    // load-bearing now that something can, so it is pinned in the component
    // that replaced the caveat as well as in the one that still carries it.
    const sentence = 'There is no form here that accepts a secret key, and there will not be one';
    expect(source('components/app/NewPolicyScreen.tsx')).toContain(sentence);
    expect(source('components/app/InstallControl.tsx')).toContain(sentence);
  });

  it('says which key signs the install, and which one the boundary binds', () => {
    // The claim the product makes is that the agent's key cannot exceed a
    // boundary the owner's key installed. A screen that signs without saying
    // which of the two is acting has asked to be taken on trust.
    const control = source('components/app/InstallControl.tsx');
    expect(control).toContain('signs this install');
    expect(control).toContain('bounded by it');
    expect(control).toContain('it does not sign this');
  });

  it('says a boundary installed here can be taken back', () => {
    expect(source('components/app/InstallControl.tsx')).toContain(
      'A boundary installed here can be taken back',
    );
  });
});

describe('the agent run distinguishes a refusal from a missing rule', () => {
  const steps = source('components/app/AgentRunSteps.tsx');
  /**
   * Re-pointed in the M0 restore, and the move is an improvement rather than a
   * dodge.
   *
   * These four sentences were inline in `AgentRunSteps.tsx` when this file was
   * written. V7's `chain-actions.ts` extraction pulled the verdict copy into
   * `lib/verdict.ts` so that `/app/try` and the reference screens could not
   * disagree about what a given outcome means — which is the same argument the
   * extraction itself was made on. One definition, two consumers.
   *
   * So the assertions follow the sentence to `lib/verdict.ts`, and the screen is
   * checked for *reaching* it rather than for restating it. A screen that
   * inlined its own copy of one of these would pass the old test and be the
   * exact drift the extraction removed.
   */
  const verdict = source('lib/verdict.ts');

  it('routes its verdicts through the one module that defines them', () => {
    expect(steps).toContain('verdictFor');
    expect(steps).toContain("from '@/lib/verdict'");
  });

  it('does not count a revoked rule as a boundary refusal', () => {
    // PLAN-V4 F3. `ContextRuleNotFound#3000` is deliberately absent from
    // BOUNDARY_REFUSAL_CODES, and the screen has to carry that distinction
    // rather than flattening both into DENY.
    expect(verdict).toContain('isRevokedRule');
    expect(verdict).toContain('Not counted as a refusal');
    expect(verdict).toContain('there was no boundary left to consult');
  });

  it('says why the permitted step deliberately spends less than the cap', () => {
    // If step 01 exhausted the cap, step 05 would fail for two reasons at once
    // and demonstrate neither.
    expect(steps).toContain('still inside the cap');
    expect(steps).toContain('not because a limit was reached');
  });

  it('does not attribute an undecodable failure to the boundary', () => {
    expect(verdict).toContain('no code identifying a boundary refusal was decoded');
    expect(source('components/app/WriteResult.tsx')).toContain(
      'A failure is not a refusal until its error code says so',
    );
  });

  it('reports a step that succeeded when it should not have, as it happened', () => {
    // The one that matters most if the boundary ever fails to hold: a screen
    // that rendered an unexpected success as anything other than a success
    // would be hiding exactly the result a reviewer came for.
    expect(verdict).toContain('that means the boundary did not hold');
  });

  it('says an attempt with no hash is not evidence', () => {
    expect(source('lib/chain-write.ts')).toContain('never reached a ledger');
    expect(source('components/app/WriteResult.tsx')).toContain(
      'did not reach a ledger, so there is no hash',
    );
  });
});

describe('the simulator says what it is, now that it is not the front door', () => {
  const page = source('app/app/simulator/page.tsx');

  it('says nothing on it installs anything or was enforced by a network', () => {
    // The demotion is only real if the page states it. A screen that simply
    // stopped being linked from the landing page would still read, to anyone
    // who arrived on it, as the thing the product does.
    expect(page).toContain('Nothing on this screen installs anything');
    expect(page).toContain('no boundary drawn here has been enforced by a network');
  });

  it('points at the screen that does ask a network', () => {
    expect(page).toContain('/app/policies/new');
  });

  it('does not hide the flows it cannot install', () => {
    // PLAN-V3 decision 1. The multi-contract gap is accepted, and the price of
    // accepting it is saying so where a reviewer meets it.
    expect(page).toContain('the only place flows live that no audited primitive can constrain');
    expect(page).toContain('marked as such at step 6 rather than quietly omitted');
  });

  it('does not offer an explorer link for a transaction that never existed', () => {
    // A fixture's hash is well-formed and belongs to nothing. Linking it sends
    // a reviewer to a 404 that reads as the application being broken rather
    // than as the flow being shipped.
    const stepper = source('components/simulator/SimulatorStepper.tsx');
    expect(stepper).toContain('no explorer will find it');
    expect(stepper).toContain("source === 'testnet'");
  });

  it('badges a shipped step as shipped rather than as on-chain', () => {
    expect(source('components/simulator/Beat.tsx')).toContain('never observed on a live network');
  });
});

describe('the landing does not let its two testnet runs read as one pass', () => {
  const page = source('app/page.tsx');

  it('says outright that the worked example is two runs', () => {
    // The most tempting overstatement this project has available. A live
    // ingest that derived a cap of exactly the observed outflow, and an install
    // of a rule with exactly that cap, laid out as steps 01–03 on one page,
    // read as a single pipeline unless the page says they were not.
    //
    // Re-pointed in the M0 restore, and this one got *stronger* rather than
    // moving. The sentence used to be typed into the JSX; V6's rule that no page
    // may contain a typed hash, address or provenance claim moved it into the
    // deployments file, and the page now renders `installedSeparately` from the
    // recording. So the check is that the page reads the seam from the evidence
    // rather than restating it — a page that went back to a literal would be
    // reintroducing the drift the rule exists to stop, and `evidence.test.ts`
    // would fail it too.
    expect(page).toContain('installedSeparately');
    expect(page).toContain('producedBy');
  });

  it('keeps the seam in the recording, not only in the page', () => {
    // If the sentence lived in the JSX, deleting it would be a one-line edit
    // with nothing else to notice. In the deployments file it sits beside the
    // hash it qualifies, where anyone reading the evidence meets it.
    const recorded = flat(
      readFileSync(fileURLToPath(new URL('../../../packages/chain/deployments/testnet.json', import.meta.url)), 'utf8'),
    );
    expect(recorded).toContain('was not piped into the install below');
    expect(recorded).toContain('driven by hand in a browser');
  });

  it('attributes the refusals to the network rather than to this repository', () => {
    // A plain apostrophe, not `&rsquo;`: this one is a string prop rather than
    // JSX text, so the source contains the character itself.
    //
    // Reworded in the V6 rebuild and re-pinned here at the new wording. The
    // clause that was dropped — "and not a simulation" — was replaced by a
    // stronger one naming what else it is not: a server that could be down or
    // persuaded. Both halves of the original claim survive, so this is a
    // rewording rather than a narrowing, and the negative below stops the
    // attribution being dropped altogether in a future pass.
    expect(page).toContain("Not by this repository's evaluator");
    expect(page).toContain('not by a server that could be down or persuaded');
    expect(page).toContain('__check_auth');
    expect(page).not.toContain('refused by Limen');
  });

  it('carries the four load-bearing labels, which is where a reader meets the limits', () => {
    // Design system §9 makes two placements mandatory. This is the first: the
    // spec strip, before the argument rather than after it.
    //
    // Four rather than the seven the closed set defines. `OPEN SOURCE` and
    // `MIT` are stated better by the GitHub link and the repository itself, and
    // `IN DEVELOPMENT` is the vague version of what `TESTNET ONLY` and `NOT
    // AUDITED` say precisely. What this test guards is unchanged by that: these
    // four are the ones a reader has to meet, and the failure it exists to
    // catch is one of them quietly going missing.
    for (const label of ['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY', 'NO OWNER CUSTODY']) {
      expect(page, `the spec strip is missing ${label}`).toContain(`'${label}'`);
    }
  });

  it('states what is not built, on the page most likely to be read first', () => {
    // Retired in v4: installing from the browser is what the app now does, so
    // this limit is replaced rather than deleted.
    expect(page).not.toContain('Nothing installs from the browser');

    // The five the rebuilt landing states. Pinned by their headings, which are
    // the part a reader scans.
    for (const limit of [
      'Testnet only.',
      'Not audited.',
      'Composition only.',
      'No owner custody.',
      'Single-transaction derivation.',
    ]) {
      expect(page, `the landing's limits list is missing "${limit}"`).toContain(limit);
    }
  });

  /**
   * Found by the M0 restore, and recorded rather than quietly accepted.
   *
   * The list this suite used to pin had two entries the rebuilt landing does
   * not: **no wallet and no key recovery**, and **one contract per boundary**.
   * They were not retired by becoming false — both are still true, and both are
   * still stated in the README. They were dropped in the V6 rebuild, and
   * nothing caught it, because the test that would have caught it had been
   * deleted three commits earlier along with the page it pinned.
   *
   * That is the whole argument for this file existing, demonstrated on this
   * file's own absence. The old comment here read *"a limits list that quietly
   * shortens as features land reads as marketing"*, and the list then quietly
   * shortened.
   *
   * What this test does **not** do is put them back. Landing copy is a product
   * decision and M0 is a repair of the fence, not a rewrite of the page. So the
   * claims are pinned where they currently live, the delta is named here, and
   * whether the landing should restate them is a decision recorded in PLAN-V8
   * rather than made by a test.
   */
  it('has not lost the two limits the landing dropped — they survive in the README', () => {
    // The wallet heading changed when wallet sign-in landed: there *is* a
    // wallet button now. What the old heading was really pinning is the claim
    // underneath it — that the wallet is not the owner — so that is what is
    // pinned here, rather than a heading that is no longer true.
    expect(README).toContain('The wallet button, and what it does not do');
    expect(README).toContain('Your wallet is your login. It does not own your smart account.');
    expect(README).toContain('Your account is stranded if you clear your browser');
    expect(README).toContain('Only single-token transfer flows can be installed');
  });
});

/**
 * The agent-builder run, now that the landing cites it.
 *
 * Added with the repositioning, and it closes a gap the repositioning opened
 * rather than one it found. The trap directly below — *does not cite the
 * browser run on the landing without its limit* — is written against the **v4
 * lifecycle run**: it matches `browser has signed`, `driven by a test` and `by
 * a hand`, which are that run's words. Scene 03 now cites a different run,
 * `agentBuilderRun`, in different words, and none of those patterns fire on it.
 * So the landing gained a browser-driven claim that the file's existing fence
 * cannot see.
 *
 * The gap is closed here rather than by widening the regex below, because the
 * two runs need different limits stated and folding them into one check would
 * make the message wrong for whichever one failed.
 *
 * Two limits have to travel with this citation, and they are not the same kind
 * of thing:
 *
 *   1. **Nobody clicked it.** A Playwright spec drove the browser. The page may
 *      say the path runs end to end; it may not say a person found it easy.
 *   2. **No model answered.** `ANTHROPIC_API_KEY` was deliberately unset for
 *      the run, so the draft step degraded to an empty draft. The scene above
 *      it sells "describe an agent in a sentence" — and this recording is
 *      evidence for the deploy path, not for the sentence. Citing it for both
 *      is the specific overstatement available here.
 */
describe('the landing does not cite the agent-builder run without its two limits', () => {
  const page = source('app/page.tsx');

  const citesTheBuild = /RECORDED_AGENT_BUILD\b/.test(page);

  it('cites it at all, or this whole block is vacuous', () => {
    // The two-sided shape the rest of this file uses. If scene 03 is ever
    // rewritten to drop the run, this fails and whoever dropped it decides
    // deliberately whether the assertions below should go with it.
    expect(citesTheBuild, 'the landing no longer cites the agent-builder run').toBe(true);
  });

  it('says a spec drove the browser rather than a person', () => {
    expect(page).toContain('no person clicked');
  });

  it('carries the recording\'s own note that no model answered', () => {
    // Read from the recording rather than restated, for the reason every other
    // provenance line on this page is: a limit typed into JSX is a limit one
    // edit from being untyped, and this one sits beside the hashes it
    // qualifies in `testnet.json`.
    expect(page).toContain('withoutAModel');
  });

  it('does not let the deploy run stand in as evidence for the sentence', () => {
    // The overstatement in its shortest form. "Deployed from a sentence" is
    // what the page would like to say about this run and is the one thing the
    // run does not show.
    expect(page).not.toContain('deployed from a sentence');
    expect(page).not.toContain('a model wrote this one');
  });
});

describe('a built write path is not a demonstrated one', () => {
  const page = source('app/page.tsx');

  // The narrowest and most tempting overstatement v4 has available, and the one
  // this project would fall into by accident rather than by intent: the screens
  // exist, the chain layer works, the hashes are real — and every one of those
  // hashes was signed by a Node script. "Deploying, installing and revoking all
  // run from the browser" was the wording that shipped with step 6, and it reads
  // as a completed run to anyone who has not read PLAN-V4 §11.
  //
  // Pinned in both directions, as every other retirement here is. The negative
  // half matters more than usual: the sentence this replaces is the one a future
  // edit would restore without noticing, because it is shorter and sounds better.
  it('does not claim on the landing that the browser has run the flow', () => {
    // The negative half is the load-bearing one and it still applies to the
    // rebuilt page: the shorter, better-sounding overstatement must not appear.
    expect(page).not.toContain('all run from the browser now');
    expect(page).not.toContain('anyone can run it');
  });

  // Retired on 2026-08-06, by the run happening rather than by the sentence
  // being deleted — §9's rule, applied to the caveat §11 was most careful about.
  //
  // What replaced it is narrower than "it works", and the narrowing is the
  // point. Two things were true at once and had to stay distinguishable: the
  // browser has now signed, and no person has clicked. A driver is not a hand.
  // So the negative half below forbids the retired wording *and* the
  // overstatement it would be tempting to replace it with.
  /**
   * Found by the M0 restore, second of two, and the more serious one.
   *
   * The rebuilt landing does not mention the browser run at all — neither the
   * retired *"the browser has not signed anything yet"*, nor the replacement
   * *"the browser has signed, and no person has clicked"*, nor the driver
   * caveat. The claim did not become false; it left the page.
   *
   * That is defensible on its own terms — the V6 landing argues from the
   * recorded testnet survey rather than from the browser lifecycle run, so a
   * caveat about the lifecycle run has nothing on that page to qualify. It is
   * still worth pinning, because the failure mode this guards against is a
   * future landing that *does* cite the browser run and cites it without the
   * limit.
   *
   * So the test inverts: while the landing says nothing about the browser run,
   * assert it says nothing in *either* direction; and assert the caveat is
   * intact in the README, which is where a reader now meets it. If the landing
   * ever mentions the run again, the first assertion fires and whoever added it
   * has to add the limit with it.
   */
  it('does not cite the browser run on the landing without its limit', () => {
    const mentionsTheRun = /browser has (?:not )?signed|driven by a test|by a hand/.test(page);
    if (mentionsTheRun) {
      expect(page).toContain('The browser has signed, and no person has clicked');
      expect(page).toContain('driven by a test, not by a hand');
    }
    expect(page).not.toContain('The browser has not signed anything yet');
    expect(page).not.toContain('No hash on this page was signed in a browser');
  });

  it('does not let the README describe the path as demonstrated', () => {
    expect(README).not.toContain('and revoke all run from the browser');
    expect(README).toContain('are all built as browser code paths');
  });

  it('says in the README that the browser has signed and nobody has clicked', () => {
    // Both directions. The retired sentences must not survive alongside their
    // replacement — a README carrying both would be contradicting itself in a
    // way that reads as caution.
    expect(README).not.toContain(
      'The browser write path has never signed a transaction in a browser.',
    );
    expect(README).not.toContain('It is implemented and it is not yet demonstrated');
    expect(README).not.toContain('**Those\n  runs have not happened**');

    expect(README).toContain(
      'The browser write path has signed in a browser. Nobody has clicked it.',
    );
    expect(README).toContain('a driver is not a hand');
    // The unmet condition stays named. This is the half a later edit would drop.
    expect(README).toContain('still unmet and still recorded as unmet');
  });

  it('records the browser run, and says what it was not', () => {
    // This assertion used to read `not.toContain('browserRun')`, and it was the
    // loudest check in the file: it existed to stop anyone "filling in" the
    // block from the script run's hashes, because a block named for a browser
    // run is a claim regardless of what is in it.
    //
    // The block is now there because the run happened. So the check inverts and
    // gains the thing that keeps it honest — the record must carry its own
    // limits with it. A `browserRun` block that did not say it was driven by a
    // test would be exactly the overstatement the old assertion was guarding
    // the empty file against.
    const recorded = readFileSync(
      fileURLToPath(new URL('../../../packages/chain/deployments/testnet.json', import.meta.url)),
      'utf8',
    );
    const parsed = JSON.parse(recorded) as {
      browserRun?: { notByHand?: string; runs?: unknown[]; verifiedBy?: string };
    };

    expect(parsed.browserRun, 'the browser run is not recorded').toBeDefined();
    // §11 asks for two completions, the second cold. One is not two.
    //
    // `toHaveLength(2)` until the M0 restore, which is wrong in the direction
    // that matters least but is still wrong: V7 added a third run and this
    // would have failed for the good reason. A floor rather than an equality —
    // the condition is "at least the two §11 asked for", and recording a
    // further run should never turn a suite red.
    expect(parsed.browserRun?.runs?.length ?? 0).toBeGreaterThanOrEqual(2);
    // The limit travels with the record or the record overstates itself.
    expect(parsed.browserRun?.notByHand).toContain('a scripted driver is not a hand');
    expect(parsed.browserRun?.verifiedBy).toContain('verify-browser-run');
  });
});

/**
 * The docs, after V6 split one page into four.
 *
 * When this file was written `/docs` was a single page carrying the agent-key
 * claim, the failure-versus-refusal trap, the limits list and the wallet
 * finding. V6 split it into `/docs`, `/docs/deriving`, `/docs/authorization`
 * and `/docs/reference`, and in the split **four of those claims left the
 * documentation entirely**. Each still exists in the README; none is now met by
 * a reader of `/docs`.
 *
 * The M0 restore does not add them back — that is documentation copy, and this
 * is a repair of the fence rather than a rewrite of the docs. It does three
 * things instead: pins each claim where it currently lives so it cannot be lost
 * from there too, asserts the docs do not carry a *contradicting* form of any
 * of them, and names the gap so it is a decision in PLAN-V8 rather than an
 * accident nobody recorded.
 *
 * That distinction is the one this whole file exists to keep: a claim that
 * moved is fine, a claim that quietly stopped being made is not — and the only
 * way to tell them apart is to have written down where it went.
 */
describe('the agent-key claim keeps its narrow form, wherever it now lives', () => {
  const docsPages = ['app/docs/page.tsx', 'app/docs/authorization/page.tsx'].map(source);

  it('is stated in the README, which is where it survived the docs split', () => {
    // The false version is the tempting one, and it is what every adjacent
    // product says. An agent that holds no key cannot act.
    expect(README).toContain('Limen does not assert that an agent holds no key');
    expect(README).toContain('the key an agent holds cannot exceed the installed boundary');
  });

  it('is not contradicted anywhere in the docs', () => {
    // The claim left the docs. It must not have been replaced by its opposite,
    // which is the failure that would actually mislead someone.
    for (const page of docsPages) {
      expect(page).not.toContain('the agent holds no key');
      expect(page).not.toContain('never holds a key');
    }
  });

  it('keeps the authorization page honest about who signs', () => {
    // What the docs *do* still say, and it must keep saying it: the agent signs
    // with its own key, and the separation is what the boundary rests on.
    const authorization = source('app/docs/authorization/page.tsx');
    expect(authorization).toContain('The agent signs an envelope with its own key');
    expect(authorization).toContain('No owner signature is');
  });

  it('repeats that a failure is not a refusal until its code says so', () => {
    // Relocated, not retired: `WriteResult.tsx` is where a reader now meets it,
    // at the moment a failure is actually being rendered — which is arguably
    // the better place for it than a docs paragraph.
    expect(source('components/app/WriteResult.tsx')).toContain(
      'A failure is not a refusal until its error code says so',
    );
    expect(README).toContain('A failure is not a refusal until its error code says so');
  });

  it('reads its addresses and hashes rather than restating them', () => {
    // Documentation that transcribes a contract address is documentation with
    // a stale contract address in it, one script run from now. This survived
    // the split intact and is now enforced across all four pages by
    // `evidence.test.ts`'s no-typed-hash sweep as well.
    const docs = source('app/docs/page.tsx');
    expect(docs).toContain('RECORDED_RUN');
    expect(docs).toContain('SHARED_CONTRACTS');
    expect(source('app/docs/reference/page.tsx')).toContain('CONTRACT_ERRORS');
  });

  it('does not carry a stale limit that the app has since built', () => {
    // Asserted absent: the docs are where someone deciding whether to trust
    // this reads, and a stale limit there claims the project is less far along
    // than it is.
    for (const page of docsPages) {
      expect(page).not.toContain('No browser signer, so nothing installs from the interface');
      expect(page).not.toContain('No revoke button');
    }
  });

  it('says the wallet path was measured and dropped, not merely skipped', () => {
    // "We did not get to it" and "we tried it and the platform does not support
    // it" are different claims, and only the second is true here. This left the
    // docs in the split and is pinned in the README, which is the only place it
    // is now stated.
    //
    // Both assertions survive wallet sign-in unchanged, and that is the point:
    // what F4 measured was a wallet as the *owner*, and sign-in did not make a
    // wallet an owner. A change that softened either sentence to make room for
    // the button would be the failure this file exists to catch.
    expect(README).toContain('dropped on a measurement rather than on effort');
    expect(README).toContain('Discovery-by-simulation is unavailable on *both* simulations');
  });

  /**
   * Added with wallet sign-in, and pointed at the specific way it could go
   * wrong.
   *
   * The risk is not that the ownership finding gets deleted — the two
   * assertions above cover that. It is that the README grows a wallet button
   * and the sentence saying what the button does *not* do quietly weakens into
   * something reassuring, which is exactly the drift F4's objection describes.
   * So the disclosure is pinned in both directions: it must name the browser
   * key as the owner, and it must not claim the wallet signs for the account.
   */
  it('does not let the wallet button imply the wallet controls the account', () => {
    expect(README).toContain('It does not own your smart account');
    expect(README).toContain('the disposable ed25519 key in this browser');
    expect(README).toContain('A wallet still cannot be an `External` signer');

    // The claim that would be false. Pinned as an absence, because a sentence
    // nobody wrote is the thing a test cannot otherwise notice.
    expect(README).not.toContain('sign in with your wallet to own');
    expect(README).not.toContain('your wallet controls');
  });
});

describe('the accurate-or-absent rule is written down where it is enforced', () => {
  it('is stated in the extractor and in the README', () => {
    expect(source('lib/extract.ts')).toContain('ACCURATE OR ABSENT');
    expect(README).toContain('Ingest is accurate or absent, never quietly narrowed.');
  });
});

/**
 * The copy is about trading now, and the one thing it must not say.
 *
 * The product moved from payments to trading and the interface said payments
 * for a while afterwards — a placeholder offering *"pay approved suppliers up
 * to 50 USDC"*, a review step labelled "Per-payment ceiling". Copy that
 * describes the previous product is not a cosmetic problem: a placeholder is
 * the strongest instruction on a form, because it is the shape of answer people
 * copy.
 *
 * The trap this file exists for is the opposite mistake, and it is the one that
 * would matter: **rewriting the copy into a claim that trading works.** It does
 * not. There is no swap tool, `send_payment` is the only thing an agent can
 * call, and whether a spending limit even binds a swap is unmeasured. So the
 * assertions below come in two halves — what the copy now says, and what it is
 * still not allowed to say.
 */
describe('the app surface speaks about trading, and does not claim it trades', () => {
  const strategyInput = source('components/app/StrategyInput.tsx');
  const configForm = source('components/app/AgentConfigForm.tsx');
  const offChain = source('components/app/OffChainSummary.tsx');
  const newPage = source('app/app/agents/new/page.tsx');

  it('offers a strategy as the example, not a payment to a supplier', () => {
    // Scoped to the constant rather than the file, and deliberately: the
    // component's header quotes the retired placeholder to record why it went,
    // and a check that forbids naming the thing it forbids also forbids
    // documenting the decision. `design-system.test.ts` hit exactly this with
    // Geist and resolved it the same way — match the declaration, not the prose.
    const placeholder = /const PLACEHOLDER = '([^']+)'/.exec(strategyInput)?.[1];
    expect(placeholder, 'no PLACEHOLDER constant found').toBeDefined();
    expect(placeholder).toBe('buy XLM whenever the price drops 5%, spend at most 20 USDC a day');
    expect(placeholder).not.toMatch(/suppliers?|invoice|payroll/i);
  });

  it('labels the review fields as trading limits', () => {
    expect(configForm).toContain('label="Per-trade cap"');
    expect(configForm).toContain('label="Allowed counterparties"');
    expect(configForm).toContain('label="Spend cap"');
    // The window is selectable between per day and per week, so the cap field
    // is not called a daily cap — it is a daily cap only when the window beside
    // it says so, and the hint is where that is stated.
    expect(configForm).not.toContain('label="Per-payment ceiling"');
    expect(configForm).not.toContain('label="Approved recipients"');
  });

  it('keeps the off-chain summary in the same words as the fields it summarises', () => {
    // These two render the same two constraints and drifted apart once before,
    // which is how a screen ends up calling one thing by two names.
    expect(offChain).toContain('per-trade cap');
    expect(offChain).toContain('allowed counterparties');
    expect(offChain).not.toContain('per-payment ceiling');
  });

  it('does not promise that this flow places a trade', () => {
    // The load-bearing assertion. Everything above renames a limit; this one
    // stops the rename becoming a claim. Nothing in this product executes a
    // swap, and the builder says so on the screen where somebody would most
    // reasonably assume otherwise.
    expect(newPage).toContain('Nothing here places a trade');
    for (const page of [newPage, strategyInput]) {
      expect(page).not.toMatch(/executes? (a )?(trade|swap)/i);
      expect(page).not.toMatch(/places? (the )?(trade|order)s? for you/i);
    }
  });

  it('still says Limen rather than the ledger enforces the two off-chain limits', () => {
    // The rename must not blur the partition. The per-trade cap and the
    // counterparty list are Limen's opinion; the spend cap is the network's
    // rule. That distinction survived the rewrite word for word.
    expect(configForm).toContain('The ledger does not enforce these.');
    expect(configForm).toContain('Limen records what you put here and will refuse a trade that breaks it');
    expect(configForm).toContain('could ignore Limen entirely');
  });
});
