'use client';

import { useState } from 'react';

/**
 * The one place this site asks for anything.
 *
 * Deliberately small, and deliberately last. The argument above it is the
 * product; this is the footer of it.
 *
 * The qualifier is optional and the handle is optional, because a form that
 * demands to know what you are building before it will take your address is a
 * form that has decided its own convenience matters more than the reader's. The
 * server treats all three the same way — see `api/waitlist/route.ts`, which
 * writes the address to a store and nowhere else.
 *
 * Submission state is the whole of the component's logic, and it renders three
 * outcomes rather than two: idle, the error the server actually returned, and
 * done. A form that reports success optimistically is a form that will one day
 * tell somebody they are on a list they are not on.
 */

const QUALIFIERS = [
  { value: '', label: 'Not saying' },
  { value: 'agent', label: 'Building an agent' },
  { value: 'wallet', label: 'Building a wallet' },
  { value: 'protocol', label: 'Building a protocol' },
  { value: 'looking', label: 'Just looking' },
] as const;

export function WaitlistForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState('sending');
    setError(null);

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          qualifier: form.get('qualifier'),
          handle: form.get('handle'),
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (response.ok && body.ok === true) {
        setState('done');
        return;
      }
      // The server's own wording, not a generic failure. It knows why.
      setError(body.error ?? 'That did not go through. Try again.');
      setState('idle');
    } catch {
      setError('That did not go through. Check your connection and try again.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <div className="panel measure-scene" data-tone="permitted">
        <p className="text-[14px] text-foreground">
          Recorded. You will hear from us when there is something worth the message.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 measure-scene">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="waitlist-email">
          Email address
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="field"
        />
        <button
          type="submit"
          className="btn"
          data-variant="primary"
          data-register="scene"
          disabled={state === 'sending'}
        >
          {state === 'sending' ? 'Sending…' : 'Join the waitlist'}
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="waitlist-qualifier">
          What you are building
        </label>
        <select id="waitlist-qualifier" name="qualifier" className="field" defaultValue="">
          {QUALIFIERS.map(({ value, label }) => (
            <option key={label} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="waitlist-handle">
          Handle, optional
        </label>
        <input
          id="waitlist-handle"
          name="handle"
          type="text"
          placeholder="handle (optional)"
          className="field"
        />
      </div>

      {error === null ? null : (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      )}

      <p className="text-[12.5px] leading-relaxed text-muted-dim">
        The address goes to a store and nowhere else. No analytics, no third party, no list you have
        to leave.
      </p>
    </form>
  );
}
