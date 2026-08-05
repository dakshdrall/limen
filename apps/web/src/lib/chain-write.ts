/**
 * Loading the write path, and reporting what a submission did.
 *
 * ## Why the import is dynamic
 *
 * `@limen/chain/browser` pulls in the Stellar SDK, which is the largest thing
 * this application can load. The landing page, the docs, the simulator and the
 * read-only screens never sign anything and must not pay for it. So the SDK
 * arrives through `import()` at the moment a person does something that needs
 * it — not at module scope of a screen that merely offers a button.
 *
 * The promise is cached rather than the module: two screens loading at once get
 * one network request and one evaluation, and a failed load is retried by the
 * next caller instead of being cached as a permanent failure.
 *
 * ## Why `onLedger` and `failed` are different states
 *
 * This is the distinction the whole project is organised around, so it is in
 * the type rather than in a comment on a component.
 *
 * A transaction that never reached a ledger produced no evidence of anything.
 * It might have been a bad endpoint, an unfunded fee source, or a simulation
 * that ran out of budget. Rendering that as a refusal would be this repository
 * asserting a boundary held when nothing on chain says so — and
 * `submit.ts` exists in the shape it does precisely because an attempt with no
 * hash is an assertion rather than evidence.
 *
 * So `onLedger` carries a hash and `ok: false` is a real, checkable outcome:
 * the network ran the call and it failed there, with codes anyone can decode.
 * `failed` carries no hash and never claims one. Whether an `onLedger` failure
 * is a *boundary refusal* is a further question still, answered by
 * `isBoundaryRefusal` and `isRevokedRule` and never by this module.
 */

import { FRIENDBOT_URL } from '@limen/chain/network';

/** The write path's module type. Type-only, so importing it costs nothing. */
export type ChainBrowser = typeof import('@limen/chain/browser');

let loading: Promise<ChainBrowser> | null = null;

/**
 * The write path, loaded once per page.
 *
 * A rejected load clears the cache so the next attempt tries again. Caching a
 * rejection would turn one dropped chunk request into a screen that can never
 * sign until it is reloaded, with nothing on it explaining why.
 */
export function loadChain(): Promise<ChainBrowser> {
  loading ??= import('@limen/chain/browser').catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * What a submission did, in the two states that are actually different.
 *
 * `what` completes "…could not be sent" or names the step in a result line. It
 * is required for the same reason `Pending`'s is: a bare hash tells a reader
 * nothing about which of nine transactions they are looking at.
 */
export type WriteOutcome =
  | {
      status: 'onLedger';
      what: string;
      hash: string;
      /** The network ran it and it succeeded. `false` is a real result. */
      ok: boolean;
      /** Contract error codes from the diagnostic events. Empty on success. */
      codes: number[];
      /** e.g. `invokeHostFunctionTrapped`. Not an explanation on its own. */
      opResult: string;
      /** The RPC's own word for the result, e.g. `SUCCESS`, `FAILED`. */
      ledgerStatus: string;
    }
  | {
      status: 'failed';
      what: string;
      /** Which stage gave up: no ledger was reached, so there is no hash. */
      stage: 'recording' | 'simulation' | 'submit' | 'browser';
      message: string;
      /** A contract code parsed out of a simulation error, when there is one. */
      code: number | null;
    };

/**
 * A `SubmitResult` from `@limen/chain`, narrowed to what a screen renders.
 *
 * Structural rather than an import of `SubmitResult`, so this module stays free
 * of the SDK's types at runtime and at build time. The fields are the contract;
 * the chain package's tests are what keep it honest.
 */
export interface SubmitResultLike {
  stage: 'recording' | 'simulation' | 'submit' | 'ledger';
  ok?: boolean;
  hash?: string;
  status?: string;
  codes?: number[];
  opResult?: string;
  error?: string;
  code?: number | null;
}

export function toWriteOutcome(what: string, result: SubmitResultLike): WriteOutcome {
  if (result.stage === 'ledger') {
    return {
      status: 'onLedger',
      what,
      hash: result.hash ?? '',
      ok: result.ok === true,
      codes: result.codes ?? [],
      opResult: result.opResult ?? 'unknown',
      ledgerStatus: result.status ?? 'unknown',
    };
  }
  return {
    status: 'failed',
    what,
    stage: result.stage,
    message: result.error ?? 'the submission did not reach a ledger',
    code: result.code ?? null,
  };
}

/**
 * Fund a classic account from friendbot.
 *
 * Called from the page, per PLAN-V4 §6. Friendbot serves
 * `access-control-allow-origin: *`, so this works from a browser directly and
 * no Limen route stands in the middle of it. If that ever stops being true the
 * fallback is a thin `/api/fund` that forwards an address and nothing else —
 * but a route added before it is needed is a Limen server in the write path for
 * no reason.
 *
 * An already-funded account gets a 400 back. That is success for our purposes —
 * the account exists and has funds, which is all the caller wanted — so it is
 * reported as `already` rather than as an error a person has to interpret.
 */
export async function fundFromFriendbot(
  publicKey: string,
): Promise<{ ok: true; hash: string | null } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  } catch (error) {
    return {
      ok: false,
      message: `friendbot could not be reached from this browser: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const record = (body ?? {}) as { hash?: string; id?: string };
    // Funded, but the hash is what makes it checkable. `null` says "we did not
    // learn one" rather than inventing a placeholder that looks like evidence.
    return { ok: true, hash: record.hash ?? record.id ?? null };
  }

  const text = await response.text().catch(() => '');
  if (text.includes('createAccountAlreadyExist') || response.status === 400) {
    return { ok: true, hash: null };
  }
  return { ok: false, message: `friendbot refused this address (${response.status})` };
}
