'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

/**
 * Content that arrives as the reader scrolls and leaves as they scroll back.
 *
 * The CSS half is `.reveal` in `globals.css`, and the contract between the two
 * is stated there in full. The part that matters here: **an unarmed `.reveal`
 * is fully visible.** This component is what arms it, and it is written so that
 * every way it can fail leaves the page readable.
 *
 * ## Three failure modes, and what each one renders
 *
 * **The script never runs** — slow connection, parse error, bundle stripped, a
 * crawler that does not execute JavaScript. Nothing sets `data-reveal`, so the
 * `.reveal` rule matches nothing and every scene is present at its final
 * position. This is why the hidden state lives on an attribute this component
 * sets rather than in the class itself: the naive implementation puts
 * `opacity: 0` in the stylesheet and ships a blank page to exactly the readers
 * least able to recover from one.
 *
 * **The reader prefers reduced motion** — `arm()` returns early and the
 * attribute is never set, so the page is identical to the no-JavaScript case:
 * everything present, nothing moving. The stylesheet neutralises the armed
 * state as well, which covers the reader who changes the setting mid-session
 * with the attribute already on the element.
 *
 * **`IntersectionObserver` is missing** — the guard below leaves the element
 * unarmed rather than hiding content it has no way to bring back. A reveal that
 * cannot observe is a reveal that must not hide.
 *
 * ## Why the first frame is computed rather than defaulted
 *
 * Arming on mount would set every element to `out`, including the ones already
 * on screen — so the hero would paint, blank, and fade back in on every load.
 * That flash is the usual tell of a scroll-reveal bolted on afterwards.
 *
 * So the first observer callback decides both directions: an element already
 * intersecting goes straight to `in` and never passes through `out`. Since `in`
 * is visually identical to unarmed, there is nothing to see. `IntersectionObserver`
 * invokes its callback once on `observe()` with the current state, so this costs
 * no extra measurement and no layout read of our own.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  from,
  index,
  className,
  /**
   * How much of the element must be showing before it counts as arrived.
   *
   * A tall scene never reaches a high ratio at a short viewport, so this is a
   * small fraction plus a negative bottom margin rather than something like
   * 0.5: the element starts arriving when its top edge is comfortably inside
   * the fold, which is what a reader perceives as "it came in as I scrolled".
   */
  amount = 0.08,
}: {
  children: ReactNode;
  as?: ElementType;
  /** Where the content travels from. Defaults to below, via the stylesheet. */
  from?: 'up' | 'down' | 'left' | 'right';
  /** Stagger position within a group. Multiplied by one step in CSS. */
  index?: number;
  className?: string;
  amount?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  /**
   * Whether this element is allowed to carry a `data-reveal` attribute at all.
   *
   * Held in state rather than written straight to the DOM so that React owns
   * the attribute and a re-render cannot drop it. It starts `false` on both the
   * server and the first client render, which is what keeps hydration matching
   * — the arming decision is made in an effect, after hydration, and never
   * during render.
   */
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<'in' | 'out'>('out');

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // A reveal that cannot observe must not hide. See the header.
    if (typeof IntersectionObserver === 'undefined') return;

    // Reduced motion renders the same page, still: present, no transition.
    // Checked here as well as in CSS so the attribute is normally never set.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Arming happens on the first callback, which fires synchronously
          // enough that an element already on screen goes straight to `in`.
          setArmed(true);
          setState(entry.isIntersecting ? 'in' : 'out');
        }
      },
      {
        threshold: amount,
        // Content leaves as the reader scrolls back, and arrives a little
        // before its top edge would otherwise qualify.
        rootMargin: '0px 0px -6% 0px',
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [amount]);

  return (
    <Tag
      ref={ref}
      className={className === undefined ? 'reveal' : `reveal ${className}`}
      data-reveal={armed ? state : undefined}
      data-from={from}
      style={index === undefined ? undefined : ({ '--reveal-index': index } as React.CSSProperties)}
    >
      {children}
    </Tag>
  );
}
