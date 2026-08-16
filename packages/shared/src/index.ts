/**
 * @limen/shared — the words this project states its limits in.
 *
 * Dependency-free, no network IO, no browser globals, no Next.js — the same
 * constraints `@limen/core` holds itself to, for a different reason. `core` is
 * dependency-free because a deterministic synthesizer must be checkable in
 * isolation. This package is dependency-free because of *where it runs*: the
 * redactor executes in a browser, in a Next.js route handler, in a Node test,
 * and from M1 onward in a long-lived worker process. A dependency here would be
 * a third party sitting between a value and the decision to remove it, in four
 * runtimes at once.
 *
 * ## Why these three modules moved out of `apps/web`
 *
 * All three were in `apps/web/src/lib/` and all three had stopped being about
 * the web app:
 *
 *   - **`status-labels.ts`** is a *closed set*, and the entire value of a closed
 *     set is that no surface can invent a member or drift its wording. `apps/web`
 *     is about to stop being the only surface — `apps/runtime` and
 *     `apps/telegram` both state limits to a person — and a closed set that
 *     lives inside one of the things it is supposed to constrain is closed by
 *     convention rather than by construction.
 *   - **`key-roles.ts`** names which key is acting. PLAN-V8 §3 adds a third key
 *     that acts from a server, so the module that answers "which key is about to
 *     sign" cannot be reachable only from the browser.
 *   - **`redact.ts`** already said of itself that it runs on both sides of the
 *     wire. From M1 there is a third side.
 *
 * This is a move, not a rewrite. The reasoning inside each module is the
 * reasoning it already carried, and the history of *why* each constant is
 * worded the way it is — which is most of what these files contain — travels
 * with it.
 *
 * ## Where the tests are, and why they did not move with the code
 *
 * `apps/web/test/report.test.ts` still owns the redactor's assertions, and
 * `apps/web/test/local-key-label.test.ts` and `caveats.test.ts` still own the
 * label set's. They test these modules *through the surface that renders them*,
 * which is the thing actually worth guarding: a redactor that is correct in
 * isolation and bypassed by the reporter is not a redactor, and a label that is
 * spelled correctly in a constant and paraphrased on a screen has already
 * failed. Moving the assertions here would have made them weaker and would have
 * made this a rewrite rather than a move.
 *
 * The tripwire in `local-key-label.test.ts` discovers its scan roots from the
 * filesystem rather than from a list, so this package came under every fence in
 * the repository on the day the directory existed, with nobody adding it.
 */

export * from './status-labels.js';
export * from './key-roles.js';
export * from './redact.js';
