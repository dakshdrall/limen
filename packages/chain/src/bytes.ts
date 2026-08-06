/**
 * Bytes, without `Buffer`.
 *
 * There is no `Buffer` global in a browser bundle. Next.js does not polyfill
 * one, and adding a polyfill so that this package's write path could keep using
 * `Buffer` would mean shipping a Node compatibility shim to every visitor in
 * order to spare four call sites — so the call sites moved instead.
 *
 * The Stellar SDK is a different case and is deliberately not treated the same
 * way. Its browser build carries its own bundled `Buffer` and never reaches for
 * a global one, which is why `test/browser-bundle.test.ts` can run these
 * modules against that build with `globalThis.Buffer` deleted. Its *type*
 * declarations still say `Buffer`, because the library was written for Node
 * first; `scvBytes` below is the one place that discrepancy is absorbed, with
 * the runtime behaviour pinned by that same test rather than assumed.
 */

import { hash, xdr } from '@stellar/stellar-sdk';

/**
 * `xdr.ScVal.scvBytes` for a `Uint8Array`.
 *
 * The SDK declares this parameter as `Buffer` and, at runtime, wants only
 * something the XDR writer can read bytes out of — which a `Uint8Array` is.
 * A `Buffer` *is* a `Uint8Array`; the assertion here is the reverse direction,
 * and it is asserted in exactly one place so there is one line to point at if
 * the SDK ever stops accepting it.
 */
export function scvBytes(value: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(value as unknown as Buffer);
}

/** `sha256`, via the SDK's own hash, returning a plain `Uint8Array`. */
export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(hash(data as unknown as Buffer));
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Hex to bytes, refusing anything that is not exactly hex.
 *
 * `parseInt` would read `'0xzz'` as `NaN` and `'12ab_cd'` as `18`, and a wasm
 * hash silently truncated at the first unreadable character deploys a different
 * contract than the one that was named. Thrown, not coerced.
 */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`not a hex string: ${JSON.stringify(hex)}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
