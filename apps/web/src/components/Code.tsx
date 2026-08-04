/**
 * A block of code, transcribed from something that runs.
 *
 * One treatment, because there is now more than one page that shows code and
 * the two would otherwise disagree about the border, the size and how the
 * overflow behaves — the same drift step 11 spent itself removing from explorer
 * links and hashes. `scroll-x` rather than wrapping: a wrapped line of code
 * reads as two statements, and the body must never scroll sideways to
 * accommodate one.
 *
 * Nothing here highlights syntax. A highlighter is a second opinion about what
 * the code means, and at this size the useful signal is the shape of the block,
 * not a hue per token.
 */
export function Code({ children }: { children: string }) {
  return (
    <pre className="scroll-x value rounded-[5px] border border-border-default bg-surface p-4 text-[11.5px] leading-relaxed text-muted">
      {children}
    </pre>
  );
}
