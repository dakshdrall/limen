# PLAN-V5 — the product people see

Status: **§1 released without an intake — see §1, and read it before crediting
this project with having fixed anything. §2 complete: the palette is light,
measured and pinned, and every screen and state has been looked at in a browser.
§3 in progress: the screenshot script is built, gated in CI, and the revoke step
is decided (3.1).** Written against the repository at `1156fa4`, after reading
`globals.css`, `app/page.tsx`, `caveats.test.ts`, `design-system.test.ts`,
`TopBar.tsx`, `e2e/viewports.spec.ts` and `ci.yml`.

V4 left the machinery correct. What is wrong is the presentation, and the fact
that someone outside this repository has hit bugs using it. This plan was
written to do the second thing first. It did not get to: see §1.

No deadline. SCF #45 is not being targeted; September or October is. Quality
over speed, in that order, with no exceptions.

**Nothing here relaxes an existing rule.** Every caveat, status label and
provenance statement survives verbatim. Every string pinned by `caveats.test.ts`
still passes. The honesty is this product's strongest asset and none of it is
traded for polish.

---

## 0. What reading the repository changed

Six things were checked before any of the work below was scheduled. Four of them
change what gets built; two of them turn a stated intention into a measured one.

### F1 — the inversion cannot be done by arithmetic, and now there is a number for it

§2 says a ramp that reads correctly on dark does not automatically invert. It is
worse than that. Inverting each current token channel-wise and re-measuring
against the inverted ground:

| token | dark | ratio | naive inverse | ratio |
|---|---|---|---|---|
| `--foreground` | `#e3e9f2` | 16.24:1 | `#1c160d` | 16.52:1 |
| `--muted` | `#97a4b8` | 7.85:1 | `#685b47` | 6.08:1 |
| `--muted-dim` | `#68758a` | 4.25:1 | `#978a75` | **3.11:1** |
| `--faint` | `#414d60` | 2.32:1 | `#beb29f` | 1.92:1 |

The ramp does not survive. `--muted-dim` carries secondary annotations and
captions across every screen and would land at 3.11:1 — under AA for body text,
from an operation that looks like it preserves everything. The four steps also
stop being evenly spaced, which is the part that makes hierarchy read.

So the light values are chosen against the targets in the comment block at
`globals.css:46–56` and measured, not derived. Candidate set, measured against a
warm off-white ground of `#faf9f6`:

| token | value | measured | target |
|---|---|---|---|
| `--foreground` | `#14181f` | 16.90:1 | ~14:1 |
| `--muted` | `#4c5666` | 7.05:1 | ~7:1 |
| `--muted-dim` | `#6f7a8a` | 4.13:1 | ~4.5:1 |
| `--faint` | `#a9b2be` | 2.04:1 | ~2.6:1 |

Two of these are candidates and not yet answers: `--muted-dim` at 4.13:1 wants
to come down to about `#67717f` to clear 4.5:1, and `--faint` at 2.04:1 is
further from its step than it should be. Both get resolved by measurement during
step 2 rather than here. What matters is that the exercise was done at all —
the naive route silently ships a failing ramp.

### F2 — the greyscale check is the real risk, and the obvious light palette fails it

§2 calls this the check most likely to silently break. It is right, and the
failure is sharper than expected.

Today, in greyscale, PERMIT `#45c86a` and DENY `#f9695f` collapse to values 25
apart out of 255. That is not much, and it works only because the design system
already refuses to let hue be the sole carrier: `Verdict.tsx` pairs every state
with a glyph (`✓ ✕ ⊘ ∅`) and a border treatment, and `design-system.test.ts`
pins that.

The obvious light-mode pair — a dark green and a dark red, both around 5:1 — is
**5 apart out of 255**. Effectively identical. A greyscale printout of the
refusal table would show two verdict columns distinguished by nothing but the
glyph.

A search over green and red hue families, constrained to AA against both the
white surface and the off-white ground, says a comfortable symmetric pair does
not exist: every pair with real separation buys it by making one verdict much
darker than the other. The best available in a defensible range:

```
permit  #0f7a43   5.41:1 on white   greyscale 106
deny    #8c1d18   9.11:1 on white   greyscale  74
                                    separation 32  (today: 25)
```

**The decision: take the asymmetry.** DENY sits heavier and darker than PERMIT.
That is defensible on its own terms rather than as a compromise — DENY is the
consequential verdict, the one a reader must not miss, and a refusal reading
heavier than a permission is correct. The result is better greyscale separation
than the current dark theme has, not worse.

The glyph and border stay the actual carriers, exactly as now. The hue
separation is a second line, not the first.

### F3 — this is a palette swap, not a second theme, and a test already requires that

`design-system.test.ts:264` asserts `--accent` is defined exactly once in
`globals.css`. A dark/light dual theme — a second `:root`, or a
`@media (prefers-color-scheme: dark)` block — defines it twice and turns that
test red.

That test is right and does not get relaxed. It also happens to agree with the
brief: §2 asks for light throughout, not for a toggle. So the values are
replaced in place. One palette, one definition per token, no theme switching, no
`data-theme` attribute. The token names do not change, which is what keeps this
a swap plus a verification pass rather than a rewrite.

### F4 — there is exactly one step-11 escape, and it cannot be fixed with a CSS variable

Grepping every `.ts`/`.tsx` under `src/` for hex, `rgb()` and `hsl()` literals
returns one file: `src/app/opengraph-image.tsx`, with ten hardcoded colours —
ground, three text steps, and both verdict fills and borders.

It is a real escape and it gets tokenised as §2 requires. But it cannot read
`globals.css`: it is an `ImageResponse` rendered on the server with inline
styles and no stylesheet, so CSS custom properties do not resolve. The fix is a
TypeScript token module the CSS imports its values *from*, so the OG card and
the stylesheet cannot disagree — and a test asserting every colour literal in
`opengraph-image.tsx` appears in that module.

This is worth doing rather than routing around. The OG card is the first thing
anyone sees when the link is shared, and a dark card opening onto a light site
is the same "leaving the product" seam §2 rejects between the landing and the app.

### F5 — `.screen` constrains §3's composition, and the landing cannot opt out

`design-system.test.ts:218` asserts every `page.tsx` — the landing explicitly
included, with a comment saying its exemption was removed in step 12 — carries
`className="screen"`. `.screen` is `max-width: 74rem` with `margin-inline: auto`.

§3 asks for a full-bleed evidence table and a two-column hero. Full-bleed inside
a centred max-width container needs a deliberate break-out, and the wrong
version of it is the one that reintroduces horizontal body scroll at 390px —
the exact regression `viewports.spec.ts` exists to catch, fixed as recently as
`f91d854`.

So: a `.bleed` component class in `globals.css`, documented like every other
class there, using a margin-inline break-out with `width: 100vw` avoided
(`100vw` includes the scrollbar and is the classic source of that overflow).
The escape is a named, tested part of the system rather than an inline style on
one section.

### F6 — anchor nav entries would fail the nav test as written

`design-system.test.ts:334` takes every `built: true` href in `TopBar.tsx` and
asserts a matching `page.tsx` exists. An entry like `/#evidence` resolves to
`src/app/#evidence/page.tsx` and fails.

That test is guarding something real — a `built: true` entry pointing at a route
with no page is an invisible 404. It should not be loosened to accept anything
containing a `#`.

Instead the landing's section nav is a **separate component from `TopBar`**, and
the correct one: `TopBar` is global chrome shared by the app screens, where
in-page anchors are meaningless. A landing-local anchor nav with the waitlist
CTA pinned right is a different object with different rules. `TopBar` and its
test are untouched, and the new component gets its own test asserting every
anchor href has a matching `id` on the page.

---

## 1. Bugs first — RELEASED WITHOUT AN INTAKE

**This section was released, not completed.** The distinction is the whole
entry, and it is recorded here rather than dropped because a plan whose §1 went
quiet reads, later, as a §1 that was done.

What happened: the reporter is fixing the faults himself and will open PRs, so
no list was ever supplied to this repository. The consequences, stated plainly:

- **No bug was reproduced.** Not one.
- **No failing test was written**, so nothing in the suite covers whatever those
  faults were.
- **The reported faults are unknown to this repository.** Their number, their
  routes, their severity and their class are all unknown. Nothing below §1 was
  informed by them.

This is not the same as the flow having been found sound. Nobody checked. The
one instrument that catches this project's live class of fault — a stranger
using it and hitting something the Node suite cannot see — was pointed at the
product and its output never arrived here. §2 and §3 therefore proceed over a
flow whose state outside this repository is not known, which is the order §1 was
written to prevent, and it is worth being honest that this is a cost being
accepted rather than a risk that was retired.

If those PRs arrive, they are reviewed as bug reports that happen to come with
fixes: each one still wants a test that fails without it, by the protocol below.
A fix landing without one leaves the fault uncovered exactly as it is now.

### The intake protocol, kept for whenever a report does arrive

Unchanged, and not deleted just because it went unused. Per report:

1. **Reproduce it first.** In a browser, at the viewport and on the route
   described. A report that cannot be reproduced is written up as
   not-reproduced with what was tried, not fixed on a theory.
2. **Write the failing test before the fix.** It fails against current `HEAD`,
   and the failure is recorded in the commit message.
3. **Choose the layer the test belongs in, deliberately.** This is the part that
   matters. The three defects the driven run found were all invisible to the
   Node suite — they made the flow unusable rather than incorrect, and that is
   the live class of fault here. A bug of that class caught by a unit test that
   reads source is a bug that will come back. It belongs in `e2e/`.
4. **Fix it, and commit the test and the fix together.**

If a report turns out to describe intended behaviour, that is an answer too, and
it gets written down rather than silently closed — usually as a sign the screen
failed to say what it was doing, which is a different bug in the same place.

The rule this section was written under — polish over a broken flow is the worst
possible order to work in — still stands. It was not repealed by the report not
arriving; it was simply not able to be applied.

---

## 2. The theme: blueprint becomes paper

The register does not change. This stays an instrument. Technical drawings were
ink on paper long before they were light on glass.

**Order changed from the one first written here.** The plan had the swap first
and the OG card after it, as clean-up. That is backwards: the module is what
makes the swap safe. Extracting it first means the palette has exactly one
definition and a test pinning every consumer to it *before* any value moves, so
a half-applied swap is a red build rather than a screen someone has to notice.
Doing it second would mean inverting eleven literals in the OG card by hand and
hoping they matched.

### 2.0 The token module

See §2.2, which is now the first step of §2 rather than the third.

### 2.1 The token swap

One commit, `globals.css` only, no component touched. Names identical, values
replaced.

- **Ground.** Warm off-white, `#faf9f6` — not `#fff`. Surfaces sit *above* it by
  being lighter (white) or by hairline borders. `--surface-sunken` inverts its
  meaning correctly: below the ground means slightly darker, still opaque, still
  not alpha, for the same reason the current comment gives — alpha lets the grid
  through and a card the floor shows through does not read as sitting on
  anything.
- **Rules.** Three weights, all thin, now dark-on-light. `--border-bright`
  becomes the *strongest* rule rather than the lightest; the name stays because
  it means "most prominent", and renaming three tokens across every component to
  gain nothing is the change that introduces the mistakes.
- **Text ramp.** Per F1. Measured against the ground, each of the four steps,
  with the numbers recorded in the comment block that currently records the dark
  ones.
- **Verdicts.** Per F2. PERMIT `#0f7a43`, DENY `#8c1d18` as candidates, with the
  `-dim` fills becoming pale tints of each rather than near-black washes, and
  the `-line` borders re-measured against the tint they sit on. `--unproven`
  stays in the neutral ramp with its dashed border — it must not become a fourth
  hue on light any more than it was allowed to on dark.
- **The accent.** Reconsidered rather than darkened. `#58b0e8` against near-black
  is a light blue that reads as active; the same hue against off-white is
  invisible. Candidate `#155e96` at 6.83:1. It has to be checked in its three
  jobs specifically — active nav, focus ring, copy affordance — because a focus
  ring is judged against the border it replaces, not against the ground.
- **The grid.** Same two pitches, same `--grid-pitch` and `--grid-pitch-major`.
  The hairline becomes a faint ink line: a low-alpha near-black rather than a
  low-alpha blue. The alpha values will need to *drop*, not invert — dark lines
  on a light ground read stronger at equal alpha than light lines on a dark one,
  and the rule in the current comment still governs: if you notice the grid
  rather than the depth, it is too strong.
- **`.modal::backdrop`** is currently `rgb(2 4 8 / 0.86)`. A near-black scrim
  under a light modal is correct and does not invert to a white one; it drops in
  opacity instead. Checked by eye, not assumed.
- **`.field`** restates the UA's control colours to stop the modal rendering
  white-on-white. On light, that comment stops being true and the rule may be
  doing nothing or the wrong thing. Re-derived, not left.

### 2.2 The OG card

Per F4. Extract `src/lib/theme.ts` holding the token values as TypeScript;
`globals.css` and `opengraph-image.tsx` both source from it, and
`design-system.test.ts` gains a case asserting no colour literal exists in
`opengraph-image.tsx` at all. Same for `twitter-image.tsx`.

### 2.3 The verification pass

Screen by screen, every route in `viewports.spec.ts` plus every state that route
can reach — populated, empty, read-failed, pending, mid-write. Not a spot check.
The failure mode of a token swap is not that a screen breaks; it is that one
element in one state was never looked at.

Specifically checked, because they are the ones an inversion silently breaks:

- The four `ScreenState` no-data states, which are drawn almost entirely in
  `--faint` and `--muted-dim` — the two steps the ramp is loosest at.
- `.btn:disabled`, which drops fill and border and relies on `--faint` reading
  as absent. On light, "absent" and "white" are much closer together.
- `.tbl tbody tr:hover`, using `--surface-hover`. A hover state one value step
  from white is a hover state nobody sees.
- The `Verdict` badges in all four states, at their real sizes, in greyscale.
- `LocalKeyBadge`, `StatusLabel` at both weights, and the `loud` variant that
  earns its weight from `--foreground` against `--border-bright`.

Commit per screen group, not one commit at the end.

**Done.** All nine routes at 2x, zero document overflow. The stepper was driven
to beat 6 on the shipped-fixture path — the only way to reach the four
`--surface-raised` header bands, which is the token whose *direction* the
inversion changed and therefore the one most able to look wrong. They render
`#f6f3ec`: a warm grey band over white rows with a stronger bottom rule, which
is what a light table header should be. Hover was rendered live rather than
checked numerically, and is clearly visible against white rows. The mid-write
state was reached by holding the RPC open so a submission stays in flight
without anything being sent — three controls disabled, `WriteResult` showing its
accent in-flight row. Read-failed renders as a `refused`-toned panel.
`LocalKeyBadge` checked with keys present. Greyscale re-checked on the rendered
badges: DENY paints 22 levels darker than PERMIT on top of the distinct glyphs.

One observation, not a palette matter and not acted on: the friendbot fund
control never disables while it is calling, because funding goes through
`use-write`'s `note()` rather than `run()` and only `run()` sets `busy`. That is
the deliberate submission/not-a-submission split in `use-write.ts`, and a double
click costs a second friendbot call that returns "already exists" and is
reported as success — harmless. Recorded because the pass found it, not because
it needs fixing. **Now queued as work in §4** — it is observed rather than
guessed at, and one line, so it is scheduled rather than left as a note.

---

## 3. The landing: from document to product site

Sections in the order §3 gives, with the six structural additions. Everything
here reads from `deployments/testnet.json` and `generated/evidence.json`.
Nothing typed.

### 3.1 Screenshots are generated, not taken

The single most important decision in this section, and the one that keeps it
consistent with everything else in this repository: **the product screenshots
are produced by a committed script, not captured by hand.**

`scripts/screenshots.mjs`, driving the existing Playwright install against the
existing `webServer` config, at `deviceScaleFactor: 2`, with the seeded store
`viewports.spec.ts` already defines, cropped by locator rather than by
coordinates. Output committed under `apps/web/public/shots/`.

The reason is not convenience. Every hash in those screenshots comes from the
deployments file. When that file changes, a hand-cropped PNG becomes a picture
of a hash that is no longer the project's — a stale claim in image form, which
is the one place `caveats.test.ts` cannot reach and the one place nobody thinks
to check. A regenerable script makes that a rerun. It also gets a `--check`
mode, on the `evidence:check` precedent, so CI can say the images are stale
rather than letting them rot.

No device frames, no perspective, no drop shadows. Cropped to the region that
matters, on the surface step, with a hairline border.

**Resolved: shot at 900, not 1280.** The crops were about 1144 CSS px wide and
§3.5's slots are roughly half a 74rem page, which rendered them near 0.44 scale
and put the application's 13px body text under 6px. A picture nobody can read is
decoration however real its data is.

The width is bounded from both sides, and both bounds were measured against the
running application rather than argued about:

- **Not below 768**, Tailwind's `md`, or the shot shows a layout nobody on a
  laptop sees. These subjects turn out to use only `sm:`, and their structure at
  900 is identical to 1280 — same grids, same crop heights, only text wrapping
  differs — but the floor stands for whatever gets photographed next.
- **Not below ~872.** At 860 the simulator's policy tables are 728px wide around
  736px of content and a column is cut off. This was not hypothetical: 800 was
  the first candidate and it cut `step-derive` and `step-install` silently, in
  the one artefact nobody reviews column by column.

So 900, and crops of 860. `assertNothingScrolls` now fails any run where
anything inside a crop scrolls horizontally, naming the element and computing
the width that would fix it — a cut-off column can no longer ship quietly,
which is what makes the number above a condition rather than an afternoon's
measurement. It was proved able to fail before it was trusted: at 860 it stops
the run and says to widen past 868.

At 860 wide the images want an image column of about 640px, where they render at
0.74 and the app's body text lands near 9.6px — checked by rendering, not by
arithmetic. That is a constraint on §3.5's composition: **the alternating band
gives the image ~640 and the text the rest**, rather than an even split.

~~Screenshots needed: the refusal table with real hashes (hero), and the four
`How it works` steps — create, derive, install, revoke.~~

**Amended: nothing is shot from `/`.** The hero screenshot named above was a crop
of the landing page itself — the permitted row and the refusals under it, which
this page renders live, in HTML, a few hundred pixels below where the image would
have sat. So was `worked-example`, which cropped the Mechanism section. A page
illustrated with photographs of itself.

The live markup wins on every axis: its hashes are read at build time and cannot
go stale, its text is selectable and reaches a screen reader, and it needs no
check to stay honest because there is nothing to keep in step. The screenshot was
the strictly worse copy of content already on the page, and it charged
maintenance for the privilege. Both are dropped, and the rule that replaces the
list is: **a shot has to show something the page cannot show itself.** In
practice that means every shot comes from `/app`.

The hero therefore carries an application screen instead — `step-install`, the
exact policy set beside its unsigned payload — and the refusal table gets the
full-bleed treatment §3.5 already wanted for it, as live markup rather than as an
image of live markup.

**Built, and gated.** Four shots: `step-create`, `step-derive`, `step-install`,
`step-observe`. The run is
hermetic — every chain request is aborted — so only screens rendering from
committed data can be photographed at all, which is the rule enforced by the
mechanism rather than by discipline. `--twice` proves each shot reproducible
before `--check` is allowed to mean anything. `shots:check` runs in CI after the
build, on the `evidence:check` argument: a check that only runs when somebody
remembers is not a check, and a stale image is the one claim on this page that
`caveats.test.ts` cannot read and no reviewer reads either. The browser is
cached on the lockfile hash; the install measures 1.3s warm and the whole check
46s locally, most of it waiting on `next start`.

**The revoke step gets no screenshot, and this is decided rather than skipped.**
The only screen that shows revoke is `/app/policies/[id]`, which writes to and
reads from a live chain. Photographing it would commit a picture of one
account's rule at one ledger — a second, unverifiable copy of chain state in the
repository, which is the exact failure this script exists to prevent. It was
nearly missed: a `step-revoke` entry pointed at `/app/policies/new` produced a
perfectly good image *of the observe step*, a name claiming a capability the
picture did not demonstrate. Renamed, not re-pointed.

So step 04 is **a panel built from committed data rather than an image**:
`revokeTx`, `postRevokeTx` and the measured `postRevokeError`
(`ContextRuleNotFound#3000`) read at build time from
`deployments/testnet.json`, drawn in the product's own components as a sibling
of the refusal table. It is the strongest of the four steps, not a fallback —
it is the only one that can show the boundary being taken back *and* the call
that stopped working afterwards, and it goes stale-proof by the same route
every other number on the page does. Three photographs and one panel, each
honest about what it is.

### 3.2 The mark

A geometric glyph reading as a threshold or boundary. Monochrome, legible at
24px and as a favicon. Drawn as an inline SVG component with `currentColor`, so
it inherits the text colour everywhere it appears and cannot drift from the
palette. Shipped as: the component, `src/app/icon.svg`, and the OG card's mark.

`favicon.ico` is currently the Next.js default and gets replaced.

**Built.** A doorway standing on its threshold stone — *limen* is that stone, so
the mark is the name rendered literally rather than an abstraction of it. Six
candidates were drawn and rendered at 16, 20, 24, 32 and 64px on light and dark
before this one was chosen; the ones that lost, lost at 16px, where they read as
a dot in a box or as a typographic accident.

The geometry lives in `lib/mark.ts` as four non-overlapping rectangles and
nothing else draws it: `components/Mark.tsx` renders them with `currentColor`,
and `scripts/mark.mjs` builds `app/icon.svg` and `app/favicon.ico` from the same
module plus `lib/theme.ts`. Node strips the types on import, so the script reads
the real source rather than a transcription of it.

Two properties make that pin cheap enough to run in the ordinary suite rather
than as a check of its own: every coordinate is a multiple of 1.5 on a 24 grid,
so every edge lands on a whole pixel at 16, 32 and 48px and the rasteriser is
arithmetic rather than a rendering engine; and the PNGs inside the `.ico` are
written with stored deflate blocks, so no zlib version can change a byte.
`design-system.test.ts` rebuilds both files and compares bytes.

Two things the build taught rather than the plan predicting them. Next decodes
`favicon.ico` at build time and rejects PNG-in-ICO that is not RGBA, so the
icons carry a fourth channel of nothing but 255. And the `.ico` is the one
drawing of the mark that is ink *on paper* rather than ink on transparency: an
`.ico` cannot ask what colour the tab strip is, and near-black on a dark strip is
an invisible mark. `icon.svg` can ask, and does — a `prefers-color-scheme` rule
that is not the second theme F3 rules out, because a favicon is drawn on the
browser's chrome rather than on one of this product's surfaces.

### 3.3 The SVG diagram

Observed transaction → derived boundary → agent operating inside it → the
network refusing at the edge. Existing tokens only: hairlines, the accent, the
verdict colours. Drawn by hand in the source, not generated.

It is an argument, not decoration, so it carries `role="img"` and a real
`<title>`/`<desc>` describing the mechanism — §5 requires it be described rather
than left as decoration. It must also read at 390px, which for a four-stage
horizontal diagram means it reflows to vertical rather than scaling to
illegibility.

### 3.4 Headlines, cards, nav, footer

- **Headlines that assert.** `Mechanism`, `Numbers`, `What this does not do`
  become eyebrows above headlines stating the claim. §2's evidence section
  already does this and is the model. **`What this does not do` keeps its
  wording as the eyebrow** — it is one of the four places a reader meets the
  limits, and promoting a softer headline above it must not soften what sits
  under it.
- **Feature cards.** The `Capabilities` grid, six tiles on the shared hairline
  grid — `gap-px` over the subtle rule, the technique `Stat` already uses, so
  six tiles are not six doubled borders.
- **Anchor nav.** Per F6, a landing-local component. Mechanism, Evidence, How it
  works, Limits, waitlist pinned right. App routes unchanged. Smooth scrolling
  is already governed by the global `prefers-reduced-motion` rule, which sets
  `scroll-behavior: auto` — that stays.
- **Footer.** Four columns: Product, Evidence, Resources, Contact. GitHub, docs,
  the deployments file, the licence. The current single paragraph — the one
  stating that every hash is read at build time from two named files — **is not
  replaced by the columns.** It sits below them. It is a provenance statement,
  not footer boilerplate.

### 3.5 Composition

Two-column hero, full-bleed evidence table (via F5's `.bleed`), card grid,
alternating screenshot-and-text through `How it works`. The page should have a
shape when you squint at it.

**Hero and band built.** From `xl` up the hero is 416 for the argument and 640
for `step-install`; below it the image goes under the text at full width, which
is more legible still. 640 is the width the screenshot was measured legible at,
not a round number. The image is a static import, so Next reads its intrinsic
size at build time — a hand-written width and height is the version that goes
wrong as layout shift the next time a crop changes — and it carries `preload`
rather than the `priority` this Next deprecated in 16.

`.bleed` turned out to want `.screen` to become a three-column grid rather than a
centred max-width box. The content column computes to exactly what the old
`max-width` plus padding produced, so no existing screen moved: 1104 at 1280, 720
at 800, 342 at 390 — checked. The reason it is a grid at all is F5's warning:
`margin-inline: calc(50% - 50vw)` is the technique everybody reaches for, and
`100vw` includes the scrollbar, so a "full-bleed" section on a scrolling page is
about 15px wider than the viewport. Percentages against the element's own width
have no such problem. `design-system.test.ts` now forbids a viewport unit in any
margin, which catches the cause on every commit, next to the e2e suite that
catches the symptom at four widths. Both were run: zero document overflow at
1440, 1280, 1024, 768 and 390.

The band's heading sits at the page gutter rather than the content column, which
is what full-bleed means and reads as deliberate because the whole section moves
together. Its prose still stops at `.measure`, and `--bleed-max` stops the table
at 96rem so a wide monitor gets a wider table rather than seven columns spread
across a desk.

Motion stays exactly as step 7 left it. No new animation. `design-system.test.ts`
forbids `@keyframes` outright and that does not change.

### 3.6 What does not move

- The four status labels, in the spec strip, before the argument.
- The two-runs disclaimer, in the worked example, in the wording
  `caveats.test.ts:399` pins.
- The Limits section, verbatim, including the by-hand caveat.
- The `Section` numbering discipline, and the simulator link that says on its
  face that nothing it draws has been enforced by a network.

---

## 4. Outstanding from V4, carried forward

These are open and stay open until closed properly.

- **§11's by-hand run.** Still UNRUN, still recorded as unrun. Blocked on port
  forwarding on the reviewing machine, not on anything in the repository. The
  driven Playwright runs retire the narrow claim; "completes by hand" stays
  unmet. It is the last item in the sequence, when forwarding allows, and it is
  not quietly retired before then.
- **`horizon-run.mjs` and `horizon-confirm.mjs`.** Confirmed lost — not on disk,
  not in history, not in any surviving scratchpad. `scripts/verify-browser-run.mjs`
  occupies that role. Superseded; stop looking.
- **The friendbot control never disables while it is calling.** Queued work, not
  an observation. Funding goes through `use-write`'s `note()` rather than
  `run()`, and only `run()` sets `busy`, so the button stays live through its own
  call. §2.3 recorded this as a finding rather than a fix, on the grounds that
  §1's no-guessing rule applies to faults stumbled on mid-pass. That rule is
  about faults that are *guessed at* — this one was observed, its mechanism is
  understood, and the change is one line. It belongs in the plan.

  It still gets §1's protocol, which is the part that does not bend: a test that
  fails without the fix, in `e2e/` rather than the Node suite, because a control
  that fails to disable is invisible to a suite that reads source. Landed after
  §3, so the landing is not interrupted mid-page.

- **Session fragility.** Commit at every completed step, not at the end of a work
  block. This project has lost sessions to usage limits, a dead battery and a
  laptop restart, and uncommitted work has twice been destroyed by `git checkout`
  — so a mutation gets a file copy first, never a `checkout` or `restore` to undo.

---

## 5. Sequence

1. ~~**The reported bugs.** Each reproduced, each with a failing test first.~~
   **Released without an intake — no report was supplied, no bug reproduced, no
   test written. See §1.**
2. **The light theme.** The token module and its pin (2.2) — first, so the swap
   is guarded before it starts — then the tokens themselves (2.1), then the
   screen-by-screen verification pass (2.3).
3. **The landing rebuild.** Screenshot script (3.1) and mark (3.2) first, since
   the sections consume both; then sections in page order.
4. **The by-hand acceptance run**, when forwarding allows.

Commit at every completed step. `apps/web/AGENTS.md` applies throughout: this is
Next 16.2, the docs are in `node_modules/next/dist/docs/`, and they get read
before any image or metadata code is written rather than after it misbehaves.

---

## 6. Verification

Everything V4 gated on, plus what this plan adds.

**Unchanged and non-negotiable**

- Every string pinned by `caveats.test.ts` present, verbatim.
- Four status labels still in the spec strip, still before the argument.
- The limits section unchanged in substance; the by-hand caveat intact.
- `evidence:check` up to date; lint, build, audit gate at `--audit-level=low`,
  both bundle fences.
- Full test suite green — 402 and rising, none removed to make a change pass.

**New, and specific to the inversion**

- **PERMIT and DENY distinguishable in full greyscale**, re-checked on the
  rendered badges after the swap rather than assumed from F2's numbers. The
  glyph and border carry it; the hue separation is the second line.
- **Every contrast ratio in the ramp re-measured**, against the real ground, and
  the measured values written into the comment block in `globals.css`. Not
  inverted by arithmetic. F1 is the reason.
- No colour literal anywhere outside `lib/theme.ts` and `globals.css`, asserted
  by test, including in the OG and Twitter cards.

**New, and specific to the landing**

- No page scrolls the body sideways at 1280, 1024, 768, 390px —
  `viewports.spec.ts`, extended to cover the full-bleed section, which is the
  new way to break it.
- Every image has meaningful alt text. The SVG diagram is described, not
  decorative.
- Images sized and lazy-loaded below the fold; no layout shift.
- Screenshots regenerate clean — `scripts/screenshots.mjs --check` passes,
  proving no image has drifted from the hashes it depicts.
- Every anchor in the landing nav has a matching `id` on the page, asserted by
  test.
