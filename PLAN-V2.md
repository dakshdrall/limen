# Limen V2 — from fixture demo to working MVP

Status: **implemented 2026-08-02.** All four decisions resolved — see §8.

Verification against §6, honestly: items 1, 2, 4, 5, 6 and 7 all pass and are
enforced by CI. **Item 3 — the stepper completing end to end against real
testnet, twice, from a clean browser profile — is still NOT fully met**, but it
is no longer wholly unproven, and the reason it was originally blocked has since
gone away.

Updated 2026-08-02: this environment now does have a funded testnet demo account
configured, so the original reason for the block — no credentials here — is
stale. Two full perform→ingest cycles have since been run against live testnet:

| | run 1 | run 2 |
|---|---|---|
| tx hash | `33504c53…190f917d` | `0fd54ac8…30d155dc` |
| ledger | 3929005 | 3929091 |
| ingest result | 1 movement, `attribution: "exact"` | 1 movement, `attribution: "exact"` |
| meta arm | 4 | 4 |
| balance delta | −0.1013826 XLM | −0.1013826 XLM |

Run 2 was taken after waiting out the full per-address rate-limit window (the
limiter was confirmed live first: an immediate retry returned 429 and spent
nothing) and after restarting the dev server, so it ran against a cold process
rather than a warm one.

**Two findings worth keeping.** First, live testnet metadata is arm **4**: the
transfer arrives in the per-operation list, alongside two transaction-level
CAP-67 `fee` events staged `beforeAllTxes`/`afterAllTxes`. So the V4 reader is
not defensive futureproofing — before it, the extractor would have returned zero
movements for the demo's *own* transaction, and the derived cap would have
bounded nothing. Second, ingest returned exactly one movement both times: the
fee events are correctly classified as non-transfers against real data, not just
against constructed fixtures.

**Item 3 is still NOT met, and should not be marked met.** §6.3 asks for the
run to be driven *through the stepper UI, from a clean browser profile*. These
two runs called `/api/demo/perform` and `/api/ingest` directly with curl,
because no browser automation was available in the environment that produced
them. That leaves the server path, the on-chain submission, and repeatability
across a cold process evidenced — and the client half untouched. Specifically
unexercised: the `sessionStorage` rehydration at `DemoStepper.tsx:111`, which is
the actual warm-state surface item 3 is aimed at. Closing it needs a human with
a browser, or a connected automation extension.

A note on how big that residual gap is, in fairness to whoever picks it up: the
stepper persists to `sessionStorage`, not `localStorage`, so it dies with the
tab, and `demo-state.ts:37` already allowlists the persisted fields with a test
behind it. The clean-profile property is therefore narrower than the §6.3
wording suggests. Narrower is not verified, which is why this stays open.

Unchanged and still verified: every step of that path degrades correctly when
the account is absent — beat 1 reports `no_secret` and offers the preset route.

- **[V2-D1]** → **(b)**, represent the uncertainty. Implied by "accurate-or-absent,
  never silently narrow": attaching movements to `invocations[0]` asserts
  something the transaction meta never said.
- **[V2-D2]** → shared demo account with a serialized queue. Friendbot-per-session
  rate-limits under any real reviewer traffic.
- **[V2-D3]** → whatever survives a Vercel cold start without a new dependency,
  i.e. in-memory, documented as process-local.
- **[V2-D4]** → `stellar.expert`.

Supersedes nothing in `PLAN.md` — that plan is fully implemented and green (52
tests, lint, build, audit gate). This one closes the two gaps that keep it a
demo: a reviewer cannot run it on their own transaction, and no path produces a
real on-chain result.

---

## 0. The invariant

**The synthesizer is the only thing that produces policy.**

Not the LLM, not the UI, not the ingest adapter, not the demo stepper. Every
constraint rendered on screen must be traceable to a `synthesize()` output. A
number that appears without the synthesizer having emitted it is a bug, not a
display detail.

The existing code already holds this: `PolicyReview` calls `synthesize` in a
`useMemo` and renders only its output, and `[A1]` keeps Claude's options as
proposals until a click. V2 adds two new surfaces — the ingest adapter and the
demo stepper — and both are positions from which the invariant can be broken
quietly. The concrete defences:

- The stepper **never** stores a derived number in its own state. Beat 3 stores
  the `ObservedTransaction`; the proposal is recomputed by calling `synthesize`.
  Persisted state (§2) is the observed transaction and the beat index — never a
  cap, never a policy, never an XDR payload.
- The ingest adapter produces `ObservedTransaction` and nothing else. It never
  computes a limit, a window, or an allowlist.
- A test asserts the stepper's persisted shape contains no `PolicyProposal`
  fields, so a future "cache the proposal for speed" change fails CI.

This is Limen's equivalent of "the contract is the only calculator," and it is
what the submission rests on.

---

## 1. Live ingest

### 1.1 What exists

`POST /api/ingest` already does most of this. It resolves fixtures with no
network call, refuses `mainnet` deliberately, validates the hash shape, requires
`SOROBAN_RPC_URL` server-side, calls `rpc.Server.getTransaction`, and hands the
response to `extractObservedTransaction`. The RPC path is written but, per the
README, "lightly exercised."

The work is therefore not "add live ingest." It is **make the extraction path
trustworthy, and put the hash input on the page.**

### 1.2 Fail rather than guess — where `extract.ts` currently guesses

`readMovements` wraps every event in a `try { … } catch { continue }` and skips
anything it cannot read. The file header argues this is safe because a dropped
movement lowers the derived cap, and less permission is the safe direction.

**That argument is wrong for this product, and the brief is right to reject it.**
A dropped movement does bias the cap downward, but it produces an
`ObservedTransaction` that does not describe the transaction. The deny table
then renders `cap + 1` rows against a cap derived from an incomplete flow, and
the page states a boundary that was never observed. "Safe direction" is not the
standard; **accurate or absent** is.

Rewrite `readMovements` to classify each event into three cases:

| case | condition | behaviour |
|---|---|---|
| ignore | not a token `transfer` event (topic 0 is not `transfer`, or fewer than 3 topics) | skip — nothing we model moved, so this is not a guess |
| **fail** | topic 0 *is* `transfer` but a field is unreadable: contract id not 32 bytes, `from`/`to` not addresses, amount not a non-negative integer | throw `ExtractionError('unreadable_movement', …)` naming the event index and the specific field |
| accept | fully readable | record the `TokenMovement` |

The distinction that makes this coherent: **skipping a non-transfer is knowing
nothing moved; skipping an unreadable transfer is knowing something moved and
not knowing how much.** Only the second is a guess, and only the second fails.

Same treatment for `readInvocations`: an argument that fails `scValToNative` is
currently recorded as the literal string `'<unreadable>'`. Arguments are
presentational — the synthesizer reads `contractId` and `functionName`, never
`args` — so this one stays a marker rather than a failure, but the marker gets
rendered visibly as unreadable rather than sitting in the args list looking like
a value. A `TODO(roadmap)` notes that argument-level policy would promote this
to a failure.

### 1.3 Attribution — **[V2-D1]**

Contract events carry the token contract, not the invocation that emitted them.
`extract.ts` attaches every movement to `invocations[0]`. For a single-invocation
transfer that is exact. For a two-call swap it is a guess, and the brief says
fail rather than guess.

Taken literally, that fails **every multi-invocation transaction** — including
the swap, which is the case that best demonstrates "two functions observed → two
functions permitted." I do not think you want that, so I am not choosing it
silently. Two options:

- **(a) Hard fail.** Multi-invocation transactions are refused at ingest with
  `ambiguous_attribution`. Maximally honest, and kills the most interesting
  demo input.
- **(b) Represent the uncertainty instead of resolving it (recommended).**
  Move `movements` from `Invocation` up to `ObservedTransaction`, with an
  explicit `attribution: 'exact' | 'transaction-level'` field. `'exact'` when
  there is one invocation; `'transaction-level'` when there is more than one.
  The Observed section renders transaction-level movements as a separate block
  labelled *"movements observed in this transaction; the meta does not say which
  call caused them,"* rather than drawing them under a call that may not have
  caused them.

(b) is defensible because the claim it protects is already proven: `synthesize`
sums outflow across all invocations and derives contracts and functions from the
invocation list independently, so **no cap, allowlist, or deny case changes
under either attribution.** Option (b) stops the UI from asserting something the
chain did not say, which is the actual defect — the guess was never in the
policy, it was in the rendering.

Cost of (b): it is a breaking change to `ObservedTransaction`, so `types.ts`,
`synthesize.ts`, `evaluate.ts`, `denycases.ts`, both fixtures, the factories, and
all 52 tests move with it. Roughly a day. Cost of (a) is an hour.

**This is the one place I would deviate from the brief, and I want your call
before writing either.**

### 1.4 Fixtures stay, labelled

Unchanged in substance. `network: 'simulated'` and the verbatim string
`(shipped fixture — not observed on a live network)` in `ObservedSection.tsx`
both stay exactly as they are.

A live ingest must show the opposite, with equal prominence:

- `network: testnet`, the real `ledger`, and the real `source`
- an explorer link — `https://stellar.expert/explorer/testnet/tx/{hash}` —
  opening in a new tab, `rel="noreferrer"`
- an `observed on testnet` marker in the same slot the fixture caveat occupies,
  so the two are read in the same place and cannot be confused

### 1.5 The hash input

First-class, at the top of the demo section, above the fixture preset row —
not behind a disclosure.

```
paste any Soroban testnet transaction hash
[ 64 hex characters                        ] [ Observe ]
or start from a preset:  simple-transfer  swap-two-calls  over-limit
```

`PolicyReview` grows a controlled input and an `observe(hash)` action alongside
its existing `loadFixture(key)`. Both call `/api/ingest`; the presets pass a key,
the input passes a hash. The error surface already exists (`ingestError`) and
already renders in `text-deny` — it gains structure (§1.7).

When `SOROBAN_RPC_URL` is unset the input renders **disabled with the reason
stated on screen**, matching how Install already handles a missing
`NEXT_PUBLIC_SMART_ACCOUNT_ID`. It never silently falls back to a fixture.

### 1.6 Cache and rate limit

- **Cache.** Resolved transactions by hash, server-side, in an in-memory `Map`
  with a bounded size and an LRU-ish sweep. A confirmed Soroban transaction is
  immutable, so there is no staleness question — only eviction.
- **Rate limit.** By IP, on `/api/ingest`. The waitlist route already contains a
  fixed-window limiter (`hits`, `rateLimited`, `clientIp`) with an opportunistic
  sweep; extract it to `apps/web/src/lib/rate-limit.ts` and have both routes use
  it. Cache hits skip the limiter — they cost no upstream call.
- **Honesty.** Both are process-local and reset on redeploy, exactly like the
  waitlist store. They raise the cost of a flood; they do not bound it. Same
  `TODO(roadmap)` language, and a README line rather than silence. **[V2-D3]**
  covers whether that is good enough for submission.

### 1.7 Structured errors

`/api/ingest` currently returns `{ error: string }`. Give it
`{ error: { code, message, detail? } }` with a closed code set —
`bad_request`, `unknown_network`, `mainnet_out_of_scope`, `rpc_unconfigured`,
`rpc_failed`, `not_found`, `tx_failed`, `no_invocations`,
`unreadable_movement`, `ambiguous_attribution` — so the page can render a
refusal differently from a transport failure (§4). Existing plain-string
handling in `PolicyReview` updates with it.

---

## 2. `/demo` — the guided stepper

A separate route, `apps/web/src/app/demo/page.tsx`. Five beats, each a button,
each producing a visible result. A reviewer with no wallet and no funded account
completes the thesis in under ninety seconds.

### 2.1 The beats

| # | beat | what happens | on-chain? |
|---|---|---|---|
| 1 | **Perform a transaction** | `POST /api/demo/perform` builds, signs, and submits a real testnet SAC `transfer` from the demo account. Returns hash + explorer link. | **on-chain** |
| 2 | **Observe it** | that hash through the live `/api/ingest` path. Renders extracted invocations and movements. | **on-chain read** |
| 3 | **Derive the boundary** | `synthesize()` in the browser. Context rule, policies, rationale. | computed locally |
| 4 | **Try to exceed it** | `generateDenyCases` + `evaluate`. One PERMIT row, six DENY rows, each with its reason. | computed locally |
| 5 | **Read the policy** | the policy configuration and the unsigned XDR from `/api/install-preview`. | computed locally |

Every beat carries a fixed badge — `on-chain` or `computed locally` — in the
same position, same treatment. Beat 4 in particular must not read as on-chain
enforcement: its caption states that refusal is adjudicated by this repository's
evaluator, matching the README's existing caveat rather than softening it.

**Beat 1 must be a contract invocation, not a classic payment.** A classic
`payment` operation emits no contract invocations, and
`extractObservedTransaction` correctly throws `no_invocations` on it — beat 2
would fail on beat 1's own output. So beat 1 invokes `transfer` on the **native
XLM Stellar Asset Contract**, which is a real Soroban `invokeHostFunction` and
produces exactly the meta the extractor reads. This also means the demo
exercises the same SAC transfer-event shape `readMovements` parses, which is the
path most worth proving.

### 2.2 State

`sessionStorage`, one key, `{ version, beat, hash }`. Resume restores the beat
index and re-runs beats 2–5 from the hash.

Per §0: **the persisted shape holds no derived values.** No proposal, no cap, no
policy, no XDR. A test asserts the persisted object's keys against an exact
allowlist, so adding `proposal` to it fails CI.

`version` lets a shape change invalidate old state instead of crashing on it.

### 2.3 Failure

Each beat can fail independently and says so in place, with a retry. A failed
beat 1 (demo account unfunded, rate-limited, RPC down) states which and offers
*"skip to beat 2 with a preset"* so the rest of the stepper is still reachable —
labelled as a preset, never presented as the reviewer's own transaction.

---

## 3. Demo keys, fenced in code

### 3.1 The fence

`apps/web/src/lib/demo-signer.ts`:

- First line of module body: `import 'server-only';` — a build-time error if the
  module is ever reached from a client component, rather than a runtime one.
- Reads `LIMEN_DEMO_SECRET` (a testnet seed) from the environment. Server-side
  only; never `NEXT_PUBLIC_`, never returned in a response, never logged — the
  same discipline the waitlist route already applies to email addresses.
- **Hard throw on any passphrase that is not `Networks.TESTNET`.** Not a config
  flag, not a warning, not a conditional. The module refuses to construct a
  signer at all:

  ```ts
  if (passphrase !== Networks.TESTNET) {
    throw new Error(`demo signer refuses non-testnet network: ${passphrase}`);
  }
  ```

  A unit test asserts the throw for mainnet's passphrase and for an arbitrary
  string.
- The signer signs **only** transactions it built itself, from a fixed
  template — a SAC `transfer` of a fixed small amount to a fixed destination.
  It does not expose "sign this XDR." There is no input from the browser that
  changes what gets signed; beat 1 takes no parameters.

### 3.2 Proving the fence in CI

A grep that can never match proves nothing, so the check is two-sided:

```yaml
- name: Prove the demo signer is absent from the client bundle
  run: |
    # The sentinel must exist in the server output — otherwise the negative
    # check below passes vacuously and proves nothing.
    grep -rIq "$SENTINEL" apps/web/.next/server \
      || { echo "sentinel missing from server bundle; this check is vacuous"; exit 1; }

    if grep -rIl -e "$SENTINEL" -e 'LIMEN_DEMO_SECRET' apps/web/.next/static; then
      echo "demo signer code reached the client bundle"; exit 1
    fi
```

`SENTINEL` is a fixed string constant in `demo-signer.ts`, present for exactly
this purpose and commented as such. The positive assertion is the part that
makes the negative one mean something.

### 3.3 The account — **[V2-D2]**

The demo account is disposable and holds trivial funds. Compromise is
uninteresting by design, and the README says so under its own heading, next to
the existing "no code path in this repo can move user funds" statement — which
**needs amending**, since beat 1 introduces exactly one such path. It moves the
*demo account's* funds, never a user's, and the README must say that precisely
rather than keeping a claim that is no longer strictly true.

The open question is concurrency: one shared account has one sequence number,
so two reviewers pressing beat 1 at the same moment produce a `tx_bad_seq` for
one of them. Options are in §8.

Rate limit beat 1 harder than ingest — it spends real (testnet) money and takes
a lock. Suggested: 1 per IP per 5 minutes, plus a global ceiling.

---

## 4. Refusal as a visible state

`synthesize` throws `SynthesisError` with a closed code set already:
`no_invocations`, `invalid_amount`, `invalid_window`, `invalid_headroom`,
`policy_limit_exceeded`, `not_expressible`. `PolicyReview` renders that today as
one red line: `Synthesis refused this transaction — {code}: {message}`.

That reads as a crash. It is the opposite — it is the system declining to guess.

Build `RefusalSection`, given the same visual weight as the deny table:

- **What was attempted** — the observed flow, summarised (contracts, functions,
  assets, ledger).
- **Why Limen refused** — the error code as a heading with a written
  explanation per code, not the raw message. For `policy_limit_exceeded`: *"This
  flow needs N policies. An OpenZeppelin context rule holds 5. Limen will not
  merge two limits into one looser limit to fit, because the merged limit
  permits transactions neither original permitted."*
- **What it did not do** — explicit: did not approximate, did not drop a
  constraint, did not widen a cap to fit. This is the sentence that turns a
  failure into evidence.

Third fixture, `over-limit.json`, reachable from the preset row and from the
demo page: six assets moving out, deriving six `spending_limit` policies, one
past `MAX_POLICIES`. It trips `policy_limit_exceeded` on a realistic flow rather
than a contrived one.

A core test asserts the fixture throws with that exact code, so the fixture
cannot silently stop demonstrating refusal.

Ingest refusals (§1.7) render through the same component — `no_invocations`,
`unreadable_movement`, and `ambiguous_attribution` are Limen declining to guess
in exactly the same sense, and should not look like network errors.

---

## 5. Visual weight

The landing is flat, not undecorated. Depth comes from structure.

- **Ground.** A very low-contrast ruled grid on the page background, via
  `repeating-linear-gradient` in both axes — roughly `--border-subtle` at low
  alpha, ~64px pitch. No gradient, no noise texture, no imagery, no SVG. It
  should be perceptible only as "the page has a floor," never as a pattern you
  can name.
- **Surfaces.** Content sits on `--surface` / `--surface-raised` — both tokens
  already exist and are currently underused — with existing border tokens and a
  1px rule, so sections read as sitting *on* the ground rather than being cut
  out of it. Shadows stay minimal to none; on a `#0a0b0d` background a shadow is
  nearly invisible and a border does the work.
- `.pin-entry` currently paints `background: var(--background)` because opacity
  is what makes the pinned occlusion read as replacement rather than blend. That
  must keep working: the entry surface stays fully opaque over the grid, so the
  grid belongs to the page beneath the stack, not to the entries.

**Untouched:** the type scale, the four-step contrast ramp
(`foreground`/`muted`/`muted-dim`/`faint`), the sans-vs-mono split, and the
PERMIT/DENY treatment including its non-hue redundancy. No new colours, no new
type sizes.

Guardrail: if it starts to look like a marketing site, it has gone too far. The
check is that every added rule is a border, a surface token, or a background
grid line — nothing else.

---

## 6. Verification

Nothing is called done until all of this holds:

1. `npm test` (52+, including new ones), `npm run lint`, `npm run build`, and
   `npm audit --omit=dev --audit-level=moderate` all green.
2. Every pre-existing caveat string present **verbatim** in rendered output — in
   particular `(shipped fixture — not observed on a live network)` and the
   README's evaluator-not-on-chain caveat. Asserted by test, not by eye.
3. The demo stepper completes end to end against real testnet, **twice, from a
   clean browser profile** — the second run proving nothing depended on warm
   state.
4. CI proves zero demo-signer code in the production client bundle, and proves
   the check is non-vacuous (§3.2).
5. A malformed hash (`zzz…`), a well-formed but nonexistent hash, a classic
   payment with no invocations, and a failed transaction each produce a clear
   structured error — **never a crash, never a fabricated
   `ObservedTransaction`.** One test per case.
6. `prefers-reduced-motion: reduce` still disables pinning, and the grid ground
   introduces no animation. The existing `(max-height: 619px)` fallback still
   lays out as stacked blocks.
7. §0 holds: the persisted-state key allowlist test passes, and no rendered
   number originates outside `synthesize()`.

---

## 7. Build order

1. **[V2-D1] resolved**, then `extract.ts`: three-way classification, structured
   `ExtractionError`, attribution change if (b). Tests against realistic meta
   shapes first — this is the trust-bearing change and everything else sits on
   it.
2. `/api/ingest`: structured errors, cache, shared rate limiter. Hash input in
   `PolicyReview`. Explorer link and the testnet marker.
3. `RefusalSection` + `over-limit.json` fixture + core test. Cheap, and it makes
   every later failure legible while building the rest.
4. `demo-signer.ts` + the CI fence, **before** any route uses it. The fence is
   worth more than the feature and must not be retrofitted.
5. `/api/demo/perform` and `/demo` — the stepper, beats 1–5, session state.
6. Visual weight pass.
7. README: live ingest, the demo account and its disposability, the amended
   "no code path can move user funds" claim, the updated caveat list.

Cut order if it slips: visual weight → demo stepper beat 1 (stepper starts at
beat 2 from a preset) → cache. **Live ingest and the fence are never cut** — they
are the two things that make this a product rather than a demo.

---

## 8. Decisions needed before step 1

- **[V2-D1] Attribution.** (a) hard-fail multi-invocation transactions, or
  (b) move `movements` to the transaction with an explicit `attribution` field
  and render the uncertainty? **I recommend (b)** — it removes the false claim
  without removing the swap, and provably changes no derived value. Costs a
  breaking `@limen/core` type change and a pass over all 52 tests.
- **[V2-D2] Demo account concurrency.** One shared account with a serialized
  in-process queue (simple; breaks under concurrent instances), or a per-session
  ephemeral account funded by Friendbot (no contention; slower first beat,
  Friendbot-dependent)? **I lean shared + queue + honest rate limit**, since
  reviewer traffic is low and Friendbot is a third-party dependency in the
  critical path of beat 1.
- **[V2-D3] Cache and rate-limit durability.** In-memory, matching the waitlist
  store's existing honesty caveat — or is a real backing store in scope for
  submission? In-memory is a `TODO(roadmap)` line; a real store is a new
  dependency and a deployment concern.
- **[V2-D4] Explorer.** `stellar.expert` as the link target — confirm, or name
  another.

---

## 9. What could go wrong

- **§1 is the real work.** Beats 2–5 of the stepper are wiring over code that
  already exists and is tested. Beat 1 and `extract.ts` are where the schedule
  goes, and `extract.ts` is where correctness goes.
- **Live testnet meta will surprise the extractor.** That is the point of
  building it first, and the reason step 1 leads with tests over realistic meta
  shapes rather than starting from the happy path.
- **Beat 1 is the only irreversible thing in the repo.** It submits a real
  transaction. It is fenced to testnet by a throw, signs only a fixed
  self-built template, takes no browser input, and is rate-limited — and it is
  still the piece to review hardest.
