/**
 * One key has two public forms, and comparing the wrong pair is silent.
 *
 * A context rule's `External` signer holds the raw 32 bytes of an ed25519
 * public key. `readAllContextRules` hands those back as **hex**, because that is
 * what the contract stores. `local-key.ts` also holds a `G…` **StrKey**, because
 * that is what a person reads. They are the same key. They are never the same
 * string.
 *
 * Every ownership check in the app is one of those comparisons — *does this
 * browser hold the key this rule names* — and the first browser run of the §1
 * acceptance test found both of them comparing the two forms directly. The
 * effect was total and quiet: `ownsThisAccount` and `boundedByThisBrowser` were
 * false for every account the browser had just created, so `/app/accounts/[id]`
 * offered its read-only state to the owner and the whole write flow after
 * deploy was unreachable. Nothing threw. Nothing logged. The screen simply said
 * "not this browser's account" about an account created thirty seconds earlier.
 *
 * No unit test could have caught it, because none of them compared a real
 * generated key against a real rule read back off the chain — which is the
 * argument PLAN-V4 §11 makes for the browser run existing at all, arrived at
 * the expensive way.
 *
 * Two things are pinned here, and they fail for different reasons:
 *
 *   1. **The forms differ.** If `toHex(rawPublicKey) === publicKey` ever became
 *      true, the bug would be unreachable and so would this test — and the day
 *      that changes is the day the comparison silently starts mattering again.
 *   2. **The call sites compare hex.** Source-level, in the idiom of
 *      `local-key-label.test.ts`: the two ownership checks must reach for the
 *      raw/hex hook, and must not compare a `signer.publicKey` against the
 *      display hook's value.
 *
 * Scope, stated as elsewhere: the second half reads source, not rendered DOM.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { toHex } from '@limen/chain';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The two screens that ask whether this browser holds a rule's key. */
const OWNERSHIP_CHECKS = [
  'components/app/AccountWriteSteps.tsx',
  'components/app/AgentRunSteps.tsx',
] as const;

function source(path: string): string {
  // Comments stripped, for the same reason `local-key-label.test.ts` strips
  // them: a file must not pass because it *describes* the right comparison.
  return readFileSync(join(SRC, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the two public forms of one key', () => {
  it('are never equal, which is why comparing them is a silent failure', () => {
    for (let i = 0; i < 8; i += 1) {
      const keypair = Keypair.random();
      const strkey = keypair.publicKey();
      const hex = toHex(new Uint8Array(keypair.rawPublicKey()));

      expect(strkey).toMatch(/^G[A-Z2-7]{55}$/);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
      // The failure this whole file exists for. Not "usually unequal" — the
      // alphabets do not overlap, so no generated key can make it true.
      expect(hex).not.toBe(strkey);
    }
  });

  it('describe the same 32 bytes, so the hex comparison is the correct one', () => {
    const keypair = Keypair.random();
    const raw = new Uint8Array(keypair.rawPublicKey());

    expect(raw).toHaveLength(32);
    // What a rule's `External` signer holds, and what `read.ts` returns.
    expect(toHex(raw)).toBe(
      [...raw].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
  });
});

describe('the ownership checks compare hex', () => {
  it.each(OWNERSHIP_CHECKS)('%s reaches for the raw public keys', (path) => {
    const text = source(path);
    expect(
      text,
      `${path} decides whether this browser holds a rule's key, so it must read the hex form`,
    ).toContain('useLocalKeyRawPublics');
  });

  it.each(OWNERSHIP_CHECKS)('%s never compares a signer against a G-address', (path) => {
    const text = source(path);

    // Every `signer.publicKey === x` in the file, with `x` captured.
    const comparisons = [...text.matchAll(/signer\.publicKey\s*===\s*(\w+)/g)].map(
      (match) => match[1],
    );
    expect(comparisons.length, `${path} has no signer comparison left to check`).toBeGreaterThan(0);

    for (const operand of comparisons) {
      // `owner` and `agent` are the display StrKeys on both screens. A
      // comparison against either is the bug, restored.
      expect(
        operand,
        `${path} compares a rule's hex signer against \`${operand}\`, which is a G-address`,
      ).not.toMatch(/^(owner|agent)$/);
      expect(operand).toMatch(/Raw$/);
    }
  });
});
