import { formatLedgerSequence } from '@/lib/ledger';

/**
 * The ledger sequence, beside the network indicator.
 *
 * Mono and tabular, and with no animation on the digits at all — PLAN-V4 §8 is
 * explicit about that, and the reason is that a rolling or counting digit is an
 * effect applied to a value rather than a reading of it. The number changes when
 * the ledger closes. That *is* the motion.
 *
 * Renders nothing when the sequence is unknown. Not a dash, not a spinner, not
 * a zero: the top bar's job is to be right about which chain is being addressed,
 * and an ornament in the shape of a ledger number is the one thing it must never
 * carry. A person who sees no counter is seeing the truth — this browser does
 * not currently know what ledger the network is on.
 */
export function LedgerCounter({ sequence }: { sequence: number | null }) {
  const formatted = formatLedgerSequence(sequence);
  if (formatted === null) return null;

  return (
    <span
      className="hidden shrink-0 font-mono text-[10.5px] tracking-[0.08em] text-muted-dim tabular-nums sm:inline"
      title="The most recent ledger this browser read from the Soroban RPC endpoint. It stops updating if the endpoint stops answering."
    >
      <span className="sr-only">Latest ledger </span>
      {formatted}
    </span>
  );
}
