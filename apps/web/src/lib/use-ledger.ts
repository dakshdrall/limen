'use client';

import { useEffect, useState } from 'react';
import { RPC_URL } from '@/lib/chain-config';
import { ledgerFromHealth } from '@/lib/ledger';

/**
 * The one impure half of the motion: asking the network what ledger it is on.
 *
 * Everything that moves in this application reads from this hook, and this hook
 * reads from the network or reports nothing. There is no interpolation between
 * polls, no smoothing, and no fallback tick — PLAN-V4 §8 asks for readings
 * rather than effects, and the test of a reading is what it does when the thing
 * being read is unavailable. This returns `null`, and every consumer renders its
 * static state for `null`.
 *
 * ## Why a raw JSON-RPC call and not `rpc.Server`
 *
 * This is one method with no arguments and a number in its reply. Reaching it
 * through `@stellar/stellar-sdk` would pull the signing library into the root
 * layout — onto the landing page, the docs, and every read-only screen — which
 * is the exact cost the `./browser` subpath export and the dynamic `import()`
 * on the write screens exist to avoid. A `fetch` and a JSON body do not need a
 * transaction builder.
 *
 * ## Why `getHealth` and not `getLatestLedger`
 *
 * Measured on `soroban-testnet.stellar.org`, 2026-08-05, rather than assumed:
 *
 *     getLatestLedger   186,664 bytes
 *     getHealth             205 bytes
 *
 * `getLatestLedger` returns the full ledger header and metadata as XDR, and
 * this reading needs one integer out of it. At a poll every five seconds that
 * is roughly 2 MB a minute per open tab, spent to render a seven-digit number.
 * `getHealth` carries `latestLedger` — the same sequence — in a reply nine
 * hundred times smaller, and it additionally says whether the endpoint
 * considers itself to be serving current data.
 *
 * The obviously-named method is the expensive one here, so this comment exists
 * to stop the next reader from tidying it back.
 *
 * `RPC_URL` is imported rather than re-derived. It is one endpoint, named in
 * `chain-config.ts` with the reasoning for why the browser's endpoint and the
 * server's are two different names, and a second `process.env` read here would
 * be a second place for the same fact to be wrong in.
 */

/**
 * Testnet closes a ledger about every five seconds, so this is roughly one poll
 * per close. Not synchronised to anything: a poll that happens to land twice in
 * one ledger reads the same sequence twice and nothing moves, which is the
 * correct behaviour and is what makes the readings idempotent.
 */
const POLL_MS = 5_000;

async function readLatestLedger(rpcUrl: string, signal: AbortSignal): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    signal,
  });

  if (!response.ok) throw new Error(`rpc responded ${response.status}`);

  // Parsed by `lib/ledger.ts`, which is pure and unit-tested against real
  // recorded replies. What is left in this module is scheduling and `fetch`.
  const sequence = ledgerFromHealth(await response.json());
  if (sequence === null) throw new Error('the endpoint returned no ledger sequence');

  return sequence;
}

/**
 * The current ledger sequence, or `null` when it is not known.
 *
 * `null` means exactly one thing — *this browser does not currently know what
 * ledger the network is on* — and it covers the first render, an unreachable
 * endpoint, and a malformed reply alike. Consumers do not need to tell those
 * apart, because the honest rendering of all three is the same: no motion.
 *
 * Two things stop the polling, per §8:
 *
 * - **A hidden tab.** Scheduling stops; the last real reading stays on screen
 *   and is not cleared, because it was true when it was read and a number that
 *   is not changing is not motion. Becoming visible polls again immediately.
 * - **An RPC failure.** The reading is cleared to `null` and the loop stops. It
 *   does not retry on a timer: a loop that keeps retrying a dead endpoint is
 *   how a "reading" quietly becomes a spinner. Returning to the tab retries,
 *   because that is a person asking rather than a timer pretending.
 */
export function useLedgerSequence(): number | null {
  const [sequence, setSequence] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const stopScheduling = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const tick = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await readLatestLedger(RPC_URL, controller.signal);
        if (cancelled) return;
        setSequence(next);
        stopScheduling();
        timer = setTimeout(() => void tick(), POLL_MS);
      } catch {
        if (cancelled) return;
        // Stops rather than faking it. No last-known value is kept: a counter
        // that goes on displaying a sequence after the endpoint stopped
        // answering is asserting something it cannot check.
        setSequence(null);
        stopScheduling();
      } finally {
        inFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) stopScheduling();
      else void tick();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void tick();

    return () => {
      cancelled = true;
      stopScheduling();
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return sequence;
}
