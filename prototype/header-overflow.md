# The shared header pans the page sideways on a phone

Found on `landing-narrative-surface` while measuring the landing's candle tape,
which is a different bug in a different file. Nothing here is fixed on that
branch and nothing here is landing-specific: `SiteHeader` renders on `/`,
`/docs` and every `/app/*` screen, and this note exists so the branch that does
fix it starts from a measurement rather than from a screenshot.

Measured 2026-09-03, against a production build of this branch (`next build`
then `next start`) and against `limen.cash` as it is serving now.

## The measurement

`document.documentElement.scrollWidth` against `clientWidth`, which is the
figure `e2e/viewports.spec.ts` asserts on:

| viewport | `/` | `/docs` | `/app/accounts` | `/app/try` | `/landing` |
| --- | --- | --- | --- | --- | --- |
| 390 | 498 | 498 | 498 | 498 | 498 |
| 360 | 498 | 498 | 498 | 498 | 498 |
| 320 | 498 | 498 | 498 | 498 | 498 |

498 at every width and on every surface. That it does not move with the
viewport is the finding: this is a minimum-content width, not a layout that
degrades — the row cannot get any narrower than 498px, so every phone in
service pans by 108px at 390 and 178px at 320.

## The culprit

The header's right-hand cluster, `div.ml-auto.flex.shrink-0`, whose right edge
is at **x = 498** on all five routes at all three widths — the same number as
the document's scroll width, so it is the whole of the overflow and not the
worst of several contributors.

At 390 the cluster holds the two off-site glyph links (ending at x = 421) and
the `TESTNET` status label (421 → 498). The ledger counter is already hidden at
this width and is not part of it. Everything in the row — the brand, the five
section links, the cluster — is `shrink-0`, so nothing gives and the row's
min-content width simply exceeds the screen.

Two other elements measure wider than the viewport and are **not** at fault,
which is worth recording so nobody re-finds them: the refusal table on `/`
(x → 1113) sits in its own `overflow-x: auto` box, which is the designed
answer, and `.art-sill` on `/landing` (x → 523) is clipped by the
`overflow: hidden` its section carries. Neither reaches the document.

## It contradicts a guarantee this repo states in three places

- `globals.css`, at `.scroll-x`: *"body must never scroll sideways."*
- `globals.css`, at `.screen`: the grid technique exists specifically so a
  full-bleed band cannot make the document pan, and the comment names hiding it
  with `overflow-x` on the body as the worse habit because *"it stops the test
  being able to fail while leaving the page broken."*
- `e2e/viewports.spec.ts`: *"No page scrolls the body sideways at 1280, 1024,
  768, 390px"* — tagged `@ci`, so it gates every push through the
  *Check in a browser* step in `ci.yml`.

The test is not missing this. It is failing on it. Run against this branch:

```
npx playwright test --config playwright.ci.config.ts viewports -g "at 390px"
```

```
Error: / overflows the document by 108px at 390px — wide content belongs in
its own scroll-x box, never on the body
Expected: <= 0
Received:    108
```

It fails on the first route in the list, so the four other routes are untested
behind it — the 498 figures above were taken by hand for that reason. The open
question this note does not answer is how a red `@ci` gate came to be standing:
whether the job is failing unattended or has not run on the branch that
introduced it.

## It is live

`limen.cash`, measured the same day (ledger 4,486,571 → 4,486,577):

| | served HTML | after hydration |
| --- | --- | --- |
| scrollWidth at 390 | 498 | **790** |
| scrollWidth at 360 | 498 | **790** |

Production is worse than any local build, and the difference is the reason it
would be easy to under-count from a laptop. The deployed header mounts three
controls that an unconfigured local server never renders — `Connect wallet`,
`Passkey`, `Register` — and the cluster grows from 498 to 790 about a second
after first paint. At 360 that is a document more than twice the width of the
screen, and the growth happens under the reader's thumb rather than at load.

No fix here, by instruction. The finding is the whole of it.
