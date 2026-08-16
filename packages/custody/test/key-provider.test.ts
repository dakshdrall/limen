/**
 * The provider's three properties: it round-trips, it refuses, and it detects.
 *
 * Written against `EnvMasterKeyProvider` directly rather than through
 * `resolveKeyProvider`, because the constructor takes its `NODE_ENV` and its
 * network as arguments precisely so this can be tested by passing values rather
 * than by mutating the environment of the test process — which is the kind of
 * test that passes for the wrong reason when files run in a different order.
 */

import { randomBytes } from 'node:crypto';
import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import { describe, expect, it } from 'vitest';
import { EnvMasterKeyProvider } from '../src/env-master-key.js';
import { WrongKeyProviderError } from '../src/key-provider.js';

const MASTER = randomBytes(32).toString('base64');
const DATA_KEY = new Uint8Array(randomBytes(32));

const provider = (over: Partial<Parameters<typeof EnvMasterKeyProvider.prototype.constructor>[0]> = {}) =>
  new EnvMasterKeyProvider({
    masterKeyBase64: MASTER,
    nodeEnv: 'test',
    networkPassphrase: TESTNET_PASSPHRASE,
    ...over,
  });

describe('wrapping a data key', () => {
  it('round-trips', async () => {
    const p = provider();
    const wrapped = await p.wrapDataKey(DATA_KEY);
    expect(new Uint8Array(await p.unwrapDataKey(wrapped))).toEqual(DATA_KEY);
  });

  it('does not put the plaintext in the wrapped value', async () => {
    // The obvious failure, and one that a round-trip test alone would not
    // notice: an implementation that "wrapped" by concatenating would pass
    // every assertion above.
    const wrapped = await provider().wrapDataKey(DATA_KEY);
    const haystack = Buffer.from(wrapped.bytes).toString('hex');
    expect(haystack).not.toContain(Buffer.from(DATA_KEY).toString('hex'));
  });

  it('produces a different ciphertext every time', async () => {
    // A fresh nonce per wrap. Two identical data keys wrapping to identical
    // bytes would let an operator with database access tell which agents share
    // a key without decrypting anything.
    const p = provider();
    const a = await p.wrapDataKey(DATA_KEY);
    const b = await p.wrapDataKey(DATA_KEY);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(false);
  });

  it('records the provider id on the wrapped value', async () => {
    const wrapped = await provider({ id: 'env-master-v1' }).wrapDataKey(DATA_KEY);
    expect(wrapped.keyId).toBe('env-master-v1');
  });
});

describe('unwrapping refuses what it should', () => {
  it('rejects a tampered ciphertext rather than returning plausible bytes', async () => {
    // GCM's tag, doing the one job that matters here. For a key, silently
    // returning the wrong 32 bytes is worse than any error.
    const p = provider();
    const wrapped = await p.wrapDataKey(DATA_KEY);
    const tampered = Uint8Array.from(wrapped.bytes);
    tampered[20] = (tampered[20]! ^ 0xff) & 0xff;
    await expect(p.unwrapDataKey({ ...wrapped, bytes: tampered })).rejects.toThrow();
  });

  it('rejects a wrapped key from a different provider', async () => {
    const wrapped = await provider({ id: 'env-master-v1' }).wrapDataKey(DATA_KEY);
    await expect(provider({ id: 'kms-prod-2027' }).unwrapDataKey(wrapped)).rejects.toThrow(
      WrongKeyProviderError,
    );
  });

  it('names kms_key_id when it refuses, because that is how the row is recovered', async () => {
    const wrapped = await provider({ id: 'env-master-v1' }).wrapDataKey(DATA_KEY);
    await expect(provider({ id: 'kms-prod-2027' }).unwrapDataKey(wrapped)).rejects.toThrow(/kms_key_id/);
  });

  it('rejects a wrapped key whose recorded id was edited in the database', async () => {
    // The id is authenticated as additional data, so changing it in a row and
    // changing the provider to match still fails. Without the AAD binding, an
    // operator could relabel a row and have it unwrap under a different key.
    const p = provider({ id: 'env-master-v1' });
    const wrapped = await p.wrapDataKey(DATA_KEY);
    const relabelled = { ...wrapped, keyId: 'env-master-v2' };
    await expect(provider({ id: 'env-master-v2' }).unwrapDataKey(relabelled)).rejects.toThrow();
  });

  it('rejects a wrapped value too short to contain a nonce and a tag', async () => {
    await expect(
      provider().unwrapDataKey({ bytes: new Uint8Array(4), keyId: 'env-master-v1' }),
    ).rejects.toThrow(/too short/);
  });
});

describe('the production fence', () => {
  it('refuses to construct in production against a non-testnet network', () => {
    expect(() =>
      provider({ nodeEnv: 'production', networkPassphrase: 'Public Global Stellar Network ; September 2015' }),
    ).toThrow(/refuses to construct/);
  });

  it('says why, and says it is a fence rather than a setting', () => {
    try {
      provider({ nodeEnv: 'production', networkPassphrase: 'Public Global Stellar Network ; September 2015' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('not protected against a host compromise');
      expect(message).toContain('mainnet precondition');
      expect(message).toContain('This is a fence, not a configuration option');
    }
  });

  it('permits production against testnet, which is what this deployment is', () => {
    // The other direction, and the one that keeps the fence from being
    // something to work around. "Refuse in production" would refuse the actual
    // deployment; the condition is production *and* not testnet.
    expect(() => provider({ nodeEnv: 'production', networkPassphrase: TESTNET_PASSPHRASE })).not.toThrow();
  });

  it('refuses before it loads the master key', () => {
    // Ordering, asserted. A constructor that validated the key first would
    // report a length problem and, in the case where the key is fine, would
    // already have read it into the process it is refusing to run in.
    expect(() =>
      provider({
        nodeEnv: 'production',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        masterKeyBase64: 'obviously-not-32-bytes',
      }),
    ).toThrow(/refuses to construct/);
  });
});

describe('the master key itself', () => {
  it('refuses a key of the wrong length, and says how to make one', () => {
    expect(() => provider({ masterKeyBase64: Buffer.from('short').toString('base64') })).toThrow(
      /32-byte master key/,
    );
    expect(() => provider({ masterKeyBase64: Buffer.from('short').toString('base64') })).toThrow(
      /randomBytes\(32\)/,
    );
  });

  it('is not reachable from the provider once constructed', () => {
    // No getter, no field, no `toJSON`. The private field means an accidental
    // `JSON.stringify(provider)` in a log line carries nothing.
    const p = provider();
    expect(JSON.stringify(p)).not.toContain(MASTER);
    expect(Object.keys(p)).toEqual(['id']);
  });
});
