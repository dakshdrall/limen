'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Qualifier values, mirrored by the same list in the route handler. The wire
 * value is a stable token; the label is display only, so rewording the label
 * never changes what is stored.
 */
export const QUALIFIERS = [
  { value: 'agent', label: 'an agent' },
  { value: 'wallet', label: 'a wallet' },
  { value: 'protocol', label: 'a protocol' },
  { value: 'looking', label: 'just looking' },
] as const;

/**
 * Deliberately loose. The server applies the same shape; neither side is
 * trying to decide whether an address is deliverable, only to reject input
 * that is obviously not an address.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Whether the dialog is open *in the top layer*, which is the only state that
 * carries focus containment and an inert background.
 *
 * `:modal` is unsupported in engines older than the dialog behaviour this
 * component depends on, and `matches()` throws on a selector it cannot parse.
 * There, treat an open dialog as modal: reopening it on every effect run would
 * be worse than trusting the one `showModal()` call that opened it.
 */
function isModal(dialog: HTMLDialogElement): boolean {
  try {
    return dialog.matches(':modal');
  } catch {
    return dialog.open;
  }
}

/**
 * Native `<dialog>`, opened with `showModal()`.
 *
 * That gives focus containment, Escape-to-close, an inert background, and
 * focus restored to the trigger on close as browser behaviour — all of which a
 * hand-rolled trap has to reimplement and usually gets partly wrong. The only
 * additions here are closing on a backdrop click and keeping React state in
 * sync with the dialog's own close paths.
 */
export function WaitlistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Sync the dialog element — an external system — with React's idea of
  // whether it is open. Submission state is not reset here: the caller remounts
  // this component on each open, so a reopened modal starts fresh by
  // construction rather than by an effect racing the render that opened it.
  //
  // The state that matters is "open as a modal", not "open". `dialog.open` is
  // true for both, so guarding on it alone means a dialog that has ended up
  // open non-modally — via the `open` attribute, which puts it in normal flow
  // with no focus containment, no Escape, and no inert background — never gets
  // `showModal()` called on it, and stays that way. Reconciled by closing it
  // first and reopening it properly.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (isModal(dialog)) return;
    // `showModal()` throws InvalidStateError on an already-open dialog, so a
    // non-modal one has to be closed before it can be reopened in the top
    // layer.
    if (dialog.open) dialog.close();
    dialog.showModal();
  }, [open]);

  // On success the form is replaced, so focus has to be moved deliberately or
  // it lands back on the dialog with nothing announced.
  useEffect(() => {
    if (status === 'done') confirmationRef.current?.focus();
  }, [status]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    const email = String(data.get('email') ?? '').trim();
    const qualifier = String(data.get('qualifier') ?? '');
    const handle = String(data.get('handle') ?? '').trim();

    if (!EMAIL.test(email)) {
      setError('That does not look like an email address.');
      return;
    }

    setStatus('submitting');
    setError(null);
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, qualifier, handle: handle.length > 0 ? handle : null }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok !== true) {
        setError(payload.error ?? 'Could not record that. Try again.');
        setStatus('idle');
        return;
      }
      setStatus('done');
    } catch {
      setError('Could not reach the server. Try again.');
      setStatus('idle');
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape. Prevented and routed through state so the dialog has exactly
        // one close path.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex flex-col gap-5 px-6 py-6">
        <div className="flex items-start justify-between gap-6">
          <h2 id={titleId} className="text-[15px] font-semibold text-foreground">
            {status === 'done' ? 'On the list' : 'Waitlist'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 cursor-pointer rounded-[3px] px-2 py-1 text-[13px] text-muted-dim transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {status === 'done' ? (
          <div ref={confirmationRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
            <p className="text-[13.5px] leading-relaxed text-muted">
              Recorded. You will hear from us when live ingest and smart-account install land — not
              before.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="self-start cursor-pointer rounded-[4px] border border-border-bright px-3.5 py-2 text-[13px] font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="waitlist-email" className="col-head text-muted-dim">
                email
              </label>
              <input
                id="waitlist-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                placeholder="you@example.com"
                className="field"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="waitlist-qualifier" className="col-head text-muted-dim">
                I&rsquo;m building
              </label>
              <select id="waitlist-qualifier" name="qualifier" defaultValue="agent" className="field">
                {QUALIFIERS.map((qualifier) => (
                  <option key={qualifier.value} value={qualifier.value}>
                    {qualifier.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="waitlist-handle" className="col-head text-muted-dim">
                x or telegram <span className="normal-case tracking-normal text-faint">optional</span>
              </label>
              <input
                id="waitlist-handle"
                name="handle"
                type="text"
                maxLength={64}
                placeholder="@handle"
                className="field"
              />
            </div>

            {error !== null && (
              <p role="alert" className="text-[12.5px] text-deny">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="cursor-pointer rounded-[4px] border border-accent bg-accent-dim px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:border-border-default disabled:bg-transparent disabled:text-faint"
            >
              {status === 'submitting' ? 'Submitting…' : 'Join'}
            </button>

            <p className="text-[12px] leading-relaxed text-muted-dim">
              Stored to announce the two releases below. Not sold, not shared, no other mail.
            </p>
          </form>
        )}
      </div>
    </dialog>
  );
}
