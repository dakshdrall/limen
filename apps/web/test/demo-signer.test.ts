/**
 * The fence, tested from the inside. CI tests it from the outside by grepping
 * the built bundles; these two checks are not redundant — one proves the module
 * refuses to build a mainnet signer, the other proves it never reaches a
 * browser.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  SIGNER_SENTINEL,
  assertTestnet,
  demoSignerStatus,
  performDemoTransfer,
} from '@/lib/demo-signer';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.LIMEN_DEMO_SECRET;
  delete process.env.LIMEN_DEMO_DESTINATION;
  delete process.env.SOROBAN_RPC_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('the testnet fence', () => {
  it('refuses every network passphrase that is not testnet', () => {
    // This is the same predicate `performDemoTransfer` calls before building
    // and again before signing. A regression that softened the throw into a
    // flag or a warning would have to change these lines to pass.
    expect(() => assertTestnet(Networks.PUBLIC)).toThrow(/refuses a non-testnet network/);
    expect(() => assertTestnet(Networks.FUTURENET)).toThrow(/refuses a non-testnet/);
    expect(() => assertTestnet('Some Other Passphrase')).toThrow(/refuses a non-testnet/);
    expect(() => assertTestnet('')).toThrow(/refuses a non-testnet/);
    expect(() => assertTestnet(Networks.TESTNET)).not.toThrow();
  });

  it('exposes a sentinel for the CI bundle check', () => {
    // If this value changes, the CI grep must change with it — otherwise the
    // check silently stops proving anything.
    expect(SIGNER_SENTINEL).toBe('limen-demo-signer-8f2a41c6-server-only');
  });
});

describe('configuration is required, and its absence is stated precisely', () => {
  it('reports no_secret when no demo account is configured', () => {
    expect(demoSignerStatus()).toEqual({ available: false, reason: 'no_secret' });
  });

  it('reports no_destination once a secret is present but no destination is', () => {
    process.env.LIMEN_DEMO_SECRET = Keypair.random().secret();
    expect(demoSignerStatus()).toEqual({ available: false, reason: 'no_destination' });
  });

  it('reports no_rpc once the account is configured but no endpoint is', () => {
    process.env.LIMEN_DEMO_SECRET = Keypair.random().secret();
    process.env.LIMEN_DEMO_DESTINATION = Keypair.random().publicKey();
    expect(demoSignerStatus()).toEqual({ available: false, reason: 'no_rpc' });
  });

  it('is available once all three are configured', () => {
    process.env.LIMEN_DEMO_SECRET = Keypair.random().secret();
    process.env.LIMEN_DEMO_DESTINATION = Keypair.random().publicKey();
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.example/';
    expect(demoSignerStatus()).toEqual({ available: true });
  });

  it('rejects a malformed secret without ever quoting it', async () => {
    process.env.LIMEN_DEMO_SECRET = 'SNOTAVALIDSEEDATALL';
    process.env.LIMEN_DEMO_DESTINATION = Keypair.random().publicKey();
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.example/';

    await expect(performDemoTransfer()).rejects.toThrow(/not a valid seed/);
    await expect(performDemoTransfer()).rejects.not.toThrow(/SNOTAVALIDSEEDATALL/);
  });
});

describe('the signer takes no input', () => {
  it('accepts no arguments, so no request can influence what is signed', () => {
    // A future signature change that added a destination or an amount parameter
    // would break this, which is the point.
    expect(performDemoTransfer.length).toBe(0);
  });
});
