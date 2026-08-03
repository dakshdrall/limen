/**
 * Caveat strings, pinned.
 *
 * Every honesty caveat in this project is one careless edit away from being
 * softened into marketing. These assertions exist so that softening one is a
 * red build rather than a quiet improvement in tone.
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
    const stepper = source('components/demo/DemoStepper.tsx');
    // `&rsquo;` rather than a literal apostrophe: this is JSX source, and the
    // entity is what the component actually contains.
    expect(stepper).toContain('adjudicated by this repository&rsquo;s evaluator');
    expect(stepper).toContain('not by a deployed policy contract');
  });

  it('is stated in the README too, and scoped to the screens it is true of', () => {
    // The chain layer produces genuine network refusals, so the unqualified
    // form of this caveat became false. The scoped form must survive, because
    // `/` and `/demo` still adjudicate locally and a reader who conflates the
    // two would credit the demo with something it does not do.
    //
    // Rescoped once already: it said "the two screens that exist" until the
    // interface screens landed and there were more than two. The names are in
    // it now, so the next screen cannot silently widen it.
    expect(README).toContain(
      "On `/` and `/demo`, the deny table proves refusal as adjudicated by this repository's evaluator, not as enforced on-chain.",
    );
    expect(README).toContain("the ones with transaction hashes above are the network's");
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
  it('does not claim an install happened without a deployed smart account', () => {
    const stepper = source('components/demo/DemoStepper.tsx');
    expect(stepper).toContain('depends on a deployed OpenZeppelin smart account');
    expect(stepper).toContain('nothing here is submitted');
  });
});

describe('the custody claim stays accurate now that a signer exists', () => {
  it('drops the unqualified claim and names the one signer that exists', () => {
    // The unqualified sentence became false the moment the demo signer landed.
    expect(README).not.toContain(
      'There is no code path in this repository that can move user funds.',
    );
    expect(README).toContain("There is no code path in this repository that can move a user's funds.");
    expect(README).toContain('There is exactly one code path that can move any funds at all');
  });

  it('still describes the demo account as disposable', () => {
    expect(README).toContain('disposable and holds trivial funds');
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

describe('the install step does not pretend it can sign', () => {
  it('says the signer paths do not exist yet, in place of a button', () => {
    const screen = source('components/app/NewPolicyScreen.tsx');
    expect(screen).toContain('Neither signer path exists in the browser yet');
  });

  it('rules out ever taking a secret key from a form', () => {
    expect(source('components/app/NewPolicyScreen.tsx')).toContain(
      'There is no form here that accepts a secret key, and there will not be one',
    );
  });
});

describe('the accurate-or-absent rule is written down where it is enforced', () => {
  it('is stated in the extractor and in the README', () => {
    expect(source('lib/extract.ts')).toContain('ACCURATE OR ABSENT');
    expect(README).toContain('Ingest is accurate or absent, never quietly narrowed.');
  });
});
