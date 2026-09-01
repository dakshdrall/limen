'use client';

import { type ElementType, useEffect, useRef, useState } from 'react';

/**
 * A heading in grainy silver.
 *
 * The effect is three things stacked: a silver gradient clipped to the glyphs
 * by `background-clip: text`, an SVG filter that displaces those glyphs against
 * animated turbulence, and a second turbulence composited into them as grain.
 * All three live in `landing.css` and `landing/layout.tsx`. What is here is the
 * one part that has to be a component — deciding when the filter is allowed to
 * run.
 *
 * ## Why this observes at all
 *
 * An SVG filter with two animated `feTurbulence` primitives is re-rasterised
 * every frame, for the whole filter region, whether or not the element is on
 * screen. This page has nine of them. Left alone they animate continuously
 * through the entire scroll, including the eight nobody is looking at.
 *
 * So each heading watches itself and drops the filter when it leaves. The
 * prototype did this with one `querySelectorAll('.grain')` and a shared
 * observer; per-instance is the same behaviour without a component reaching
 * across the document to style elements it does not own — and it means a
 * heading added later is observed because it is a `SilverHeading`, rather than
 * because someone remembered to give it a class.
 *
 * `rootMargin` is the prototype's 120px: the filter is on slightly before the
 * heading arrives, so the grain is never seen switching on.
 *
 * ## The starting state is paused, deliberately
 *
 * `paused` is set in the initial render rather than in an effect. The server
 * and the first client render therefore agree — there is no hydration mismatch
 * — and, more usefully, no filter runs during the first paint of a page whose
 * headings are mostly below the fold. The observer removes it on the ones that
 * are actually visible, a frame later.
 *
 * Under `prefers-reduced-motion` no observer is created at all. The filter is
 * already gone: `landing.css` drops it from `.silver` under that query, so
 * there is nothing to pause and nothing to watch. The heading still renders in
 * silver, still reads identically, and simply does not move.
 */
export function SilverHeading({
  as: Tag = 'h2',
  lite = false,
  className = '',
  children,
  ...rest
}: {
  as?: ElementType;
  /** The cheaper of the two filters. Used everywhere except the two h1-scale lines. */
  lite?: boolean;
  className?: string;
  children: React.ReactNode;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // Both are reasons not to arm, and neither is a reason to hide anything.
    if (typeof IntersectionObserver === 'undefined') {
      setPaused(false);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setPaused(!entry.isIntersecting);
      },
      { rootMargin: '120px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`silver${lite ? ' lite' : ''}${paused ? ' paused' : ''}${
        className === '' ? '' : ` ${className}`
      }`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
