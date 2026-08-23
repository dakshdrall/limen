/**
 * The runtime's handle on the key provider. One per process, resolved lazily.
 *
 * The twin of `apps/web/src/lib/key-provider.ts`, and it constructs nothing for
 * the same reason: `resolveKeyProvider` is the only function in this repository
 * permitted to build a `KeyProvider`, and
 * `packages/custody/test/single-construction-site.test.ts` scans every
 * workspace — this one included, on the day it appeared — to keep that true.
 *
 * ## Resolved at startup here, unlike in the web app
 *
 * `apps/web` resolves lazily because most of its routes never touch a key, and
 * a missing master key should present as *deployment unavailable* rather than
 * as the whole site being down. The runtime is the opposite: **every** turn it
 * runs may need to sign, so a process that cannot open a key is a process with
 * nothing to do. `index.ts` calls this during startup so the failure is a
 * refusal to boot with the variable named, rather than a turn that is accepted,
 * queued, and dies at the moment it would have paid someone.
 */

import { resolveKeyProvider, type KeyProvider } from '@limen/custody';

let cached: KeyProvider | undefined;

export function keyProvider(): KeyProvider {
  cached ??= resolveKeyProvider();
  return cached;
}
