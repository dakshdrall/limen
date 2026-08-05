/**
 * The two guards that sit on every write path.
 *
 * Both are the kind of check that is easy to write and easy to stop calling, so
 * each is tested twice: once that it fires when it should, and once — by
 * scanning source — that it is still wired into the code that would need it.
 * A guard nobody calls and a guard that never had anything to catch look
 * identical from a green build.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TESTNET_PASSPHRASE } from '../src/network.js';
import { assertDistinctSigners, assertTestnet, signAs } from '../src/sign.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

describe('the mainnet gate, level 2: a runtime throw', () => {
  // Level 1 is the type union in `network.ts`, which covers every caller
  // TypeScript compiles and nothing that arrives as a string at runtime. Level
  // 3 is the CI grep on the built client bundle. This is the middle one, and
  // it is the only one that can be shown firing in a unit test — so it is.

  it('throws on the mainnet passphrase', () => {
    expect(() => assertTestnet(MAINNET_PASSPHRASE as never)).toThrow(/testnet and nothing else/);
  });

  it('throws on anything else at all, including an empty string', () => {
    for (const value of ['', 'Standalone Network ; February 2017', 'testnet', undefined, null]) {
      expect(() => assertTestnet(value as never), String(value)).toThrow();
    }
  });

  it('permits the one passphrase this package builds for', () => {
    expect(() => assertTestnet(TESTNET_PASSPHRASE)).not.toThrow();
  });

  it('is reached before a signer is built, not after', () => {
    // `signAs` returns a function. If the check happened inside the returned
    // closure, a caller could construct a mainnet signer and only discover it
    // at the moment of signing — which on a write path is one step too late.
    expect(() =>
      signAs({
        signer: { rawPublicKey: () => new Uint8Array(32), sign: () => new Uint8Array(64) },
        verifier: 'CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX',
        contextRuleIds: [0],
        expirationLedger: 1,
        passphrase: MAINNET_PASSPHRASE as never,
      }),
    ).toThrow(/testnet and nothing else/);
  });

  it('does not contain the mainnet passphrase as a string anywhere in the graph', () => {
    // The string appears in this test file and must not appear in `src/`. CI
    // makes the same assertion against the built client bundle; this one fails
    // faster and names the file.
    const offenders = [...reachable('browser.ts')]
      .filter(([, text]) => text.includes(MAINNET_PASSPHRASE))
      .map(([file]) => file.slice(SRC.length));
    expect(offenders).toEqual([]);
  });
});

describe('two keys, enforced rather than intended', () => {
  const owner = new Uint8Array(32).fill(1);
  const agent = new Uint8Array(32).fill(2);

  it('throws when the owner and the agent are the same key', () => {
    expect(() => assertDistinctSigners(owner, new Uint8Array(32).fill(1))).toThrow(/same key/);
  });

  it('names the key it refused, so the failure is actionable', () => {
    expect(() => assertDistinctSigners(owner, owner)).toThrow(/0101010101/);
  });

  it('permits two different keys', () => {
    expect(() => assertDistinctSigners(owner, agent)).not.toThrow();
  });

  it('compares contents rather than identity', () => {
    // Two separately allocated arrays holding the same bytes are the same key.
    // An identity check would pass them and the demonstration would be void.
    expect(() => assertDistinctSigners(new Uint8Array(32), new Uint8Array(32))).toThrow();
  });

  it('does not treat a prefix as a match', () => {
    expect(() => assertDistinctSigners(new Uint8Array(32), new Uint8Array(31))).not.toThrow();
  });
});

function reachable(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    for (const match of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      queue.push(resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts')));
    }
  }
  return seen;
}

describe('the guard is still wired in', () => {
  /**
   * The rule, stated so it can be checked: a module that handles an owner key
   * and an agent key together is a module that can confuse them, and it has to
   * call the guard.
   *
   * Written as a property of the source rather than a list of files, because a
   * list would go stale the first time a module is added — and the failure mode
   * of a stale allowlist is a green build over an unguarded write path.
   */
  const HOLDS_OWNER_KEY = /\bownerPublicKey\b/;
  const HOLDS_AGENT_KEY = /\bagentPublicKey\b/;

  it('installFunctions calls it before it builds anything', () => {
    const install = readFileSync(join(SRC, 'install.ts'), 'utf8');
    expect(install).toContain('assertDistinctSigners(context.ownerPublicKey, context.agentPublicKey)');
  });

  it('the rule matches the file it was written for', () => {
    // Guards the guard: if `install.ts` stopped matching, the scan below would
    // pass over an empty set and report nothing wrong forever.
    const install = readFileSync(join(SRC, 'install.ts'), 'utf8');
    expect(HOLDS_OWNER_KEY.test(install) && HOLDS_AGENT_KEY.test(install)).toBe(true);
  });

  it('every module that holds both keys calls it', () => {
    const unguarded = [...reachable('browser.ts')]
      .filter(
        ([file, text]) =>
          !file.endsWith('sign.ts') &&
          HOLDS_OWNER_KEY.test(text) &&
          HOLDS_AGENT_KEY.test(text) &&
          !text.includes('assertDistinctSigners('),
      )
      .map(([file]) => file.slice(SRC.length));
    expect(unguarded).toEqual([]);
  });

  it('the acceptance script calls it before it spends anything', () => {
    // Ordering matters here and nowhere else in this file: friendbot funds two
    // accounts before the deploy, and discovering that both roles are one key
    // after paying for them is a worse report than refusing up front.
    const script = readFileSync(join(SRC, '..', 'scripts', 'acceptance.mjs'), 'utf8');
    for (const command of ['async function deploy()', 'async function run()']) {
      const body = script.slice(script.indexOf(command));
      const guard = body.indexOf('assertDistinctSigners(');
      const spend = body.indexOf('await fund(');
      expect(guard, command).toBeGreaterThan(-1);
      expect(guard, command).toBeLessThan(spend);
    }
  });
});
