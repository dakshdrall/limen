/**
 * The one module in this repository that constructs a `KeyProvider`.
 *
 * §7.5.3 condition 3, and the mechanism the other two conditions rest on:
 * *swapping the provider is a module, not a refactor*. That sentence is only
 * true if there is one place to change. `test/single-construction-site.test.ts`
 * scans every workspace and fails if a second appears — including in packages
 * that do not exist yet, because it discovers its roots rather than listing
 * them.
 *
 * Everything else takes a `KeyProvider` as a parameter. A module that reaches
 * for one is a module that has an opinion about which one, which is the opinion
 * this file exists to hold on everyone's behalf.
 *
 * ## This is the only place `process.env` is read for a key
 *
 * `EnvMasterKeyProvider` takes its master key, its `NODE_ENV` and its network
 * as arguments rather than reading them. That is not ceremony: it is what lets
 * the production refusal be *tested* — a constructor that read `process.env`
 * directly could only be tested by mutating the environment of the test
 * process, which is exactly the kind of test that passes for the wrong reason
 * when run in a different order.
 *
 * So the environment is read here, once, at the boundary, and the fence is
 * enforced in a class that can be handed any combination of inputs.
 */

import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import { EnvMasterKeyProvider } from './env-master-key.js';
import type { KeyProvider } from './key-provider.js';

/**
 * The environment variable holding the master key.
 *
 * Deliberately not `NEXT_PUBLIC_`-prefixed, and named as a constant so the CI
 * bundle grep has something exact to look for — the same treatment
 * `LIMEN_ERROR_WEBHOOK` gets in `api/report/route.ts`, and for a value whose
 * disclosure is considerably worse.
 */
export const MASTER_KEY_ENV = 'LIMEN_MASTER_KEY';

/**
 * Builds the provider this deployment uses.
 *
 * When `KmsKeyProvider` is written, this function gains a branch and nothing
 * else in the repository changes. That is the whole claim, and the test beside
 * it is what keeps the claim true.
 */
export function resolveKeyProvider(env: NodeJS.ProcessEnv = process.env): KeyProvider {
  const masterKeyBase64 = env[MASTER_KEY_ENV] ?? '';
  if (masterKeyBase64.length === 0) {
    throw new Error(
      `${MASTER_KEY_ENV} is not set. The agent key cannot be wrapped without a master key, and a process that ` +
        'cannot wrap one should not start. See PLAN-V8 §7.5.3.',
    );
  }

  return new EnvMasterKeyProvider({
    masterKeyBase64,
    nodeEnv: env.NODE_ENV,
    // Level 1 of the mainnet gate is the type; this is the value that reaches
    // the fence. `@limen/chain`'s union has one member, so the only passphrase
    // this repository can name is testnet's — an operator setting something
    // else in the environment is precisely the case the refusal is for.
    networkPassphrase: env.LIMEN_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE,
  });
}
