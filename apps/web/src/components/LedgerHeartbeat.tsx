import { heartbeatPhase } from '@/lib/ledger';

/**
 * The ledger heartbeat: the ruled ground's minor rule, one contrast step
 * brighter on alternate ledger closes.
 *
 * Drawn as a second layer over the ground rather than by changing the ground
 * itself, and that choice is load-bearing in two ways.
 *
 * **The static page is unchanged.** This layer is transparent at phase 0, so a
 * browser with no JavaScript, a failed RPC, or a first render before the first
 * poll all show exactly the ground `globals.css` has always drawn. The motion is
 * additive to a correct static state instead of being the thing that produces
 * it.
 *
 * **Only the minor rule moves.** The major rule is structure — it is where the
 * layout's columns land — and structure that breathes is decoration. This layer
 * carries the minor pitch only, so the reading rides on the texture and leaves
 * the drafting frame still.
 *
 * `aria-hidden`, and no `role`: it is a texture, not a status. The ledger
 * sequence is *announced* by the counter in the top bar, which is text.
 */
export function LedgerHeartbeat({ sequence }: { sequence: number | null }) {
  return <div className="ground-beat" data-phase={heartbeatPhase(sequence)} aria-hidden="true" />;
}
