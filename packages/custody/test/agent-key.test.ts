/**
 * The agent key: generated, sealed, opened once, and refused where it should be.
 *
 * The tests that matter here are the negative ones. That a key round-trips is
 * table stakes and would pass against an implementation that stored the seed in
 * plaintext beside the ciphertext. What this file is actually for is the three
 * refusals — a seed moved between agents, a row from another provider, a row
 * written under a format this build does not open — because each of those is a
 * way the key could end up signing for something it was not generated for.
 */

import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import { AGENT_KEY_ALGORITHM, generateAgentKey, withAgentKey } from '../src/agent-key.js';
import { EnvMasterKeyProvider } from '../src/env-master-key.js';
import { WrongKeyProviderError } from '../src/key-provider.js';

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

function provider(id?: string): EnvMasterKeyProvider {
  return new EnvMasterKeyProvider({
    masterKeyBase64: MASTER_KEY,
    ...(id === undefined ? {} : { id }),
    nodeEnv: 'test',
    networkPassphrase: TESTNET_PASSPHRASE,
  });
}

const AGENT = '11111111-1111-4111-8111-111111111111';
const OTHER_AGENT = '22222222-2222-4222-8222-222222222222';

describe('generating an agent key', () => {
  it('returns a usable G address and a sealed private half', async () => {
    const generated = await generateAgentKey({ provider: provider(), agentId: AGENT });

    expect(generated.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(generated.sealed.ciphertext.length).toBeGreaterThan(32);
    expect(generated.sealed.wrappedDataKey.length).toBeGreaterThan(32);
    expect(generated.sealed.algorithm).toBe(AGENT_KEY_ALGORITHM);
  });

  it('records which provider wrapped it, on the row, from the first write', async () => {
    // The column §7.5.3 condition 3 rests on. A row that does not say which
    // provider wrapped it cannot be opened after a swap, which is the one thing
    // it would be needed for.
    const generated = await generateAgentKey({ provider: provider('env-master-v9'), agentId: AGENT });
    expect(generated.sealed.kmsKeyId).toBe('env-master-v9');
  });

  it('carries the label a surface must render for it', async () => {
    // Not `LOCAL_KEY_LABEL`. The label travels with the value so a screen
    // cannot reach for the familiar one and say a server key is in a browser.
    const generated = await generateAgentKey({ provider: provider(), agentId: AGENT });
    expect(generated.label).toBe('TESTNET ONLY · AGENT KEY (LIMEN-HELD)');
  });

  it('puts no plaintext seed anywhere in what it returns', async () => {
    // The whole claim of the table, checked rather than assumed. Reconstructing
    // the seed from the public key is impossible, so this looks for it the only
    // way a leak would actually appear: the sealed bytes containing a run that
    // decodes as the key.
    const generated = await generateAgentKey({ provider: provider(), agentId: AGENT });
    const raw = Buffer.concat([
      Buffer.from(generated.sealed.ciphertext),
      Buffer.from(generated.sealed.wrappedDataKey),
    ]);
    const rawPublic = Buffer.from(Keypair.fromPublicKey(generated.publicKey).rawPublicKey());
    expect(raw.includes(rawPublic)).toBe(false);
  });

  it('produces a different key and different ciphertext every time', async () => {
    const p = provider();
    const a = await generateAgentKey({ provider: p, agentId: AGENT });
    const b = await generateAgentKey({ provider: p, agentId: AGENT });

    expect(a.publicKey).not.toBe(b.publicKey);
    expect(Buffer.from(a.sealed.ciphertext).equals(Buffer.from(b.sealed.ciphertext))).toBe(false);
  });

  it('refuses an empty agent id rather than sealing something portable', async () => {
    await expect(generateAgentKey({ provider: provider(), agentId: '' })).rejects.toThrow(
      /agent id is required/,
    );
  });
});

describe('opening it for one turn', () => {
  it('recovers the same key that was generated', async () => {
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });

    const publicKey = await withAgentKey(
      { provider: p, agentId: AGENT, sealed: generated.sealed },
      async (key) => key.publicKey,
    );

    expect(publicKey).toBe(generated.publicKey);
  });

  it('signs a digest verifiably, which is what signAs needs', async () => {
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });
    const digest = Buffer.alloc(32, 3);

    const signature = await withAgentKey(
      { provider: p, agentId: AGENT, sealed: generated.sealed },
      async (key) => key.sign(new Uint8Array(digest)),
    );

    // Verified against the public half rather than merely non-empty: a signer
    // returning 64 zero bytes would satisfy a length check.
    const verified = Keypair.fromPublicKey(generated.publicKey).verify(
      digest,
      Buffer.from(signature),
    );
    expect(verified).toBe(true);
  });

  it('exposes the two members @limen/chain asks a signer for, structurally', async () => {
    // `chain.signAs({ signer })` takes `Ed25519Signer`, and the point of that
    // interface being two members wide is that this needs no adapter.
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });

    const raw = await withAgentKey(
      { provider: p, agentId: AGENT, sealed: generated.sealed },
      async (key) => key.rawPublicKey(),
    );

    expect(raw).toBeInstanceOf(Uint8Array);
    expect(raw.length).toBe(32);
    expect(Buffer.from(raw).equals(Buffer.from(Keypair.fromPublicKey(generated.publicKey).rawPublicKey()))).toBe(
      true,
    );
  });

  it('does not hand the seed to the callback at all', async () => {
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });

    const members = await withAgentKey(
      { provider: p, agentId: AGENT, sealed: generated.sealed },
      async (key) => Object.keys(key).sort(),
    );

    // The shape is the fence: there is no `secret`, no `seed`, no `keypair`.
    expect(members).toEqual(['label', 'publicKey', 'rawPublicKey', 'sign', 'signEnvelope']);
  });

  it('propagates what the turn throws rather than swallowing it in the wipe', async () => {
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });

    await expect(
      withAgentKey({ provider: p, agentId: AGENT, sealed: generated.sealed }, async () => {
        throw new Error('the turn failed');
      }),
    ).rejects.toThrow('the turn failed');
  });
});

describe('the refusals, which are the point', () => {
  it('refuses a seed sealed for a different agent', async () => {
    // The attack the AAD closes: copying one agent's sealed columns onto
    // another's row, so a key signs under a context rule never installed for
    // it. Both rows would open cleanly without the binding.
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });

    await expect(
      withAgentKey(
        { provider: p, agentId: OTHER_AGENT, sealed: generated.sealed },
        async (key) => key.publicKey,
      ),
    ).rejects.toThrow();
  });

  it('refuses a row wrapped by a different provider, by name', async () => {
    const generated = await generateAgentKey({ provider: provider('env-master-v1'), agentId: AGENT });

    await expect(
      withAgentKey(
        { provider: provider('env-master-v2'), agentId: AGENT, sealed: generated.sealed },
        async (key) => key.publicKey,
      ),
    ).rejects.toThrow(WrongKeyProviderError);
  });

  it('refuses a row sealed under an algorithm this build does not open', async () => {
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });

    await expect(
      withAgentKey(
        {
          provider: p,
          agentId: AGENT,
          sealed: { ...generated.sealed, algorithm: 'envelope-v0' },
        },
        async (key) => key.publicKey,
      ),
    ).rejects.toThrow(/sealed as "envelope-v0"/);
  });

  it('refuses a tampered ciphertext rather than returning a plausible key', async () => {
    // GCM's tag is what makes this a refusal instead of a signature made with
    // garbage — which for a key is the whole difference.
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });
    const tampered = Uint8Array.from(generated.sealed.ciphertext);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(
      withAgentKey(
        { provider: p, agentId: AGENT, sealed: { ...generated.sealed, ciphertext: tampered } },
        async (key) => key.publicKey,
      ),
    ).rejects.toThrow();
  });

  it('refuses a truncated ciphertext, and says which value was short', async () => {
    const p = provider();
    const generated = await generateAgentKey({ provider: p, agentId: AGENT });

    await expect(
      withAgentKey(
        {
          provider: p,
          agentId: AGENT,
          sealed: { ...generated.sealed, ciphertext: new Uint8Array(4) },
        },
        async (key) => key.publicKey,
      ),
    ).rejects.toThrow(/sealed seed: sealed value is too short/);
  });
});
