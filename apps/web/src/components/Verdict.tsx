/**
 * PERMIT / DENY, unmissable at a glance.
 *
 * Colour is never the only signal — the word itself carries the meaning, so the
 * table reads correctly in greyscale and for colour-blind reviewers.
 */
export function Verdict({ permitted }: { permitted: boolean }) {
  return permitted ? (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border border-permit/40 bg-permit-dim px-2.5 py-1 text-[13px] font-bold tracking-[0.12em] text-permit"
      aria-label="permitted"
    >
      <span aria-hidden="true">✓</span> PERMIT
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border border-deny/40 bg-deny-dim px-2.5 py-1 text-[13px] font-bold tracking-[0.12em] text-deny"
      aria-label="denied"
    >
      <span aria-hidden="true">✕</span> DENY
    </span>
  );
}
