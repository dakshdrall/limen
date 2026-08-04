/**
 * PERMIT / DENY / REFUSED, unmissable at a glance.
 *
 * Colour is never the only signal — each verdict carries a glyph, a border,
 * and bold weight, so the table reads correctly in greyscale and for
 * colour-blind reviewers.
 *
 * The third state exists because two different things were being called the
 * same thing. `denied` is the network refusing an attempt that reached a
 * ledger: there is a transaction hash, fees were burned, and the refusal is
 * checkable by anyone. `refused-at-simulation` is the boundary refusing an
 * attempt that never left the client — still the contract's verdict, executed
 * by the host, but with nothing on chain to point at.
 *
 * Collapsing the second into the first would make a table look complete at the
 * cost of the one distinction that makes any of it credible. It is drawn in the
 * neutral ramp with a dashed border: visibly a refusal, visibly a weaker claim.
 *
 * `denied` deliberately does NOT assert where the verdict came from. Limen's
 * own evaluator produces DENY rows too, on `/` and in the simulator, and those
 * are not network refusals. Provenance is carried by the enclosing section —
 * every one of them says whether it is on-chain or computed locally — except on
 * the refusal screen, where rows of different provenance sit in one table and
 * the per-row state is the only thing keeping them apart.
 */

export type VerdictState = 'permitted' | 'denied' | 'refused-at-simulation';

const STATES = {
  permitted: {
    label: 'PERMIT',
    glyph: '✓',
    tone: 'border-permit-line bg-permit-dim text-permit',
    border: 'border-solid',
    aria: 'permitted',
  },
  denied: {
    label: 'DENY',
    glyph: '✕',
    tone: 'border-deny-line bg-deny-dim text-deny',
    border: 'border-solid',
    aria: 'denied',
  },
  'refused-at-simulation': {
    label: 'REFUSED',
    glyph: '⊘',
    tone: 'border-unproven-line bg-unproven-dim text-unproven',
    border: 'border-dashed',
    aria: 'refused at simulation; never reached a ledger',
  },
} as const satisfies Record<VerdictState, unknown>;

export function Verdict({ state, size = 'md' }: { state: VerdictState; size?: 'md' | 'lg' }) {
  const scale =
    size === 'lg'
      ? 'px-3 py-1.5 text-[13px] min-w-[7rem]'
      : 'px-2.5 py-1 text-[11.5px] min-w-[6.25rem]';

  const { label, glyph, tone, border, aria } = STATES[state];

  return (
    <span
      className={`inline-flex items-center justify-center gap-1.5 rounded-[2px] border font-mono font-semibold tracking-[0.14em] ${border} ${tone} ${scale}`}
      aria-label={aria}
    >
      <span aria-hidden="true" className="text-[0.9em] leading-none">
        {glyph}
      </span>
      {label}
    </span>
  );
}
