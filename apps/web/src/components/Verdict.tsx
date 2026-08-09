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
 *
 * The fourth state is PLAN-V4 F3, and it exists for the same reason the third
 * does: two different things were about to be called the same thing. After a
 * rule is revoked, the call that used to be permitted fails
 * `ContextRuleNotFound#3000` — which is *not* in `BOUNDARY_REFUSAL_CODES`,
 * deliberately. "The boundary refused you" and "the boundary is gone" are
 * different claims, and rendering the second as the first would count a rule
 * that no longer exists as a rule that did its job. Drawn in the neutral ramp
 * with a dotted border: distinguished by treatment rather than by a new hue,
 * because a fourth colour would imply a fourth kind of verdict when what this
 * actually is is the absence of one.
 */

export type VerdictState = 'permitted' | 'denied' | 'refused-at-simulation' | 'rule-revoked';

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
  'rule-revoked': {
    label: 'NO RULE',
    glyph: '∅',
    tone: 'border-border-default bg-surface text-muted',
    border: 'border-dotted',
    aria: 'the context rule was revoked; there is no boundary left to permit or refuse this',
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
