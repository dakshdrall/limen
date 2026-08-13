# PLAN-V6 — the site Limen deserves

`apps/web` is being rebuilt from nothing. The engine is not.

## Status

**All six steps are committed on `v5-product` and pushed.** 425 tests pass across
24 files; `tsc`, lint, `evidence:check` and `mark:check` are all green, and the
build emits 21 routes. `git diff` against `packages/` is empty.

`shots:check` is no longer in that list because there are no shots. See the
first open item below, now closed.

The branch label under-describes its contents: this is V6 work on a branch named
for V5. That is deliberate for now. A rename, if wanted, comes after the rebuild
is green and as its own thing.

### Open, and deliberately not closed inside the rebuild

- ~~**The generated screenshots have no reader.**~~ **Closed. They are gone** —
  `public/shots`, `scripts/screenshots.mjs`, the three `shots*` scripts, and the
  two CI steps that existed to serve them.

  The design call went against them, and not narrowly. The V6 narrative argues in
  live markup and inline SVG, which is selectable, reaches a screen reader, and
  cannot drift; a PNG of the same thing is the worse copy on every axis and
  carries a check to keep it honest. They were also already stale — the proposal
  table conversion moved the widths inside them and `shots:check` compares
  sidecar text, so it stayed green over four pictures of tables that no longer
  looked like that. A check that cannot see its own subject go wrong is the
  argument against the artefact, not for it.

  **`assertNothingScrolls` moved into `e2e/viewports.spec.ts` first**, which was
  the condition on removing anything. It was the one thing in that script
  asserting a property of the application rather than of its own output: under
  `table-layout: fixed` a cell that cannot fit its contents paints them over the
  next column, and that is a defect on a live screen and not only in a
  photograph.

  It came out **wider than it went in**, and the difference matters. In the
  script it ran inside a shot's crop, and there were four crops — so it covered
  the tables in those four regions and no others. Neither the deny table (beat 4;
  the manifest photographed beats 3 and 5) nor the refusal table was ever under
  it. On the routes it covers both, and it found a column overlap on the account
  detail screen at 900px on its first run — the one screen no shot could ever
  have photographed, because it renders a live chain read. See `--col-policy` and
  the floor note in `RulesTable`.

  What did **not** survive is the scroll-box half of the old assertion, and
  deliberately. A `.scroll-x` that scrolls is the designed answer for a table
  wider than its column — at 900px the refusal table is 1088px in an 818px box —
  and it was only ever a fault in a picture, where it read as a silently cut
  column. That was a property of the artefact and it dies with it.
- ~~**`e2e/viewports.spec.ts` still expects the V5 landing's exhibit.**~~ **Closed.**
  The five `[data-exhibit]` cases were removed rather than re-pointed — `/app`
  stacks the permitted row above the table, so the two-panel edge-sharing claim
  has nothing left to assert. What replaced them measures the invariant that did
  survive: `RefusedTable`'s `w-max max-w-full` surface is its table's width and
  not its section's, confirmed failing at 1440 and 1280 before it was allowed to
  pass.

  Being off CI had hidden two further faults in the same file, neither of them
  the one recorded above. Its `ACCOUNT` and rule id were typed, and both were
  stale: that run revokes its own rule in its last step, so the chain correctly
  answers "no rule 1", and refusal evidence is attributed to
  `walkthrough.smartAccount` alone, so the pinned account could never have shown
  a refusal table at all. Both detail routes were rendering empty states while
  the file's own comment claimed they were populated — this suite's failure mode,
  reproduced inside the suite. They are now read from `deployments/testnet.json`.
  And `every screen states where its numbers came from` was spending its full
  180s timeout on `main`, because the docs shell has no such landmark.

  That landmark is now there. `docs/layout.tsx` marks its content column
  `<main>` — it was the only shell on the site with none, so a screen reader
  jumping to the main landmark on a docs page landed in the sidebar and had to
  walk the whole nav to reach the prose. On the inner column rather than on
  `.screen`, which is the distinction the landmark is for: the sidebar is the
  same list on all four pages and `<aside>` is now correctly outside the main
  region rather than nominally beside it inside a shared `div`.
- ~~**`PolicyTable` and `ObservedSection` carry inline column widths.**~~
  **Closed.** Both moved onto `.tbl` and the column tokens, in their own commit
  against a measured before-and-after. The move had to be to `.tbl` rather than
  to the tokens alone: the tokens are stated in `ch`, so applying `.col-addr` to
  a table still at 13.5px would have produced a third address width instead of
  removing the second one. Three of the six converted columns needed no new
  token — they hold addresses, and both are now 156px, the same as the rules
  table and the install plan.

  `shots:check` stayed green, which was the useful part at the time: it compares
  sidecar text, so an unchanged result was positive evidence that the conversion
  moved geometry and not content. `assertNothingScrolls` did fail once, on the
  one column whose binding constraint is its heading rather than its cells — see
  `--col-rowhead` in `globals.css`. Both checks are gone now, with the shots.

- ~~**`DenyTable` is the third table still off the system.**~~ **Closed.**
  `w-[9rem]` and `w-[7rem]` on `min-w-[58rem]`, at 13.5px with `px-5`, now
  `.tbl w-full min-w-[58rem]` on `--col-verdict-lg` and `--col-axis`. Measured at
  1440 through the same simulator path, before and after:

  | | before | after |
  | --- | --- | --- |
  | | 13.5px / auto / `px-5`,`px-4` | 12.5px / fixed / 12px |
  | Verdict | 152px `w-[9rem]` | 144px `--col-verdict-lg` 20ch |
  | Axis | 112px `w-[7rem]` | 108px `--col-axis` 14ch |
  | Transaction | 558px (leftover) | 400px (leftover) |
  | Reason | 230px (leftover) | 400px (leftover) |

  `w-[9rem]` was never the width it stated. Under the auto layout a column is at
  least its widest cell, and the `lg` verdict badge's `min-w-[7rem]` plus `px-5`
  came to 152px — so the declared 144px had been losing to its own content since
  the badge grew. That is the difference between an inline width and a token: one
  reads as a decision and behaves as a suggestion.

  Three things this surfaced, none of them the conversion itself:

  - **The `ch` unit does not mean the same thing in two tables.** It resolves
    against the element the width lands on. The refusal table puts these tokens
    on a bare `th` — 12.5px, so `ch` is 8px — and every table from the proposal
    conversion puts them on `th.col-head`, which is 10px mono, so `ch` is 6px.
    The same `--col-axis: 12ch` was 96px there and 72px here, and `invocation`
    wrapped to two lines in the narrower one. Widened to 14ch. **The token block
    claims these widths are equal across tables and they are not; nothing checks
    it.** Recorded in `globals.css` and left open.
  - **`.tbl`'s hover background paints over a tinted row.** The hover is set on
    the cell and the verdict tint on the row, so a hovered deny row lost exactly
    the colour marking it. The deny table is the first `.tbl` table with tinted
    rows, so the two rules had never met. `tr:not(.row-tinted):hover`.
  - **`--col-verdict` could not hold the `lg` badge**, whose `min-w-[7rem]` is a
    floor no wrapping gets under. A separate token rather than a wider shared
    one, so the refusal table's `md` badge does not sit in 30px it does not use.

- **The column tokens are not actually equal widths across tables.** Newly open,
  and the one finding here that is a crack in the system rather than a gap in it.
  `ch` resolves against whatever element the width lands on, so a token means one
  number on a table whose headers carry `.col-head` and a different number on a
  table whose headers do not — 6px versus 8px per `ch`, a third apart. The block
  in `globals.css` opens by saying these are "the reason a contract address is
  the same width on every screen", and between `RefusalTable` and `PolicyTable`
  that is currently false.

  Not fixed here because every plausible fix moves rendered widths on tables
  outside the scope of this change: rebasing the tokens onto a font-independent
  unit, or moving them onto `<colgroup>` where they would at least all resolve
  against the table's own font, or putting `.col-head` on every table's headers.
  That is its own commit with its own before-and-after, on the pattern of the two
  conversions above.

  Note what this means for the claim closed above — that `Target` and `Contract`
  are "now 156px, the same as the rules table and the install plan". That holds
  for the tables compared, which all put the tokens on `th.col-head`. It does not
  extend to the refusal table, and nothing in the repository would have caught
  the difference.

- **`e2e/viewports.spec.ts` is still not in CI**, and now carries the only
  remaining check on column widths. It shares a `webServer` with the suite that
  spends testnet funds, which is why it is out. The two cheap suites in that file
  — document overflow and column overlap — read pages, submit nothing and spend
  nothing, so the split is a config problem rather than a cost one: a second
  Playwright project with its own server would put them on every push. Worth
  doing, given that the column-overlap check found a live defect on its first run
  and would have found it years earlier had anything been running it.

## What survives, and this is not negotiable

`packages/core`, `packages/chain`, `packages/chain/deployments/testnet.json`,
`scripts/`, and every test under them. That is the synthesizer, the independent
evaluator, the deny-case harness, the browser write path, and four verified
on-chain transactions with the survey behind them. It took three weeks and it is
the reason this project is worth anything. Nothing in it is touched.

What goes is `apps/web` — the frontend, and only the frontend. Delete it and
start again rather than editing it into shape.

The rules that survive with the engine:

- Every claim on the site is read from `deployments/testnet.json` or
  `generated/evidence.json`. Nothing typed. Nothing that can go stale silently.
- Every screen states whether what it shows is on-chain, computed locally, or a
  shipped fixture. The three are never blurred.
- The limits are stated before the argument, not after it. `TESTNET ONLY`,
  `NOT AUDITED`, `COMPOSITION ONLY`, `NO CUSTODY`.
- No stock imagery, no abstract renders, no AI-generated hero art.

## What is being built

Three surfaces, not one.

**`/` — the narrative site.** A scrolling argument: what the problem is, what
hoping gets you, what Limen does, what it looks like at work, what it refuses,
what you get back. Generous, spacious, sectioned. Content arriving as the reader
scrolls and leaving as they scroll back.

**`/docs` — the documentation.** Diagrams, tables, code, error-code references.
Dense where the site is spacious. The reference a builder actually uses.

**`/app/*` — the product.** Rebuilt in the new system, same behaviour: accounts,
new policy, policy detail with the agent run, activity, simulator.

## The thing this site says that no other site says

**The boundary is derived, not authored.**

Everything adjacent to this — every agent-permission product — asks you to
configure a policy: set a cap, pick the contracts, choose a window. Limen asks
you to do the thing once. The boundary is inferred from a transaction that
already happened, and it permits exactly that and nothing adjacent to it.

That is the sentence the whole site is built around. Not "safe agent
delegation" — everyone says that. *You already told us what you meant by doing
it.*

The deny table is the proof: six ways to be adjacent to the observed flow, six
refusals, six hashes.

## Narrative structure

A sequence of scenes, each one idea, each arriving on scroll. The beats, not the
wording — write that fresh:

1. **The two options today.** Hand over a key and hope, or approve every
   transaction and have no agent. Both are bad and there is nothing between
   them.
2. **What configuring a policy gets you.** The middle ground exists on Soroban,
   and reaching it means writing and auditing a Rust contract. So almost nobody
   has one, and the products that offer one ask you to describe in a form what
   you were going to do anyway — and to get it right first time, in the
   abstract, about money.
3. **Limen: derive it instead.** Perform the flow once. The boundary is read off
   what happened: the contracts touched, the functions invoked, the outflow that
   occurred, a window. Nothing wider.
4. **Installed, and enforced by the network.** Not by this repository's
   evaluator, not by a server. A policy contract inside `__check_auth`, checked
   before a token moves.
5. **What it refuses.** The six axes, with hashes. Each one changes exactly one
   dimension of the permitted flow. This is the centre of the page.
6. **Revoke.** The agent cannot remove its own boundary — the network refuses
   that too, and there is a hash for it. The owner can, and the same call stops
   working.

Then: what you can build on it, the limits stated plainly, and the waitlist.

## Motion

Content arrives on scroll and leaves on scroll back. Directional, staggered,
never gratuitous.

Two hard rules carried from the current build:

- **No `@keyframes` loops.** Motion is a transition on a state change — entering
  the viewport, a value arriving — never something running on its own authority.
  A loop keeps going with the network down, which makes it decoration.
- **`prefers-reduced-motion: reduce` renders everything without the transition.**
  Content present, nothing moving. Not a degraded page — the same page, still.

The ledger heartbeat and counter carry over: real ledger sequence from RPC,
stopping rather than faking when the endpoint is unreachable.

## Docs

Reference `walrus.space/docs` for shape, and do better. What it needs:

- A left sidebar with real hierarchy, a right rail with page contents.
- Diagrams drawn as SVG from the design tokens — the derivation flow, the
  authorization path, the smart account's structure. Not screenshots, not stock.
- Tables for the error codes, the policy primitives, the six deny axes, the
  environment variables.
- Code blocks that are transcribed from code that runs, not idealised.
- Every address, hash and cap read from the deployments file.

## Design direction

Spacious. The current build's failing is density where it should have air — the
app screens are correct to be dense, the site is not.

Keep from the current build: IBM Plex, the ruled grid ground, tabular numerals,
the verdict treatment with glyph and border and weight, one accent, no shadow,
no gradient, no glass.

Change: the rhythm. Sections get room. Headlines get room. One idea per screen
of scroll rather than four.

Theme: **light throughout**, site and app both. The measured printed-blueprint
palette in `lib/theme.ts` is kept untouched and `contrast.test.ts` keeps pinning
it. The deciding reason is differentiation: markov.fyi and katana.network — the
two sites this narrative is modelled on — are both dark, and Markov solves the
same problem on Solana that Limen solves on Stellar. A dark Limen with a scroll
narrative would resemble its nearest conceptual neighbour visually as well as
conceptually.

## Sequence

1. **Done** — `c034cb8`. Delete `apps/web`. Scaffold fresh. Keep the workspace
   wiring to `packages/*` intact and prove the engine still imports.
2. **Done** — `c777de0`. The design system: tokens, type, grid, motion
   primitives. Before any section.
3. **Done** — `d456cdd`. `/` — the narrative, scene by scene, committed per
   scene.
4. **Done** — `f187ce8`. `/docs`.
5. **Done** — `45effce`, `e36e9b3`, `ba5b888`. `/app/*` — the product screens,
   rebuilt, committed in three parts: the accounts screens and the primitives
   under them, the policy screens with the agent run, then activity and the
   simulator.
6. **Done.** The screenshot script and the evidence generator, re-pointed.

Commit at every completed step.

## What must be true at the end

- The engine is unchanged; `git diff` against `packages/` is empty except for
  imports.
- Every figure on the site traces to a file, and a check fails when it drifts.
- Nothing claims to be on-chain that is computed locally.
- The limits are visible before the argument.
- Full test suite, lint, build, audit gate and both bundle fences green.
- No page scrolls the body sideways at 1440, 1280, 1024, 768 or 390.
- The page is usable with reduced motion and with JavaScript slow.

## Decisions taken since the plan was written, which it does not record

- **UI fresh, logic carried.** Everything that renders is new. `src/lib` and the
  API route bodies came across, each reviewed as it was re-wired rather than
  assumed correct. The deciding case: the fee-source defect recorded in
  `browserRun.foundByThisRun` was found by a browser and cannot be caught by
  anything in `packages/`, so rebuilding `lib` would re-derive it silently.
  `extract.ts` is the same — the auth-credential subject fix came from a real
  transaction, not from reasoning.
- **The condition on carrying a module:** each commit says what the module does
  and why it survived. Carried forward must not become not looked at.
- **`mark.ts`, `headroom-options.ts` and `markers.ts` survive** — each encodes
  something learned rather than something decided about the old page's shape.
  `recorded-runs.ts` split: the typed accessors survived, the selectors shaped
  for one page's worked example did not.
- **Relocating modules to `packages/` is off the table for now.** Some of them
  may belong there on the merits; doing it mid-rebuild makes the diff harder to
  read exactly when legibility matters most. Revisit once the rebuild is green,
  as its own commit with its own verification.
