'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The cap demonstration: two bars against the line that separated them.
 *
 * Everything it renders is passed in, already read from the recording and
 * already formatted, because this component is a client component and the
 * recording is a server-side import — and because the one thing it must never
 * do is compute a proportion. The widths are in `landing.css`, derived there
 * from the same stroop integers, and the labels are derived here from the same
 * ones again in `page.tsx`. This file only decides *when* the bars are drawn.
 *
 * ## Once, and then it holds
 *
 * The observer unobserves on the first intersection, so the bars travel exactly
 * once and stay where they land. A drawing that re-runs whenever the reader
 * scrolls past it is an animation; this is a measurement being taken, and a
 * measurement that keeps retaking itself invites the reader to watch the motion
 * instead of reading the result.
 *
 * `visible` is added rather than removed, and the CSS gives `.fill` a width of
 * zero until it arrives. That means a reader with no `IntersectionObserver`
 * would see two empty bars — so the fallback below sets `visible` immediately
 * in that case. Under `prefers-reduced-motion` the class is still added and the
 * transition is removed in CSS, so the bars are simply already drawn. Neither
 * path hides anything; both end at the same picture.
 */
export function CapTrack({
  capLabel,
  rows,
}: {
  capLabel: string;
  rows: {
    amount: string;
    verdict: string;
    refused: boolean;
    hash: string;
    hashLabel: string;
    href: string;
    error?: { code: string; rest: string };
  }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`track${visible ? ' visible' : ''}`}>
      <div className="capline">
        <span>{capLabel}</span>
      </div>

      {rows.map((row) => (
        <div className="row" key={row.hash}>
          <div className="bar">
            <div className={`fill ${row.refused ? 'refused' : 'settled'}`} />
          </div>
          <div className="meta">
            <span className="amount">{row.amount}</span>
            <span className={`verdict${row.refused ? ' no' : ''}`}>{row.verdict}</span>
            <a href={row.href} title={row.hash} target="_blank" rel="noreferrer">
              tx {row.hashLabel}
            </a>
          </div>
          {row.error !== undefined && (
            <p className="err">
              <b>{row.error.code}</b>
              {row.error.rest}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
