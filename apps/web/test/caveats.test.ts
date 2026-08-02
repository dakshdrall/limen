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
    // The chain layer now produces genuine network refusals, so the unqualified
    // form of this caveat became false. The scoped form must survive, because
    // the two screens that exist still adjudicate locally and a reader who
    // conflates the two would credit the demo with something it does not do.
    expect(README).toContain(
      "On the two screens that exist, the deny table proves refusal as adjudicated by this repository's evaluator, not as enforced on-chain.",
    );
    expect(README).toContain("the ones with transaction hashes above are the network's");
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

describe('the accurate-or-absent rule is written down where it is enforced', () => {
  it('is stated in the extractor and in the README', () => {
    expect(source('lib/extract.ts')).toContain('ACCURATE OR ABSENT');
    expect(README).toContain('Ingest is accurate or absent, never quietly narrowed.');
  });
});
