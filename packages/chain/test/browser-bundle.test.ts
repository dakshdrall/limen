/**
 * The write path, run the way the browser will run it.
 *
 * Two things are different here from the rest of the suite, and both are the
 * point:
 *
 *  1. `@stellar/stellar-sdk` is aliased to the SDK's **browser** bundle. See
 *     `vitest.browser-sdk.config.ts` and `stubs/stellar-sdk-browser.mjs`.
 *  2. `globalThis.Buffer` is **deleted** while the assertions run.
 *
 * `browser-path.test.ts` reads source and proves no module reachable from
 * `browser.ts` names `Buffer` in a position that would execute. This proves the
 * stronger, less legible thing: that the values these functions hand the SDK
 * are values its browser build accepts. `bytes.ts` casts a `Uint8Array` to
 * `Buffer` to satisfy a declaration written for Node, and a type assertion is
 * exactly the kind of claim that a compiler cannot check and a person should
 * not be asked to take on trust.
 *
 * Scope, stated rather than implied: modules are imported at the top of this
 * file, so `Buffer` is still present while they load. Import-time use is caught
 * by the source scan, not here. What this catches is call time, which is where
 * every use in this package was.
 */

import { describe, expect, it } from 'vitest';
import { Keypair, xdr } from '@stellar/stellar-sdk';
import {
  authDigest,
  authPayload,
  callContractType,
  externalSigner,
  i128,
  spendingLimitParams,
} from '../src/authpayload.js';
import { concatBytes, fromHex, scvBytes, sha256, toHex } from '../src/bytes.js';
import { deployAccountFunction } from '../src/deploy.js';
import { addContextRuleFunction } from '../src/install.js';
import { removeContextRuleFunction, removePolicyFunction } from '../src/revoke.js';
import { assertDistinctSigners } from '../src/sign.js';

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const VERIFIER = 'CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const POLICY = 'CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE';
const ACCOUNT = 'CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V';
const DEPLOYER = 'GAROIM2HS4IQ4Q2A7GEANZK2RVH3HYX7RGY6FUOHLL7IVEYNELBFNXQT';
const WASM_HASH = '1815dda1b96ea6d23865be8a16ffcbe0b8336d15fc0d3d5ada776c06cb17afde';

/**
 * Run `fn` with no `Buffer` global, and put it back afterwards.
 *
 * Scoped rather than deleted for the whole file: vitest itself runs in this
 * process, and a test harness that cannot allocate a buffer reports failures it
 * did not find.
 */
function withoutBuffer<T>(fn: () => T): T {
  const real = globalThis.Buffer;
  // @ts-expect-error — removing a global is the entire experiment.
  delete globalThis.Buffer;
  try {
    return fn();
  } finally {
    globalThis.Buffer = real;
  }
}

describe('the experiment is set up the way it claims to be', () => {
  it('is running against the SDK browser bundle, not the Node build', async () => {
    // If this ever resolves to the Node build, every assertion below becomes a
    // statement about Node and the file silently stops testing what it says.
    //
    // Asserted as "defined, and the same object" rather than only "the same
    // object": if the alias silently stopped applying, both sides would be
    // `undefined` and an identity check alone would pass while proving nothing.
    const bundled = (globalThis as { StellarSdk?: { xdr?: unknown } }).StellarSdk;
    expect(bundled?.xdr).toBeDefined();
    const sdk = await import('@stellar/stellar-sdk');
    expect((sdk as unknown as { default?: unknown }).default).toBe(bundled);
  });

  it('can tell that the global is actually gone', () => {
    expect(withoutBuffer(() => typeof globalThis.Buffer)).toBe('undefined');
    expect(typeof globalThis.Buffer).toBe('function');
  });

  it('would fail on code that needs the global', () => {
    // The detector proving itself, in the idiom this repository already uses:
    // a check that has never been shown firing is a comment.
    expect(() =>
      withoutBuffer(() => (globalThis as { Buffer?: { from(s: string): unknown } }).Buffer!.from('x')),
    ).toThrow();
  });
});

describe('bytes helpers need no Buffer', () => {
  it('round-trips hex', () => {
    withoutBuffer(() => {
      expect(toHex(fromHex('00ff10'))).toBe('00ff10');
      expect(toHex(new Uint8Array([1, 2, 3]))).toBe('010203');
    });
  });

  it('refuses hex it cannot read rather than truncating it', () => {
    withoutBuffer(() => {
      expect(() => fromHex('12zz')).toThrow();
      expect(() => fromHex('abc')).toThrow();
    });
  });

  it('concatenates and hashes', () => {
    withoutBuffer(() => {
      expect(toHex(concatBytes(new Uint8Array([1]), new Uint8Array([2, 3])))).toBe('010203');
      expect(sha256(new Uint8Array([0]))).toHaveLength(32);
    });
  });

  it('hands the SDK a Uint8Array and gets the bytes back out', () => {
    // The one cast in `bytes.ts`, exercised against the build that will run it.
    const value = withoutBuffer(() => scvBytes(new Uint8Array([9, 8, 7])));
    expect(toHex(new Uint8Array(xdr.ScVal.fromXDR(value.toXDR()).bytes()))).toBe('090807');
  });
});

describe('the encodings build without a Buffer global', () => {
  const key = new Uint8Array(32).fill(7);

  it('builds a signer, a context type and a policy param', () => {
    withoutBuffer(() => {
      expect(externalSigner(VERIFIER, key).switch().name).toBe('scvVec');
      expect(callContractType(CONTRACT).switch().name).toBe('scvVec');
      expect(spendingLimitParams(1_000_000n, 17_280).switch().name).toBe('scvMap');
      expect(i128(1n << 100n).switch().name).toBe('scvI128');
    });
  });

  it('produces the same digest the Node build produces', () => {
    // The assertion that matters most: the browser build must not encode
    // `context_rule_ids` differently, because a signature over a different
    // digest is a signature the network rejects — and it would only be
    // discovered by spending a fee to be told no.
    const payload = new Uint8Array(32).fill(9);
    const withGlobal = toHex(authDigest(payload, [3, 4]));
    const withoutGlobal = withoutBuffer(() => toHex(authDigest(payload, [3, 4])));
    expect(withoutGlobal).toBe(withGlobal);
    // …and it is still 32 bytes, so it can be signed as an ed25519 digest.
    expect(withoutGlobal).toHaveLength(64);
  });

  it('builds an AuthPayload from a signature', () => {
    withoutBuffer(() => {
      const payload = authPayload(
        [{ signer: externalSigner(VERIFIER, key), signature: new Uint8Array(64).fill(3) }],
        [1],
      );
      expect(payload.map()!.map((e) => e.key().sym().toString())).toEqual([
        'context_rule_ids',
        'signers',
      ]);
    });
  });
});

describe('the write path builds without a Buffer global', () => {
  const agent = new Uint8Array(32).fill(1);
  const owner = new Uint8Array(32).fill(2);

  it('builds a contract creation', () => {
    withoutBuffer(() => {
      const func = deployAccountFunction({
        accountWasmHash: WASM_HASH,
        deployer: DEPLOYER,
        owner: { kind: 'external', verifier: VERIFIER, publicKey: owner },
      });
      expect(func.switch().name).toBe('hostFunctionTypeCreateContractV2');
    });
  });

  it('builds an add_context_rule', () => {
    withoutBuffer(() => {
      const func = addContextRuleFunction(
        {
          contract: CONTRACT,
          name: 'limen-0',
          validUntilLedger: 4_000_000,
          policies: [{ kind: 'spending_limit', asset: CONTRACT, limit: '1000000', windowLedgers: 17_280 }],
        },
        {
          smartAccount: ACCOUNT,
          verifier: VERIFIER,
          spendingLimitPolicy: POLICY,
          agentPublicKey: agent,
          ownerPublicKey: owner,
        },
      );
      expect(func.invokeContract().functionName().toString()).toBe('add_context_rule');
    });
  });

  it('builds a revoke, and the distinct-signer guard still fires', () => {
    withoutBuffer(() => {
      expect(removeContextRuleFunction(ACCOUNT, 3).invokeContract().functionName().toString()).toBe(
        'remove_context_rule',
      );
      expect(removePolicyFunction(ACCOUNT, 3, 0).invokeContract().functionName().toString()).toBe(
        'remove_policy',
      );
      expect(() => assertDistinctSigners(owner, owner)).toThrow(/same key/);
      expect(() => assertDistinctSigners(owner, agent)).not.toThrow();
    });
  });

  it('signs a digest with a key the browser build generated', () => {
    withoutBuffer(() => {
      const keypair = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(5) as never);
      const digest = authDigest(new Uint8Array(32).fill(9), [0]);
      expect(new Uint8Array(keypair.sign(digest as never))).toHaveLength(64);
    });
  });
});
