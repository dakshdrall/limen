/**
 * The listener that would have caught the #418.
 *
 * Next runs this file in the browser after the document loads and **before**
 * React hydrates, which is the only window in which a hydration error can be
 * heard — a listener attached from a component's effect is attached after the
 * mismatch it was meant to catch has already been recovered from.
 *
 * ## What this catches that `app/error.tsx` structurally cannot
 *
 * A React hydration mismatch is a *recoverable* error. React notices the server
 * HTML and the client render disagree, throws away the server's markup for that
 * subtree, re-renders on the client, and carries on. Nothing throws past a
 * component, so no error boundary is entered and no page fails. React's default
 * `onRecoverableError` calls the platform's `reportError()`, which dispatches an
 * `error` event on `window` — and that event is the entire trace such a bug
 * leaves in a production browser.
 *
 * That is exactly what happened on `/app/accounts/new`: `passkeysAvailable()`
 * was read during render, the server sent one sentence and the client another,
 * and the screen looked correct afterwards because React had already fixed it
 * up. It shipped, it sat there, and it was found only because a listener happened
 * to be attached for an unrelated reason. See `lib/use-passkey.ts` for the fix
 * and `test/design-system.test.ts` for the rule that keeps it fixed.
 *
 * The other two things here are in the same category — real failures that no
 * route boundary is positioned to see:
 *
 *   - **An unhandled rejection.** Every chain read in this application is a
 *     promise. One that rejects with nothing awaiting it is a screen that
 *     silently stops updating.
 *   - **A throw in an event handler.** React explicitly does not route these to
 *     error boundaries. A button that does nothing on click is the result.
 *
 * ## What it does not do
 *
 * It does not swallow anything. Both listeners are passive: they read the event
 * and return, the default handling proceeds, and the console still says
 * everything it said before. Nothing about the page's behaviour changes with
 * this file present, which is the property that makes it safe to load before
 * hydration.
 *
 * It also does not run in a test browser's favour: `sendReport` posts to
 * `/api/report` on this origin, and that route drops a report on the floor with
 * a `console.error` when no webhook is configured. A local `next dev` and a
 * Playwright run therefore exercise the whole path and deliver to a log, which
 * is where a developer already is.
 */

import { sendReport, startNewPage } from '@/lib/report';

/**
 * `error` fires for two unrelated things and only one of them is ours.
 *
 * A failed `<img>` or `<script>` load dispatches `error` at the element and it
 * bubbles to `window` with `event.error` unset — a broken avatar is not an
 * application failure and reporting it as one is how a reporter earns its way
 * into being ignored. An exception, and anything raised through `reportError()`,
 * carries the thrown value on `event.error`.
 *
 * So the filter is on the payload rather than on the target: if there is a
 * thrown value, something threw.
 */
window.addEventListener('error', (event: ErrorEvent) => {
  if (event.error === undefined || event.error === null) return;
  sendReport('window', event.error);
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  sendReport('rejection', event.reason);
});

/**
 * Next calls this when a client-side navigation begins. It exists here only to
 * give the per-page report budget a new page — see `startNewPage`.
 *
 * It deliberately records nothing about the navigation. The URL is the field
 * this application has to be most careful with, `redactPath` is the thing that
 * makes it safe, and a breadcrumb trail of visited screens is precisely the
 * default-on collection the allowlist was chosen over.
 */
export function onRouterTransitionStart(): void {
  startNewPage();
}
