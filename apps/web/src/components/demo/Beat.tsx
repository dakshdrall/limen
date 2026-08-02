'use client';

import type { ReactNode } from 'react';

export type BeatKind = 'on-chain' | 'computed';

/**
 * One beat of the walkthrough.
 *
 * The badge is not decoration. A reviewer must be able to tell, at every step,
 * whether what just happened touched a chain or ran in their browser — and the
 * two must never blur, because the difference between "this was enforced" and
 * "this was evaluated" is the difference between what Limen proves today and
 * what it claims for V2.
 */
export function Beat({
  index,
  title,
  kind,
  blurb,
  reached,
  busy,
  error,
  isRefusal,
  children,
}: {
  index: number;
  title: string;
  kind: BeatKind;
  blurb: string;
  reached: boolean;
  busy: boolean;
  error?: { code: string; message: string; detail?: string };
  isRefusal: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={`flex flex-col gap-4 rounded-[6px] border p-5 transition-colors sm:p-6 ${
        reached ? 'border-border-default bg-surface' : 'border-border-subtle bg-surface/40'
      }`}
      aria-current={busy ? 'step' : undefined}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span className={`eyebrow ${reached ? 'text-accent' : 'text-faint'}`}>
            {String(index).padStart(2, '0')}
          </span>
          <h3
            className={`text-[17px] leading-tight font-semibold tracking-[-0.01em] ${
              reached ? 'text-foreground' : 'text-muted-dim'
            }`}
          >
            {title}
          </h3>
          <KindBadge kind={kind} />
        </div>
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-muted">{blurb}</p>
      </header>

      {reached && (
        <>
          {error !== undefined && (
            <div
              role="alert"
              className={`flex flex-col gap-1.5 rounded-[5px] border px-4 py-3 ${
                isRefusal ? 'border-deny-line bg-deny-dim/40' : 'border-border-bright bg-surface-raised'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className={`col-head ${isRefusal ? 'text-deny' : 'text-muted'}`}>
                  {isRefusal ? 'REFUSED' : 'COULD NOT LOOK'}
                </span>
                <span className="value text-muted-dim">{error.code}</span>
              </div>
              <p className="max-w-[80ch] text-[13px] leading-relaxed text-foreground">
                {error.message}
              </p>
              {error.detail !== undefined && error.detail.length > 0 && (
                <p className="value max-w-[80ch] break-words text-[12px] text-faint">{error.detail}</p>
              )}
            </div>
          )}
          {children}
        </>
      )}
    </li>
  );
}

function KindBadge({ kind }: { kind: BeatKind }) {
  const onChain = kind === 'on-chain';
  return (
    <span
      className={`col-head rounded-[3px] border px-2 py-0.5 ${
        onChain
          ? 'border-permit-line bg-permit-dim text-permit'
          : 'border-border-bright bg-surface-raised text-muted-dim'
      }`}
      title={
        onChain
          ? 'This step reads from or writes to Stellar testnet.'
          : 'This step runs in your browser. Nothing is submitted or enforced on-chain.'
      }
    >
      {onChain ? 'on-chain' : 'computed locally'}
    </span>
  );
}
