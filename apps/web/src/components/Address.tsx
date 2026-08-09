'use client';

import { useEffect, useState } from 'react';
import { truncateAddress } from '@/lib/format';

/**
 * Truncated for density, inspectable on demand. The full value is in the
 * `title` and is copied to the clipboard on click — a reviewer must never be
 * shown an address they cannot verify.
 *
 * The copy affordance stays hidden until hover or focus so it does not add
 * visual noise to a dense table, but it is always reachable by keyboard.
 */
export function Address({
  value,
  className = '',
  tone = 'default',
}: {
  value: string;
  className?: string;
  /** `dim` is for addresses that are context rather than the subject of the row. */
  tone?: 'default' | 'dim';
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const base = tone === 'dim' ? 'text-muted-dim' : 'text-foreground/90';

  return (
    <button
      type="button"
      title={`${value}\n(click to copy)`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
      // `whitespace-nowrap`: a truncated address broken across two lines reads
      // as two values. It is already the shortest form of itself.
      //
      // `relative` is load-bearing and not a layout choice. The `sr-only` span
      // below is `position: absolute`, so without a positioned ancestor its
      // containing block is the initial one — the document — and it is
      // therefore NOT clipped by the `.scroll-x` wrapper the table sits in.
      // Every address in a wide table then contributed its own escaped span to
      // the document's scroll width, and two screens scrolled sideways by
      // several hundred pixels because of a label nobody can see. The table
      // itself was clipping perfectly, which is why this took a while to find.
      className={`group relative inline-flex cursor-pointer items-center gap-1.5 rounded-[3px] px-1 py-0.5 -mx-1 font-mono text-[12.5px] tracking-[-0.01em] whitespace-nowrap transition-colors hover:bg-surface-raised hover:text-accent ${
        copied ? 'text-permit' : base
      } ${className}`}
    >
      <span>{truncateAddress(value)}</span>
      <span
        aria-hidden="true"
        className={`text-[10px] leading-none transition-opacity ${
          copied ? 'text-permit opacity-100' : 'text-muted-dim opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
        }`}
      >
        {copied ? '✓' : '⧉'}
      </span>
      <span className="sr-only">{copied ? 'copied' : 'copy address'}</span>
    </button>
  );
}
