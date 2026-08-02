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

  it('is stated in the README too', () => {
    expect(README).toContain(
      "The deny table proves refusal as adjudicated by this repository's evaluator, not as enforced on-chain.",
    );
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
