# PLAN-V6 — the site Limen deserves

`apps/web` is being rebuilt from nothing. The engine is not.

## Status

Steps 1 through 4 are committed on `v5-product`, pushed, at `f187ce8` — scaffold,
design system, the six-scene narrative, and `/docs`. 358 tests pass across 21
files; the build emits all 15 routes. `mark:check` is current. `evidence:check`
fails because `evidence.json` still claims the pre-rebuild counts — left until
step 5 changes them again rather than regenerating twice.

Steps 5 and 6 remain: rebuild `/app/*`, then re-point the screenshot script and
the evidence generator.

The branch label under-describes its contents: this is V6 work on a branch named
for V5. That is deliberate for now. A rename, if wanted, comes after the rebuild
is green and as its own thing.

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
5. **Remaining.** `/app/*` — the product screens, rebuilt.
6. **Remaining.** The screenshot script and the evidence generator, re-pointed.

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
