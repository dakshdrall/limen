'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface Entry {
  /** Announced as the section's accessible name; never rendered. */
  label: string;
  content: ReactNode;
}

/**
 * The pinned sequence.
 *
 * Pinning and occlusion are CSS — see `.pin-stack` in `globals.css`. This
 * component contributes exactly two things: the enter state each entry
 * transitions into, and the sequence position shown bottom-right.
 *
 * Determining which entry is *active* needs care, because a pinned entry stays
 * geometrically on screen after it has been covered. An IntersectionObserver
 * reports intersection, not occlusion, so at any scroll position every entry
 * up to the topmost one is reported as intersecting. The root is narrowed to a
 * thin band across the middle of the viewport and the active entry is taken to
 * be the highest-indexed intersecting one — which is the one painted on top,
 * since z-index ascends with source order. An entry becomes active exactly as
 * it covers the middle of the viewport, i.e. as it takes over the screen.
 */
export function PinnedEntries({ entries }: { entries: Entry[] }) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState<boolean[]>(() => entries.map(() => false));
  const [active, setActive] = useState(0);
  const [sequenceVisible, setSequenceVisible] = useState(false);

  useEffect(() => {
    const stack = stackRef.current;
    if (stack === null) return;

    // Only now does the hidden start state apply. Server-rendered HTML, and a
    // page whose JavaScript never arrives, render every entry visible.
    stack.dataset.motion = 'on';

    const sections = Array.from(stack.querySelectorAll<HTMLElement>('[data-entry-index]'));
    const intersecting = new Set<number>();

    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const index = Number(record.target.getAttribute('data-entry-index'));
          if (record.isIntersecting) intersecting.add(index);
          else intersecting.delete(index);
        }
        if (intersecting.size === 0) return;

        const top = Math.max(...intersecting);
        setActive(top);
        // Everything at or below the active index counts as entered, so a
        // jump — an in-page anchor, a restored scroll position — does not
        // leave earlier entries blank when they are scrolled back to.
        setEntered((previous) =>
          previous[top] === true ? previous : previous.map((was, index) => was || index <= top),
        );
      },
      { rootMargin: '-49.5% 0px -49.5% 0px', threshold: 0 },
    );
    for (const section of sections) observer.observe(section);

    // The sequence position describes the stack, so it is only shown while the
    // stack is on screen.
    const stackObserver = new IntersectionObserver(
      (records) => setSequenceVisible(records[0]?.isIntersecting === true),
      { threshold: 0 },
    );
    stackObserver.observe(stack);

    return () => {
      observer.disconnect();
      stackObserver.disconnect();
    };
  }, [entries.length]);

  return (
    <>
      <div ref={stackRef} className="pin-stack">
        {entries.map((entry, index) => (
          <section
            key={entry.label}
            aria-label={entry.label}
            data-entry-index={index}
            data-entered={entered[index] === true ? 'true' : 'false'}
            style={{ zIndex: index + 1 }}
            className="pin-entry"
          >
            <div className="entry-inner flex flex-col gap-6 sm:gap-8">
              <span className="eyebrow-lead text-faint">
                {String(index + 1).padStart(2, '0')}
              </span>
              {entry.content}
            </div>
          </section>
        ))}
      </div>

      <div
        className="entry-progress"
        aria-hidden="true"
        data-visible={sequenceVisible ? 'true' : 'false'}
      >
        ENTRY {String(active + 1).padStart(2, '0')} / {String(entries.length).padStart(2, '0')}
      </div>
    </>
  );
}
