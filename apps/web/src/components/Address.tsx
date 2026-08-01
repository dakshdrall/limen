'use client';

import { truncateAddress } from '@/lib/format';

/**
 * Truncated for density, inspectable on demand. The full value is in the
 * `title` and is copied to the clipboard on click — a reviewer must never be
 * shown an address they cannot verify.
 */
export function Address({ value, className = '' }: { value: string; className?: string }) {
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
      }}
      className={`cursor-pointer font-mono text-foreground/90 underline decoration-dotted decoration-muted-dim underline-offset-4 hover:text-accent ${className}`}
    >
      {truncateAddress(value)}
    </button>
  );
}
