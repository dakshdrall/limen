/**
 * The Stellar SDK as a browser gets it.
 *
 * `browser-bundle.test.ts` aliases `@stellar/stellar-sdk` to this module, so
 * the modules under test resolve to the SDK's *browser* build rather than its
 * Node build. That swap is the whole point: the Node build reaches for a global
 * `Buffer` at call time, so running anything against it with `globalThis.Buffer`
 * deleted would fail inside the SDK and prove nothing about this repository's
 * code. The browser build carries its own bundled `Buffer` and never reaches
 * for a global one — which is exactly the condition the client bundle runs in.
 *
 * The bundle is a UMD file inside a package marked `"type": "module"`, so Node
 * loads it as ESM, `module` and `exports` are undefined, and its UMD header
 * falls through to the global branch and assigns `globalThis.StellarSdk`. Hence
 * the `require`-then-read-the-global shape below rather than a plain re-export.
 *
 * `node:module` here is test scaffolding and not part of any shipped graph.
 * `browser-path.test.ts` scans `src/` and the acceptance script, not this file.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The bundle expects a browser-ish global to hang itself off.
globalThis.self ??= globalThis;

// Not a package subpath import: `dist/` is not in the SDK's `exports` map.
require('../../node_modules/@stellar/stellar-sdk/dist/stellar-sdk.min.js');

const sdk = globalThis.StellarSdk;
if (sdk === undefined || sdk.xdr === undefined) {
  throw new Error(
    'the Stellar SDK browser bundle did not populate globalThis.StellarSdk; browser-bundle.test.ts would be testing nothing',
  );
}

export const {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  contract,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} = sdk;

export default sdk;
