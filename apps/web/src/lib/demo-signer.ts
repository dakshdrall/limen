/**
 * The demo account's signer. The ONLY code in this repository that signs a
 * transaction, and the only one that can move any funds at all.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FENCE                                                                │
 * │                                                                          │
 * │ 1. `import 'server-only'` — importing this from a Client Component is a  │
 * │    build error, not a runtime one.                                       │
 * │ 2. Testnet is asserted by a hard `throw`, not by a config flag, not by a │
 * │    default, and not by a warning. There is no value of any environment   │
 * │    variable that produces a mainnet signer from this module.             │
 * │ 3. It signs only a transaction it built itself, from the fixed template  │
 * │    below. There is no "sign this XDR" entry point, and no input from     │
 * │    the browser reaches the builder — `performDemoTransfer` takes no      │
 * │    arguments. A caller cannot choose the destination, the asset, or the  │
 * │    amount.                                                               │
 * │ 4. `SIGNER_SENTINEL` exists so CI can prove this module is absent from   │
 * │    the client bundle. See `.github/workflows/ci.yml`.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The demo account is disposable and holds trivial funds; compromise is
 * uninteresting by design. The README says so under its own heading, next to
 * the amended claim about what code paths in this repo can move funds.
 */

import 'server-only';

import {
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';

/**
 * A fixed, unique string that appears nowhere else in the repository. CI greps
 * the server bundle for it (proving the check can match) and then the client
 * bundle (proving this module did not reach the browser). Do not remove, and do
 * not reuse this value anywhere else.
 */
export const SIGNER_SENTINEL = 'limen-demo-signer-8f2a41c6-server-only';

/** 0.1 XLM in stroops. Fixed: no caller chooses this. */
const DEMO_AMOUNT_STROOPS = 1_000_000n;

const BASE_FEE = '1000000';

export type DemoUnavailableReason =
  | 'no_secret'
  | 'no_destination'
  | 'no_rpc';

export class DemoSignerError extends Error {
  readonly reason: DemoUnavailableReason | 'submit_failed';

  constructor(reason: DemoUnavailableReason | 'submit_failed', message: string) {
    super(message);
    this.name = 'DemoSignerError';
    this.reason = reason;
  }
}

/**
 * Asserts testnet, loudly.
 *
 * Deliberately not a boolean check the caller can ignore, and deliberately not
 * parameterised by anything an operator can set to a different network. The
 * only passphrase this module will build against is Stellar's testnet.
 */
export function assertTestnet(passphrase: string): void {
  if (passphrase !== Networks.TESTNET) {
    throw new Error(
      `demo signer refuses a non-testnet network: ${passphrase}. This module signs on testnet only, by construction.`,
    );
  }
}

interface DemoConfig {
  keypair: Keypair;
  destination: string;
  rpcUrl: string;
}

/**
 * Reads the demo account's configuration. The secret never leaves this module:
 * it is not returned, not logged, and not included in any error message — the
 * same discipline the waitlist route applies to email addresses.
 */
function readConfig(): DemoConfig {
  const secret = process.env.LIMEN_DEMO_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new DemoSignerError('no_secret', 'no demo account is configured for this deployment');
  }

  const destination = process.env.LIMEN_DEMO_DESTINATION;
  if (destination === undefined || destination.length === 0) {
    throw new DemoSignerError(
      'no_destination',
      'no demo destination account is configured for this deployment',
    );
  }

  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new DemoSignerError('no_rpc', 'no Soroban RPC endpoint is configured for this deployment');
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secret);
  } catch {
    // Note the absence of the secret in this message.
    throw new DemoSignerError('no_secret', 'the configured demo account secret is not a valid seed');
  }

  return { keypair, destination, rpcUrl };
}

/** Whether beat 1 can run at all, without disclosing anything about the account. */
export function demoSignerStatus(): { available: true } | { available: false; reason: DemoUnavailableReason } {
  try {
    readConfig();
    return { available: true };
  } catch (error) {
    if (error instanceof DemoSignerError && error.reason !== 'submit_failed') {
      return { available: false, reason: error.reason };
    }
    return { available: false, reason: 'no_secret' };
  }
}

/**
 * Serializes submissions.
 *
 * [V2-D2] One shared demo account means one sequence number. Two reviewers
 * pressing beat 1 at the same moment would otherwise race and one would get
 * `tx_bad_seq`. This chain is process-local, so it does not compose across
 * instances — the rate limit in front of the route is what keeps the window
 * small enough for that to be acceptable. Documented in the README rather than
 * pretended away.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  // Keep the chain alive regardless of outcome; a rejection must not poison it.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface DemoTransferResult {
  hash: string;
  /** The contract that was invoked — the native asset's SAC. */
  contractId: string;
  functionName: 'transfer';
  amount: string;
}

/**
 * Builds, signs, and submits the fixed demo transfer.
 *
 * Takes no arguments on purpose: there is no parameter through which a request
 * could influence what gets signed.
 *
 * The transfer is a Stellar Asset Contract invocation rather than a classic
 * payment operation. A classic payment emits no contract invocations, so the
 * extractor would correctly refuse it and beat 2 would fail on beat 1's own
 * output. Invoking the native SAC produces exactly the `invokeHostFunction` and
 * SEP-41 transfer event the rest of the pipeline reads.
 */
export function performDemoTransfer(): Promise<DemoTransferResult> {
  return serialize(async () => {
    const { keypair, destination, rpcUrl } = readConfig();

    const networkPassphrase = Networks.TESTNET;
    assertTestnet(networkPassphrase);

    const server = new rpc.Server(rpcUrl);
    const account = await server.getAccount(keypair.publicKey());

    const sac = Asset.native().contractId(networkPassphrase);

    const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(
        Operation.invokeContractFunction({
          contract: sac,
          function: 'transfer',
          args: [
            nativeToScVal(keypair.publicKey(), { type: 'address' }),
            nativeToScVal(destination, { type: 'address' }),
            nativeToScVal(DEMO_AMOUNT_STROOPS, { type: 'i128' }),
          ],
        }),
      )
      .setTimeout(60)
      .build();

    // Soroban requires simulation to establish the footprint and resource fees.
    const prepared = await server.prepareTransaction(built);

    // The only signature this repository ever produces.
    assertTestnet(prepared.networkPassphrase);
    prepared.sign(keypair);

    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      throw new DemoSignerError(
        'submit_failed',
        `the demo transaction was rejected on submission (${sent.errorResult?.result().switch().name ?? 'unknown reason'})`,
      );
    }

    const settled = await server.pollTransaction(sent.hash, { attempts: 15, sleepStrategy: () => 1_000 });
    if (settled.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new DemoSignerError(
        'submit_failed',
        `the demo transaction did not succeed on-chain (status ${settled.status}); a policy can only be derived from a flow that succeeded`,
      );
    }

    return {
      hash: sent.hash,
      contractId: sac,
      functionName: 'transfer',
      amount: DEMO_AMOUNT_STROOPS.toString(),
    };
  });
}
