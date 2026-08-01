/**
 * PERMIT / DENY, unmissable at a glance.
 *
 * Colour is never the only signal — each verdict carries a glyph, a border,
 * and bold weight, so the table reads correctly in greyscale and for
 * colour-blind reviewers.
 */
export function Verdict({ permitted, size = 'md' }: { permitted: boolean; size?: 'md' | 'lg' }) {
  const scale = size === 'lg' ? 'px-3 py-1.5 text-[13px] min-w-[6.5rem]' : 'px-2.5 py-1 text-[11.5px] min-w-[5.75rem]';

  const tone = permitted
    ? 'border-permit-line bg-permit-dim text-permit'
    : 'border-deny-line bg-deny-dim text-deny';

  return (
    <span
      className={`inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-mono font-bold tracking-[0.14em] ${tone} ${scale}`}
      aria-label={permitted ? 'permitted' : 'denied'}
    >
      <span aria-hidden="true" className="text-[0.9em] leading-none">
        {permitted ? '✓' : '✕'}
      </span>
      {permitted ? 'PERMIT' : 'DENY'}
    </span>
  );
}
