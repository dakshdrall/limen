'use client';

import { type ElementType, useEffect, useRef } from 'react';

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
 * ## The class is toggled on the node, not held in state
 *
 * `paused` is rendered on the server and then driven by the observer through
 * the ref, rather than by `useState`. Two reasons, and the second is the real
 * one:
 *
 * It is presentational — nothing else on the page reads it, and it carries no
 * information a re-render would need to propagate. Holding it in state means
 * every heading re-renders each time it crosses the viewport edge, which on a
 * page with nine of them is a render storm produced entirely by scrolling.
 *
 * And it keeps the server and the first client render identical: the markup
 * ships with `paused`, so no filter runs during the first paint of a page whose
 * headings are mostly below the fold, and there is nothing for hydration to
 * disagree about. The observer removes the class a frame later on the headings
 * that are actually visible.
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

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // No observer: run the filter rather than leave every heading flat. The
    // effect is decoration, and the degraded case should be the page as drawn.
    if (typeof IntersectionObserver === 'undefined') {
      element.classList.remove('paused');
      return;
    }

    // Reduced motion: the filter is already gone from `.silver` in CSS, so
    // there is nothing to pause and nothing worth watching for.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.target.classList.toggle('paused', !entry.isIntersecting);
      },
      { rootMargin: '120px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`silver${lite ? ' lite' : ''} paused${className === '' ? '' : ` ${className}`}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
