/**
 * Getting a transaction onto a ledger, and reporting honestly what happened
 * when it did not.
 *
 * A lift out of `scripts/testnet.mjs`, not a rewrite. That script had learned
 * three things the hard way, and each of them is here with the code rather than
 * in a comment on a file the next caller will not read:
 *
 *  1. **Simulate twice.** Recording-mode simulation never executes
 *     `__check_auth`, so its footprint omits the verifier and policy contracts
 *     and its budget omits their work. A transaction assembled from it dies with
 *     `resourceLimitExceeded` before the boundary is ever consulted — which
 *     reports the same operation result as a genuine refusal.
 *  2. **A failed simulation yields no footprint.** An attempt that is *supposed*
 *     to fail therefore cannot reach a ledger on its own, and an attempt with no
 *     hash is an assertion rather than evidence. `submitWithBorrowedFootprint`
 *     borrows one from the call that succeeds.
 *  3. **Read the error out of the diagnostic events.** Without that, every
 *     failure renders as `invokeHostFunctionTrapped`, which is also what running
 *     out of budget renders as.
 *
 * Nothing here reads an environment variable or touches a filesystem, and the
 * envelope signature arrives as a callback. That is what makes the same code
 * usable by a Node script holding a secret and by a browser holding a
 * `localStorage` keypair — and what leaves room for a wallet to sign the
 * envelope later without any of this changing.
 */

import {
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { assertTestnet } from './sign.js';
import type { SupportedPassphrase } from './network.js';

/** Signs the transaction envelope: a keypair, or a wallet, or anything else. */
export type EnvelopeSigner = (tx: Transaction) => Transaction | Promise<Transaction>;

/** Signs one smart-account auth entry. `signAs` in `sign.ts` returns one. */
export type AuthEntrySigner = (
  entry: xdr.SorobanAuthorizationEntry,
) => Promise<xdr.SorobanAuthorizationEntry>;

export interface SubmitOptions {
  rpcUrl: string;
  passphrase: SupportedPassphrase;
  /** The address paying the fee. Its signature comes from `signEnvelope`. */
  feeSource: string;
  signEnvelope: EnvelopeSigner;
  func: xdr.HostFunction;
  /** Omitted when the call needs no smart-account authorization. */
  signAuthEntry?: AuthEntrySigner;
  /** Names this submission in errors and in a caller's log. */
  label: string;
  fee?: string;
  /** How long to wait for inclusion, in polls of 2s. */
  maxPolls?: number;
}

export type SubmitResult =
  | {
      ok: false;
      label: string;
      /** Which of the two simulations failed, or the send itself. */
      stage: 'recording' | 'simulation' | 'submit';
      error: string;
      /** The contract error code parsed out of a simulation error, if any. */
      code: number | null;
    }
  | {
      ok: boolean;
      label: string;
      stage: 'ledger';
      hash: string;
      status: string;
      /** Contract error codes from the diagnostic events. Empty on success. */
      codes: number[];
      returnValue: xdr.ScVal | undefined;
      /** The operation result name, e.g. `invokeHostFunctionTrapped`. */
      opResult: string;
      /** The enforcing simulation's footprint, for a caller that must borrow it. */
      transactionData: xdr.SorobanTransactionData;
      /** The signed auth entries, so an attempt can reuse the same nonce shape. */
      signedAuth: xdr.SorobanAuthorizationEntry[];
    };

/** True when the submission reached a ledger, whatever it did there. */
export function reachedLedger(result: SubmitResult): result is Extract<SubmitResult, { stage: 'ledger' }> {
  return result.stage === 'ledger';
}

const DEFAULT_FEE = '2000000';

/**
 * Contract error codes out of a failed transaction's diagnostic events.
 *
 * Recursive because an error can be nested inside a vec or a map topic, and
 * tolerant of events it cannot decode: a diagnostic event that will not parse
 * is not an error this code can attribute, and guessing at one would be worse
 * than reporting none.
 */
export function contractErrorCodes(diagnosticEventsXdr: readonly xdr.DiagnosticEvent[] | undefined): number[] {
  const out: number[] = [];

  const scan = (value: xdr.ScVal | undefined): void => {
    if (value === undefined || typeof value.switch !== 'function') return;
    const kind = value.switch().name;
    if (kind === 'scvError') {
      const error = value.error();
      if (error.switch().name === 'sceContract') out.push(error.contractCode());
    } else if (kind === 'scvVec') {
      for (const inner of value.vec() ?? []) scan(inner);
    } else if (kind === 'scvMap') {
      for (const entry of value.map() ?? []) {
        scan(entry.key());
        scan(entry.val());
      }
    }
  };

  for (const event of diagnosticEventsXdr ?? []) {
    try {
      const body = event.event().body().v0();
      for (const topic of body.topics()) scan(topic);
      scan(body.data());
    } catch {
      // A diagnostic event we cannot read is not an error we can attribute.
    }
  }
  return [...new Set(out)];
}

/**
 * The diagnostic events on a transaction response, if it has any.
 *
 * `NOT_FOUND` carries none — there is no transaction to have diagnostics for —
 * so this returns `undefined` rather than pretending an empty list, which would
 * read downstream as "ran, and reported no error".
 */
function diagnosticEvents(
  result: rpc.Api.GetTransactionResponse,
): readonly xdr.DiagnosticEvent[] | undefined {
  return 'diagnosticEventsXdr' in result ? result.diagnosticEventsXdr : undefined;
}

/** The operation result name, or `unknown` rather than a thrown read error. */
export function opResultName(result: rpc.Api.GetTransactionResponse): string {
  const withResult = result as { resultXdr?: xdr.TransactionResult };
  try {
    return withResult.resultXdr!.result().results()[0]!.tr().invokeHostFunctionResult().switch().name;
  } catch {
    try {
      return withResult.resultXdr!.result().switch().name;
    } catch {
      return 'unknown';
    }
  }
}

/** The `Error(Contract, #N)` a simulation reports, as a number. */
export function simulationErrorCode(text: unknown): number | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(String(text ?? ''));
  return match === null ? null : Number(match[1]);
}

export async function waitForTransaction(
  server: rpc.Server,
  hash: string,
  maxPolls = 40,
): Promise<rpc.Api.GetTransactionResponse> {
  let result = await server.getTransaction(hash);
  for (let i = 0; i < maxPolls && result.status === 'NOT_FOUND'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = await server.getTransaction(hash);
  }
  return result;
}

function build(
  account: Awaited<ReturnType<rpc.Server['getAccount']>>,
  passphrase: SupportedPassphrase,
  fee: string,
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
): Transaction {
  return new TransactionBuilder(account, { fee, networkPassphrase: passphrase })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(180)
    .build();
}

/**
 * Simulate, sign the auth entries, simulate again, submit, wait.
 *
 * The second simulation is the one that matters and the one that is easy to
 * skip: it is what produces a footprint covering `__check_auth`, because it is
 * the only one that runs it.
 */
export async function submitAuthorized({
  rpcUrl,
  passphrase,
  feeSource,
  signEnvelope,
  func,
  signAuthEntry,
  label,
  fee = DEFAULT_FEE,
  maxPolls,
}: SubmitOptions): Promise<SubmitResult> {
  assertTestnet(passphrase);
  const server = new rpc.Server(rpcUrl);

  const recording = await server.simulateTransaction(
    build(await server.getAccount(feeSource), passphrase, fee, func, []),
  );
  if (rpc.Api.isSimulationError(recording)) {
    return { ok: false, label, stage: 'recording', error: recording.error, code: simulationErrorCode(recording.error) };
  }

  const signedAuth: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of recording.result?.auth ?? []) {
    signedAuth.push(signAuthEntry === undefined ? entry : await signAuthEntry(entry));
  }

  const tx = build(await server.getAccount(feeSource), passphrase, fee, func, signedAuth);

  const enforcing = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(enforcing)) {
    return { ok: false, label, stage: 'simulation', error: enforcing.error, code: simulationErrorCode(enforcing.error) };
  }

  const assembled = rpc.assembleTransaction(tx, enforcing).build();
  const sent = await server.sendTransaction(await signEnvelope(assembled));
  if (sent.status === 'ERROR') {
    return { ok: false, label, stage: 'submit', error: JSON.stringify(sent.errorResult), code: null };
  }

  const result = await waitForTransaction(server, sent.hash, maxPolls);
  return {
    ok: result.status === 'SUCCESS',
    label,
    stage: 'ledger',
    hash: sent.hash,
    status: result.status,
    codes: contractErrorCodes(diagnosticEvents(result)),
    returnValue: result.status === 'SUCCESS' ? result.returnValue : undefined,
    opResult: opResultName(result),
    transactionData: enforcing.transactionData.build(),
    signedAuth,
  };
}

export interface BorrowedFootprintOptions extends Omit<SubmitOptions, 'func'> {
  /** The call that is expected to fail. */
  func: xdr.HostFunction;
  /** A footprint from an enforcing simulation of a call that does not fail. */
  transactionData: xdr.SorobanTransactionData;
  /** The auth entry for the attempt, already signed. */
  auth: xdr.SorobanAuthorizationEntry[];
}

/**
 * Submit a call whose simulation fails, using a footprint borrowed from one
 * whose simulation does not.
 *
 * This is what makes a refusal checkable. Without it, the attempt that is meant
 * to be refused never reaches a ledger, has no hash, and appears on a page as
 * this repository's word for it. With it, the refusal is a transaction anyone
 * can look up — and the fee is spent to be told no, which is the point.
 *
 * The borrowed footprint has to come from a call that touches the same
 * contracts. In practice that is the permitted version of the same transfer
 * with one field changed, which is why the caller supplies it rather than this
 * function guessing.
 */
export async function submitWithBorrowedFootprint({
  rpcUrl,
  passphrase,
  feeSource,
  signEnvelope,
  func,
  transactionData,
  auth,
  label,
  fee = '5000000',
  maxPolls,
}: BorrowedFootprintOptions): Promise<SubmitResult> {
  assertTestnet(passphrase);
  const server = new rpc.Server(rpcUrl);

  const tx = new TransactionBuilder(await server.getAccount(feeSource), {
    fee,
    networkPassphrase: passphrase,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(180)
    .setSorobanData(transactionData)
    .build();

  const sent = await server.sendTransaction(await signEnvelope(tx));
  if (sent.status === 'ERROR') {
    return { ok: false, label, stage: 'submit', error: JSON.stringify(sent.errorResult), code: null };
  }

  const result = await waitForTransaction(server, sent.hash, maxPolls);
  return {
    ok: result.status === 'SUCCESS',
    label,
    stage: 'ledger',
    hash: sent.hash,
    status: result.status,
    codes: contractErrorCodes(diagnosticEvents(result)),
    returnValue: result.status === 'SUCCESS' ? result.returnValue : undefined,
    opResult: opResultName(result),
    transactionData,
    signedAuth: auth,
  };
}

/**
 * The footprint from an enforcing simulation, without submitting anything.
 *
 * The same two-simulation dance as `submitAuthorized`, stopped one step early:
 * the caller wants the footprint, not the transaction.
 *
 * It exists for the attempts that are *supposed* to fail. A failed simulation
 * yields no footprint, so an attempt that the boundary refuses cannot reach a
 * ledger on its own — and an attempt with no hash is this repository's word for
 * what would have happened rather than a transaction anyone can look up. The
 * footprint has to be borrowed from a call that touches the same contracts and
 * does not fail.
 *
 * The clearest case is the agent trying to revoke its own boundary: the owner's
 * revoke simulates cleanly, and its footprint is what lets the agent's refused
 * attempt be submitted, burn a fee, and be told no on a ledger.
 */
export async function enforcingFootprint({
  rpcUrl,
  passphrase,
  feeSource,
  func,
  signAuthEntry,
  fee = DEFAULT_FEE,
}: Pick<
  SubmitOptions,
  'rpcUrl' | 'passphrase' | 'feeSource' | 'func' | 'signAuthEntry' | 'fee'
>): Promise<xdr.SorobanTransactionData> {
  assertTestnet(passphrase);
  const server = new rpc.Server(rpcUrl);

  const auth: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of await recordAuthEntries({ rpcUrl, passphrase, feeSource, func, fee })) {
    auth.push(signAuthEntry === undefined ? entry : await signAuthEntry(entry));
  }

  const sim = await server.simulateTransaction(
    build(await server.getAccount(feeSource), passphrase, fee, func, auth),
  );
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`enforcing simulation failed: ${sim.error}`);
  }
  return sim.transactionData.build();
}

/**
 * A recording simulation on its own, for callers that need the auth entry
 * before they know what they will do with it.
 *
 * The over-limit attempt needs exactly this: the entry the permitted call would
 * produce, so it can change one argument and sign the result.
 */
export async function recordAuthEntries({
  rpcUrl,
  passphrase,
  feeSource,
  func,
  fee = DEFAULT_FEE,
}: Pick<SubmitOptions, 'rpcUrl' | 'passphrase' | 'feeSource' | 'func' | 'fee'>): Promise<
  xdr.SorobanAuthorizationEntry[]
> {
  assertTestnet(passphrase);
  const server = new rpc.Server(rpcUrl);
  const sim = await server.simulateTransaction(
    build(await server.getAccount(feeSource), passphrase, fee, func, []),
  );
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`recording simulation failed: ${sim.error}`);
  }
  return sim.result?.auth ?? [];
}
