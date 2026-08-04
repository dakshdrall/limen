'use client';

import { useState } from 'react';
import { WaitlistModal } from './WaitlistModal';

/**
 * The waitlist trigger, and the only interactive thing on the landing page.
 *
 * It exists as its own component so that `/` stays a server component. The
 * previous landing was a client component end to end, because one button in its
 * header owned the modal's state — which meant six sections of static prose, a
 * table of recorded transactions and every status label shipped to the browser
 * as JavaScript to render a page that never changes.
 *
 * `opened` counts openings rather than tracking a boolean alone: it keys the
 * modal, so each open mounts a fresh one and no previous confirmation or error
 * survives into the next.
 */
export function WaitlistButton({
  variant = 'primary',
  children = 'Join the waitlist',
}: {
  variant?: 'primary' | 'secondary';
  children?: React.ReactNode;
}) {
  const [waitlist, setWaitlist] = useState({ open: false, opened: 0 });

  return (
    <>
      <button
        type="button"
        onClick={() => setWaitlist((previous) => ({ open: true, opened: previous.opened + 1 }))}
        className="btn"
        data-variant={variant}
      >
        {children}
      </button>

      <WaitlistModal
        key={waitlist.opened}
        open={waitlist.open}
        onClose={() => setWaitlist((previous) => ({ ...previous, open: false }))}
      />
    </>
  );
}
