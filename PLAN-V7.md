# PLAN-V7 — from a thing you can watch to a thing you can use

The engine does the whole job and the site does not say so. The hero's primary
action is *"See it derive one"*, which invites you to spectate, and the flow
behind it is four screens a person has to navigate themselves. This plan changes
what the product asks of a visitor. It changes nothing about what the product
claims.

**Nothing here relaxes a limit.** `TESTNET ONLY`, `NOT AUDITED`,
`COMPOSITION ONLY` and `NO CUSTODY` stay in the hero, before the argument. Every
string in `lib/status-labels.ts` survives verbatim, and the set stays closed.
Every figure stays read from `deployments/testnet.json` or
`generated/evidence.json`. Nothing on the site claims to be further along than
testnet and unaudited.

Branch: `v7-product`. Commit and push at every completed step.

---

## What is already there, and is not being rebuilt

Worth stating first, because most of this plan is composition rather than
construction.

| | |
| --- | --- |
| Create a smart account | `NewAccountScreen` — generate, friendbot ×2, `createCustomContract` |
| Give it a history | `AccountWriteSteps` — seed `G→C`, then the account's own `C→G` under the Default rule |
| Derive a boundary | `NewPolicyScreen` — `/api/ingest` → `synthesize` → `useLowering` |
| Install it | `InstallControl` — `add_context_rule`, rule id read out of the return value |
| Run the agent | `AgentRunSteps` — permitted, over-cap, agent-revoke, owner-revoke, repeat |
| Report a write | `WriteResult`, `Verdict`, `verdictFor` — including the `rule-revoked ≠ denied` distinction |
| Guard a write | `useWriteLog` — synchronous ref guard, per-step log, browser-stage vs ledger-stage failure |

All of it works from a browser with client-side signing. The capability is not
in question; the wayfinding is.

---

## 1. The links

Smallest, and missing from a live site.

- `https://github.com/dakshdrall/limen`
- `https://x.com/limennetwork`

**Header.** `components/site/SiteHeader.tsx`, in the right-hand cluster beside
`LedgerCounter` and the network label. Inline SVG glyphs with
`aria-label="Limen on GitHub"` / `aria-label="Limen on X"` — icons with
accessible names, never bare glyphs, never an icon font.

The header is one 48px row that already holds mark, wordmark, two nav links, the
ledger counter and the `TESTNET` label. Two more items at 390px is the case that
will overflow, and the layout gate is what decides it rather than a guess: if
`no page scrolls the body sideways` fails at 390, the wordmark drops below `sm`
before the icons do — the mark is the identity and the word is the redundancy.
Measured before and after, and recorded here.

**Footer.** There is no site footer. `app/page.tsx` carries an inline `<footer>`
— inside `<main>`, which is also wrong as a landmark — and `/docs` and `/app/*`
have none at all.

So: extract `components/site/SiteFooter.tsx` from that block, **with its status
labels and its sentence about generated figures carried over verbatim**, and
render it in `app/layout.tsx` under `{children}`. That puts it on every route,
which is what the brief asks for, and takes it out of `<main>`, which it should
never have been in.

Two columns beside each other: the existing documentation links (Documentation,
Simulator, Accounts — plus the new guided flow from §3) and a real column for
GitHub and X. External links reuse the `target="_blank" rel="noreferrer noopener"`
treatment `ExplorerLink` already sets; they are not explorer links and do not
borrow the permit-hued underline.

One consequence to state rather than discover: the footer used `className="scene"`.
It is now under both shells, so it takes `.screen` — the instrument's grid — because
furniture is not argument, and it will sit under `/docs` and `/app/*` more often
than under the narrative. The landing's footer gets visibly denser. That is the
right trade and it is a visible change.

**Checks.** `design-system.test.ts`'s shell rule scans `page.tsx` files only, so
a footer in the layout is fine. `/docs` and `/app/*` grow a footer they did not
have — every route gets re-measured by the layout gate at all five widths.

---

## 2. The profile picture

The mark is not being redrawn. Four rectangles in `lib/mark.ts`, a doorway on its
threshold stone, chosen from six candidates at 16/20/24/32/64px. `scripts/mark.mjs`
builds `icon.svg` and `favicon.ico` from it and `design-system.test.ts`
byte-compares both. None of that is touched.

An avatar is a different artefact from a favicon and needs its own builder.

**What is produced.** `apps/web/public/avatar-400.png` and
`apps/web/public/avatar-1000.png`. The mark centred on a filled square —
`GROUND.background`, ink `TEXT.foreground`, opaque throughout — because an avatar
is composited on a background nobody controls. Never transparency.

**Margin, and the arithmetic that keeps it crisp.** A favicon fills its box; an
avatar is cropped to a circle by every platform that shows it. The mark's
farthest ink is the sill's corner, `(22.5, 21)`, which is `13.83` grid units from
the centre.

The whole-pixel property that lets `mark.mjs` rasterise by arithmetic rather than
by a rendering engine is not negotiable, and it constrains the scale: every
coordinate is a multiple of `1.5`, so **the pixels-per-grid-unit scale must be a
multiple of ⅔ and the centring offset must be a whole number.** Starting values
that satisfy both:

| | scale | ink box | ink radius | circle radius | offset |
| --- | --- | --- | --- | --- | --- |
| 400px | 12 | 252 × 216 | 166 | 200 | 74, 92 |
| 1000px | 30 | 630 × 540 | 415 | 500 | 185, 230 |

17% clear inside the inscribed circle, identical geometry at both sizes. The
exact scale is settled by looking at it — at **48px and at 24px**, which is the
size it is actually seen at in a timeline — and if it wants to be smaller the
next legal step down is 10 and 25 rather than an arbitrary number.

**Encoding — and the one thing here that is a real finding.** `favicon.ico`
achieves exact reproducibility with *stored* deflate blocks, so no zlib version
can change its bytes. That buys about 9KB on a favicon and would cost about
**4MB** on a 1000×1000 RGBA image, which is not a thing to commit.

The RGBA constraint was never about the image: it exists because Next's ICO
decoder rejects a non-RGBA PNG inside an `.ico`. A standalone PNG in `public/`
has no such consumer, and this image has exactly two colours. So the avatars are
**colour type 3, one bit per pixel, two-entry palette, stored deflate** — still
byte-exact, still no image library, and ~21KB and ~126KB instead of 640KB and
4MB. `chunk`, `stored`, `crc32` and `adler32` are reused unchanged; the additions
are a `PLTE` chunk and a bit-packed row builder.

One bit per pixel is lossless here *only* because every edge lands on a whole
pixel. That is an assumption, so it becomes a fence: if `rasterise` ever produces
fractional coverage at an avatar size, the builder throws rather than rounding.
A silently anti-aliased avatar is the drift this whole module exists to prevent.

**Pinned.** Both files join the `files` array in `mark.mjs`, so `npm run mark:check`
covers them, and `design-system.test.ts` imports the builders and byte-compares
them — the same arrangement `icon.svg` and `favicon.ico` already have, so the
avatar cannot drift from the favicon the way the OG card's colours once drifted
from the palette.

---

## 3. `/app/try` — one guided flow

The capability is there and the wayfinding is not. Today a person clicks through
`/app/accounts/new` → `/app/accounts/[id]` → `/app/policies/new` →
`/app/policies/[id]`, and at each boundary works out what happens next for
themselves.

**New route.** `app/app/try/page.tsx` — server component, `.screen` shell,
`ScreenHeader` with `['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']`,
rendering one client orchestrator `components/app/TryFlow.tsx`.

`SiteHeader`'s `SECTIONS` gains a `Try` entry. `design-system.test.ts` already
checks that every `built: true` section points at a route that exists.

### 3.1 The six steps

1. **Get set up.** One button. Generate both keys, friendbot the owner, friendbot
   the agent, `createCustomContract`, then seed the smart account `G→C`. Five
   calls, reported one at a time as each lands.

   The brief says "both accounts funded, the smart account deployed" — note that
   the smart account can only be funded *after* it is deployed, so this step is
   five things and not four. It says so.

2. **Do something worth bounding.** The account's own `C→G` transfer under the
   Default rule, authorized through `__check_auth`. The screen says this is the
   transaction the boundary gets derived from, before it happens.

3. **See the boundary.** `synthesize` on the transaction read *back from the
   network* — never the amount this screen sent — then `useLowering`. `PolicyTable`
   for what Limen derived, `InstallPlanTable` for what would actually be written.
   Beside it, plainly, what this now refuses.

4. **Install it.** One signed call. `add_context_rule`, rule id read out of the
   return value.

5. **Watch the agent.** Spend inside the cap: permitted. Spend over it: refused
   by the network, with a hash. Revoke as the agent: refused too.

6. **Take it back.** Owner revokes, then the agent repeats the call that worked.
   It stops working, and it fails for a *different reason* than being over the
   cap — `ContextRuleNotFound#3000` is deliberately outside
   `BOUNDARY_REFUSAL_CODES` and gets its own verdict state.

### 3.2 The rules that make it usable rather than merely sequential

- **One action visible at a time.** Step *n+1* renders only once step *n* has
  landed. Never six buttons.
- **Always answer "where am I and what just happened".** `Step 3 of 6`, the
  step's own sentence, its hash. `WriteResult` already renders a `running` state
  carrying its `what` string — there is no spinner without a sentence beside it,
  and none is introduced.
- **A failed step is a state, not a dead end.** `WriteResult` verbatim. It
  already distinguishes `stage: 'browser'` from `stage: 'ledger'` — *was the
  network even asked* — which is exactly the distinction the brief wants and is
  more than a friendlier replacement would say. Step 1's button becomes "retry
  from here" rather than "start over", because re-funding a funded account
  reports success for a request that did nothing.
- **Every step keeps its provenance label.** `ON-CHAIN` for what the network
  answered, `COMPUTED LOCALLY` for the derivation and the lowering. There is no
  shipped fixture anywhere in this flow — the fixtures live in the simulator — so
  the flow says that rather than carrying a label it does not use.

### 3.3 Resumable

A reload picks up where it left off. What decides that:

- **The chain decides what is true.** `useAccountSnapshot` answers whether the
  account exists, whether a non-Default rule is installed, what its cap is, and
  whether it has been revoked. Steps 4, 5 and 6 resume entirely from that. No
  cursor is stored and none is trusted.
- **The one thing the chain cannot answer** is *which* transaction this flow
  observed, between steps 2 and 3. `store.ts` holds pointers and derivation
  provenance and deliberately holds no claim about chain state; the observed
  hash is exactly that shape, so `StoredAccount` gains `observedTxHash?: string`,
  written the moment step 2 lands.

  **That is a bookmark, not an answer.** On resume the hash goes through
  `/api/ingest` and the derivation comes from what the ledger recorded — the same
  path `/app/policies/new` already takes from `?tx=`. The stored value never
  reaches a cap.

  The alternative — scan the account's own events for its outgoing transfer, the
  way `ActivityScreen` does — is genuinely storage-free and was rejected on the
  retention window: public RPC event history is a few days, so an account created
  last week resumes as a read failure. If you would rather pay that cost for a
  flow that stores nothing at all, this is the line to change; it is a small one.

### 3.4 Do not fork the logic

The four existing screens stay. They are the reference view — read any account,
inspect any policy — and `/app/try` is the path. If the two hold separate copies
of the write logic, one of them starts lying.

But the existing components are screen-shaped: each owns its own `useWriteLog`,
its own `Section` chrome and its own copy. Mounting all four on one route is four
screens stacked, which is what this plan exists to stop.

So the seam is drawn under the UI rather than through it:

- **`lib/chain-actions.ts`** — every write the product makes, as functions over
  `{ chain, keys, … }` returning `SubmitResultLike`, so each drops into
  `log.run(...)` unchanged: `deployAccount`, `fundSmartAccount`,
  `observedTransfer`, `installBoundary`, `agentSpends`, `agentSpendsOver`,
  `agentRevokes`, `ownerRevokes`, `agentRepeats`, plus `prepareRun` and the
  `PermittedCall` type carrying the borrowed footprint.
- **`lib/verdict.ts`** — `verdictFor`, lifted out of `AgentRunSteps`.
- The presentational layer is reused as-is: `WriteResult`, `LocalKeyBadge`,
  `Verdict`, `StatusLabel`, `PolicyTable`, `InstallPlanTable`, `ObservedSection`,
  `RulesTable`, `Address`, `ExplorerLink`, `ScreenState`.
- `NewAccountScreen`, `AccountWriteSteps`, `InstallControl` and `AgentRunSteps`
  are rewritten to call `chain-actions.ts`. Their markup and their copy do not
  change.

`/app/try` writes its own step captions, because a guided flow's register is not
a reference screen's. Any *claim* — the borrowed-footprint explanation, the
step-05 distinction, "there is no form here that accepts a secret key, and there
will not be one" — is stated in the same words and imported rather than
paraphrased.

**The honest note about checking this refactor.** It is a behaviour-preserving
extraction across four files whose only end-to-end check is
`e2e/account-lifecycle.spec.ts`, which submits real testnet transactions and is
deliberately not in CI. The unit suites do not cover it.

So it runs **twice: once before the extraction and once after**, and both results
are reported. A green run against an unknown baseline proves less than it looks
like — if that suite is already red for an unrelated reason, a green "after" is
the more suspicious of the two outcomes, and there would be no way to tell.

#### 3.4.1 What was actually run, and how strong each half is

The two halves of that check are **not equally evidenced**, and the difference is
recorded here rather than averaged away.

**The "before" run — a prior session's report, not an artifact.** The session
that wrote the extraction ran the suite first, against the pre-built
pre-extraction server, and reported it green: a real baseline, not an unknown
one. That record was written to the scratchpad and the scratchpad did not
survive. So what this plan can show is *a report of a prior session's report*.
Nobody later should read "baseline green" as something this repository can
produce on demand — it cannot. The claim is believed and it is unbacked, and
those are different words on purpose. Re-establishing it would cost eleven more
testnet submissions to convert a credible report into a file, which was weighed
and declined.

This is the third artifact lost to the scratchpad. Results that a later reader
will need go in this file or in `deployments/testnet.json` — somewhere versioned
— and the scratchpad holds only what is disposable within the session.

**The "after" run — at `865bb11`, green.** Run 2026-08-15 against a fresh
`next build` at that commit, one test, no retries, 1.7 minutes:

```
1 passed (2.0m)
✓ a browser creates an account, installs a boundary, runs an agent inside it,
  and takes it back
```

The `RUN RECORD` it emitted, which is the machine-readable half:

| field | value |
| --- | --- |
| `smartAccount` | `CDTL3MY5UVIVJMMCJORL3QPXUTXIYWY4RKH24ZCZANTVO7KSWPCCQANU` |
| `ownerSigner` | `GDR7DA7K6K6WWHWVOB7K7OU5UCYTNMWPAXV7PNXSA2ICXS7QURSGGJO2` |
| `agentSigner` | `GDTD3W3YFGUROBEQHS2L5MURD4NFRQMQO5PL2XVE5ST5FRGG54UZHGNW` |
| `deployTx` | `245973f5e33e65a8b6af31615580f4220138a777f5f4802e9b8fcbcaed3e1e90` |
| `seedTx` | `3e5c27d55721bb0ae44eda6673a6400c992fd4f9cd1f5fbfb85c357623ba3d33` |
| `observedTx` | `4219a6a80f8ba0158f5047e2c1c0806a7656494a56eee001bfdb058c5c4be4d1` |
| `installTx` | `99970322ba2e5db35ea07b20854ae46b25ca2a4979855a70bc342352ec4055e3` |
| `contextRuleId` | `1` |
| `permittedTx` | `f67038e92f8192b69d608172db10f23aabf69ac06bd783d2e266ebaf05355007` |
| `refusedTx` | `00c1678e669e161de69937b06c66cbbf838d71019df39cfad263b81e15233e77` — `SpendingLimitExceeded#3221` |
| `agentRevokeTx` | `5d58fdae37319177522e646370a6b670b08b97396e19d8f970a200781ff72c5a` — `UnvalidatedContext#3002` |
| `revokeTx` | `3c00226257d6698ead541b7d4038ecd1bdef11674c02f9b1402f6efd5a84e501` |
| `postRevokeTx` | `20365aad3eca7bb9670fbe3b91d160916d32183a88d723ffe19a057854afadff` — `ContextRuleNotFound#3000` |

The three refusals decoded to three *different* codes, which is the part that
actually exercises the extraction: over-cap refused as `SpendingLimitExceeded`,
the agent's own revoke refused as `UnvalidatedContext`, and the post-revoke call
failing as `ContextRuleNotFound` — a different reason, not the same wall twice.
Every deny step asserted a hash as well as a code, so none of it is a refusal
inferred from an absence.

**Why this block is here and not in `deployments/testnet.json`.** That file is
the canonical home for browser-run hashes and has `verify-browser-run.mjs` to
re-check them against Horizon from outside the process — it is the better home.
It also lives under `packages/`, and this plan's closing invariant is that
`git diff` against `packages/` is empty through step 4. Transcribing it there is
a one-line judgement call that belongs to whoever holds that invariant, so it is
recorded here and flagged rather than taken. The run is reproducible from the
hashes above either way.

#### 3.4.2 What the suite covers, and what it does not

`account-lifecycle.spec.ts` drives the **four reference screens** and only those:
`/app/accounts/new` → `/app/accounts/[id]` → `/app/policies/new` →
`/app/policies/[id]`. The string `/app/try` does not appear in the file.

So a green run says the extraction is behaviour-preserving **along the path the
reference screens take through it**. `/app/try` reaches the same
`chain-actions.ts` functions by a different path — its own ordering, its own
gating, its own resume-from-chain logic — and no automated check drives it. A
green run here must not be read as covering the flow, because it does not touch
it.

That gap is closed by hand on the preview, not by this suite.

### 3.5 The layout gate

`/app/try` joins `ROUTES` in `e2e/viewports.spec.ts`. A new route outside that
list is a route nothing measures.

CI's server pins the RPC empty, so the flow must render a designed arrival state
there rather than a crash. It carries no numbers on arrival, which
`NOT AUDITED` in the `ScreenHeader` satisfies — the same way `/app/accounts/new`
already does.

---

## 4. The front door

Once there is something for it to point at.

`app/page.tsx`, the hero's `SceneBlock index={1}`:

- **Primary** — the register of *"Try it on testnet"*, written fresh, pointing at
  `/app/try`. Not at the simulator.
- **Secondary** — Read the docs, unchanged.
- Under them, one line naming what it costs: real testnet transactions, funded by
  friendbot, no real money anywhere.

The simulator stays and stays linked — as the thing you reach for when you do not
want to spend a friendbot call — but it stops being the front door, because a
person who lands on it concludes this is a demo, which is exactly what happened.
It moves to a `quiet` control beside the two, and keeps its place in the footer.

Scene 07, "What you get back", and the footer nav both point at the flow.

---

## 5. Passkeys, script-proven first

A wallet cannot be an owner signer, and that is measured rather than assumed: a
wallet can only be `Delegated`, whose nested authorization requirement is raised
inside `__check_auth` and appears in neither simulation. That finding is in the
README and it stands.

**WebAuthn has none of that problem.** The verifier is deployed
(`CCC4T3F7…`, upload `268dc7fc…`) and unused. `External` hands raw bytes to a
verifier contract and a passkey produces a signature. `authPayload`'s `signers`
map is `Map<Signer, Bytes>` — the shape is already general enough; only the
contents differ.

### 5.1 The script, on the F4 model

`packages/chain/scripts/acceptance.mjs webauthn`, before any UI exists.

1. Deploy a smart account whose owner is `External(webauthnVerifier, key_data)`,
   where the key is a secp256r1 keypair from `node:crypto` — a **synthetic
   authenticator**. This proves the contract side without a browser, which is the
   half that can actually refuse.
2. Sign an auth entry: compute `authDigest`, base64url it as the WebAuthn
   challenge, construct `clientDataJSON` and `authenticatorData` exactly as an
   authenticator would, ECDSA-P256-sign
   `sha256(authenticatorData ‖ sha256(clientDataJSON))`, encode the verifier's
   signature struct into the `Bytes` value.
3. Submit a transfer from that account and confirm it lands.
4. **A control case**, because F4's first version asked the wrong question and
   got a confident answer to it: the same submission with a challenge that does
   *not* match the digest must be refused. A green result that cannot fail proves
   nothing.

### 5.2 What is unknown, and is read rather than guessed

- the `key_data` encoding the verifier expects — 65-byte uncompressed SEC1, raw
  64, or compressed;
- the signature struct's field names and whether the signature is `r‖s` or DER;
- whether low-S normalisation is required;
- whether `clientDataJSON` is parsed for `type` and `origin` or only for the
  challenge.

All four come out of `OpenZeppelin/stellar-contracts` at the pinned tag `v0.7.2`,
commit `a9c42169`. That source is not vendored here — this repo pins wasm hashes,
not Rust — so **this step needs the source at that commit**, either fetched or
from a local checkout. Worth knowing before it starts.

#### 5.2.1 Answered, 2026-08-15

The source was fetched at `a9c42169` and checked against the deployed verifier's
own contract spec, read off the wasm the live contract actually runs. They match
function-for-function and error-code-for-error-code, so the checkout is a
faithful guide to the deployed artifact rather than a hopeful one.

1. **`key_data`** — 65-byte uncompressed SEC1 (`0x04 ‖ X ‖ Y`), optionally
   followed by a credential id, which `canonicalize_key` slices off. Not raw-64,
   not compressed.
2. **The signature struct** — `WebAuthnSigData { authenticator_data, client_data,
   signature }`, and the shape is the part that would have been guessed wrong:
   it is **XDR-encoded and carried in a single `Bytes` argument**, not passed as
   struct fields. `signature` is a raw 64-byte `r‖s`. Never DER.
3. **Low-S** — **required**, and measured rather than reasoned about: the same
   assertion signed in high-S form was refused on a ledger by the host, not the
   contract, with `ECDSA signature 's' part is not normalized to low form`.
4. **`clientDataJSON`** — parsed for exactly `type` (must be `webauthn.get`) and
   `challenge`. Origin is **not** validated, and neither is `rpIdHash`; both are
   documented omissions in the contract, left to the authenticator.

**Three the list did not have, all of which would have cost a debugging cycle:**

- The challenge is base64url of the account's **`auth_digest`**, not the host's
  `signature_payload`. `storage.rs::authenticate` hands the digest to the
  verifier. §5.1 step 2 guessed this right; it is now read.
- `authenticator_data` must be ≥ 37 bytes and its flags byte at offset 32 must
  have **UP (`0x01`) and UV (`0x04`) both set**. An authenticator that does not
  verify the user is refused outright — a policy decision baked into the
  verifier that nothing in §5 anticipated.
- **`signAs` could not have signed a passkey assertion at all.** It called
  `signer.sign()` synchronously. `crypto.subtle` is async and so is
  `navigator.credentials.get`, so the interface excluded every signer that is
  not an in-memory secret key. Widened to allow a promise, which is a no-op for
  the existing ed25519 callers.

#### 5.2.2 The result

The script works: `packages/chain/scripts/acceptance.mjs webauthn`. A smart
account owned by a passkey authorized a transfer that landed, a mismatched
challenge was refused on a ledger with `ChallengeInvalid#3114`, and the high-S
control was refused beneath the contract. Hashes are in
`deployments/testnet.json` under `webauthnRun`.

Two things it does **not** establish, recorded here so the green does not spread
further than it reaches. The authenticator is **synthetic** — a WebCrypto P-256
key producing the bytes an authenticator would, with no hardware, no user
gesture and no biometric anywhere. And it is **Node, not a browser**: whether
`navigator.credentials.get` returns an assertion this verifier accepts is
exactly what §5.4's UI would test, and §5.4 is not built.

> **Closed 2026-08-15 by §5.4.2.** The second of those is no longer open: a real
> Chrome WebAuthn assertion has been accepted by the deployed verifier, driving
> the shipped UI. The first — a *physical* authenticator — is still open and is
> restated precisely there. This paragraph is left as written rather than edited,
> because what it said was true when it was written and the record of a gap
> being closed is worth more than the appearance of never having had one.

`node:crypto` was named in §5.1 and deliberately not used: `acceptance.mjs`
forbids `node:` imports and `browser-path.test.ts` enforces it. WebCrypto also
emits IEEE-P1363 `r‖s` directly rather than DER, which is the encoding the
verifier wants.

### 5.3 If it does not work

Stop and report the finding. Write it up in the README beside "Why there is no
wallet button", with the failing output, what was reached, and what remains. Do
not build around a gap. "We did not get to it" and "we tried it and the platform
does not support it" are different statements.

### 5.4 If it does work

- **The browser-key path stays the zero-friction default.** A reviewer with no
  passkey must never hit a wall. Passkey is offered *beside* it, on step 1 of
  `/app/try` and on `/app/accounts/new`.
- **Labels.** A passkey owner has no local key, so `TESTNET ONLY · LOCAL KEY`
  must not appear against it — it would be a label that stopped applying. A new
  member of the closed set in `lib/status-labels.ts`, with its own sentence.
- **And the part that must not be soft-pedalled.** A passkey cannot be handed to
  an agent, so the *agent* key on a passkey account is still a generated ed25519
  key in browser storage, still carrying `TESTNET ONLY · LOCAL KEY`. The passkey
  protects the owner, not the agent.

  **This goes on screen, not only in this plan** — wherever a passkey account is
  created and wherever one is used, in the register of:

  > Clearing site data no longer strands your account. It still destroys the
  > agent key, and with it this browser's ability to act as the agent.

  The gain is real and it is the whole of the gain. A passkey account that let a
  reader infer their agent key was safe too would be this plan's own version of
  the caveat that stopped applying.
- `local-key-label.test.ts`'s tripwire is extended deliberately to cover the new
  module rather than being satisfied by the passkey path simply not matching its
  detectors.

#### 5.4.1 Built, 2026-08-15

`lib/passkey.ts`, `lib/use-passkey.ts` and `components/app/PasskeyOwnerControl.tsx`,
offered on step 1 of `/app/try` and on `/app/accounts/new`. The browser key is
the default on both, and a browser without WebAuthn gets a sentence saying the
default is unaffected rather than a disabled control with no explanation.

**The shape the contract forced, which is narrower than §5.4 assumed.** A
passkey replaces the *owner signer* and nothing else. It cannot pay a Stellar
fee and cannot be handed to an agent, so a passkey-owned account still has both
local ed25519 keys in this browser: `OWNER` is the fee source and signs every
envelope, `AGENT` is what the boundary is installed against. `chain-actions.ts`
gained one `ownerAuth(keys)` seam that decides verifier and signer together —
four call sites each deciding would eventually produce an account whose owner is
a key that cannot sign for it.

So the on-screen caveat is the plan's sentence plus the half the plan did not
have: the fee key. Both sentences are constants in `key-roles.ts`
(`PASSKEY_KEEPS_ACCOUNT`, `PASSKEY_STILL_LOCAL`) and a test asserts that any file
rendering the first also renders the second — the gain without the limit is the
reassurance this project exists not to give.

**Which owner an account has is read from the chain**, not remembered. The
Default rule names its verifier, so `WEBAUTHN_VERIFIER` in that position is the
answer; a React state would be lost on reload and step 4 would then sign with
the wrong key and be refused for a reason nobody could see. Ownership is
compared against the whole `key_data` — the credential id included — because the
contract stores it verbatim and `canonicalize_key` is used only for duplicate
detection. That is the same class of bug as the `G…`-versus-hex comparison in
V6, so `Passkey` carries both forms rather than deriving one at a call site.

**The tripwire.** `USES_A_PASSKEY` matches `navigator.credentials.create/get`
and `PublicKeyCredential`, because `GENERATES_A_KEY` matches nothing in the
passkey path — no secret of the user's exists in this application at any point,
which is the whole difference between this and the design-rule-3 narrowing. Four
new assertions: the passkey label satisfies neither obligation the local key's
label satisfies and vice versa; every file creating, using or importing a
passkey names `PASSKEY_LABEL`; and the scan is non-vacuous, so the day the
passkey path is deleted or renamed the test says so rather than passing forever.

#### 5.4.2 The browser gap, closed — and measured rather than assumed

`e2e/passkey-owner.spec.ts`, on demand, out of CI. It submits testnet, so it
lives under the on-demand config beside `account-lifecycle.spec.ts`; the `@ci`
tag is for suites that spend nothing, and this file does not carry it, so
`playwright.ci.config.ts` cannot reach it by construction.

A real Chrome WebAuthn assertion owned an account and signed for it, through the
shipped `/app/try`: four transactions, two of them authorized by the passkey and
nothing else, and the spec asserts no assertion was requested before the deploy —
because a smart account authorizes nothing at its own creation, and a signature
requested there would mean the two that follow proved less.

**The point was never the green tick.** `lib/passkey.ts` has two pieces of code
the §5.1 script could not reach — DER unpacking and low-S normalisation — and a
virtual authenticator that emitted P1363, or only ever chose a low `s`, would
have passed this spec without touching either. That is the hollow gate again in
a new place, so the spec measures instead of assuming:

- **DER unpacking: exercised.** 2 of 2 assertions were ASN.1 DER and both were
  accepted on a ledger. An unconverted signature would have failed
  `secp256r1_verify`.
- **Low-S normalisation: exercised.** 1 of the 2 carried a high-S signature and
  landed only after normalisation.
- **The instrument, checked before it was trusted.** 16 free assertions taken
  straight from the authenticator first: 16 of 16 DER, 9 of 16 high-S. That is
  what makes a future run reporting "no high-S this time" mean *not exercised*
  rather than *this authenticator cannot produce one*.

The classification is arithmetic written out again in the spec rather than an
import of `rawSignature` — the same argument `verify-browser-run.mjs` makes about
not reusing `contractErrorCodes`.

**Deliberately not deterministic.** At ~56% high-S per assertion and two per run,
roughly one run in five will see none. The spec *reports* which paths it
exercised rather than asserting it exercised them: failing a correct
implementation at random is worse than a run that says plainly what it did not
reach.

**What is still open**, narrowed rather than dropped: a *physical* authenticator.
This is Chrome's virtual authenticator over CDP — a real WebAuthn implementation
producing real DER assertions, and not a hardware key, a biometric, or a human
touching anything. What remains unknown is whether some particular vendor's
authenticator sets flags or encodes signatures in a way this path mishandles.

**And one finding.** WebAuthn refuses an IP-literal origin — a Relying Party ID
must be a registrable domain — so `navigator.credentials.create` on
`http://127.0.0.1:3000` fails with `SecurityError: This is an invalid domain`
before any authenticator is consulted. **The passkey owner path cannot work
anywhere the application is reached by IP.** `localhost` and a real domain are
the two origins where it functions at all.

### 5.5 The one place this plan departs from a stated invariant

*"`git diff` against `packages/` is empty"* is in the brief's closing list, and
§5 cannot be done without adding to `packages/chain`: a script subcommand, and if
it works, a signer module.

The reading taken here is that the invariant protects the engine from being
*changed* — it came out of a rebuild that deleted and rewrote `apps/web` — and
that an addition which alters no existing file's behaviour and leaves every
existing suite green is not that. **Steps 1–4 leave `packages/` untouched
entirely.** Step 5 does not, and this is flagged rather than quietly resolved: if
the invariant is meant literally, step 5 stops at the script and ships nothing.

---

## 6. The failure surface — a boundary, a 404, and a reporter

Added after §5.4, and argued from it. The React #418 on `/app/accounts/new` sat
on a live screen through a release and was found only because a listener had
been attached for an unrelated reason. Two separate gaps produced that, and they
need two separate answers:

- **Nothing designed was in front of a failure.** Next's own default is a black
  page reading `Application error: a client-side exception has occurred`, and
  the 404 was Next's too. `app/error.tsx` and `app/not-found.tsx` replace both,
  in the design system, saying what failed, that it was not the reader's fault,
  and where to go. The error page also says whether a write may have landed —
  a page that failed to draw does not know, and telling somebody to "try again"
  without that is telling them to submit a second transaction.
- **Nothing was listening.** `instrumentation-client.ts` attaches the window
  listener. This is the half that catches the #418 class and the error boundary
  is not: a hydration mismatch is *recoverable*, React re-renders on the client,
  nothing throws past a component, and no boundary is ever entered. React's
  default `onRecoverableError` calls `reportError()`, which dispatches an
  `error` event on `window`. That event is the entire trace such a bug leaves.

### 6.1 An allowlist, not a scrub

No user data in a report: no addresses, no hashes tied to a person, no key
material. `REPORT_FIELDS` in `lib/report.ts` is the whole set of eight fields
that may leave the browser, and `serializeReport` copies those keys and no
others — a field nobody added cannot leak. `lib/redact.ts` then runs over the
three that are free text, because free text is where an address arrives without
anyone adding a field for it.

Both are needed and neither subsumes the other. An allowlist alone ships
`/app/accounts/CDLZ…`, since the path is a field somebody legitimately added; a
redactor alone leaves the next field's author to remember. `redactPath` is the
join: the query and fragment are **dropped entirely** rather than redacted,
which is the only treatment that is correct for a parameter nobody has thought
of yet.

This is why no SDK was installed. `@sentry/nextjs` captures full URLs in
breadcrumbs by default, `/app/accounts/[id]` and `/app/policies/[id]` have
addresses in the path, and a `beforeSend` test would pin one surface out of
several — a rule enforced against the wrong surface, which is the failure this
repository keeps finding. Zero new dependencies, so the `--audit-level=low` gate
is untouched.

`test/report.test.ts` pins it on the CI bundle-fence model: every removal case
first asserts the fixture is the shape it claims to be, because a redactor
tested against values that were never the right shape removes nothing and
reports success. The opposite risk is pinned too — `Minified React error #418`
and an 8-character chunk hash must survive, or the report is not worth sending.

### 6.2 A defect the test found

The email pattern was written with unbounded `+` quantifiers and is quadratic
on a subject with no `@` in it: 20,000 characters took 492ms and 50,000 never
finished. It matters because the length caps are applied *after* redaction —
truncating first could cut an address in half and leave an identifying prefix —
so the redactor is the thing that sees the whole untruncated stack. Every
quantifier is now bounded by the limits in RFC 5321. The file went from 6.2s to
70ms.

### 6.3 Verified, on a fresh production build

Bundle fences first: `LIMEN_ERROR_WEBHOOK` does not appear in
`apps/web/.next/static`, so the credential stays server-side; the four existing
greps are unaffected.

In Chromium against `next start`:

| what | result |
| --- | --- |
| `reportError()` — the API React's `onRecoverableError` calls | reported, `kind: window` |
| unhandled rejection carrying a `C…` address | reported as `read failed for [address]` |
| a broken `<img>` — bubbles `error` with no thrown value | **nothing reported** |
| eight distinct errors against a five-per-page budget | five reported |
| the same error three times | one reported |
| a server render throw, on a temporary route since removed | boundary rendered; `kind: boundary`, `digest 390029501` |

The digest in that last report matches the one in the server log, so the join
key to the unminified error works as documented. Next redacts the server
message itself in production, which is what makes the digest the field worth
carrying.

Against the route with a hostile body — a raw address, a seed in the query, and
`ip`, `cookies`, `localStorage` and `breadcrumbs` alongside — the server
returned 204 and logged:

```
{"kind":"window","message":"Minified React error #418; hydrating [address]",
 "stack":"at read ([key])","path":"/app/accounts/[address]",
 "userAgent":"Mozilla/5.0 Test"}
```

The four unlisted fields were never read; the query carrying the seed is gone
entirely; `#418` survived.

`/no-such-page` is now in `ROUTES` in `e2e/viewports.spec.ts`, so the 404 is
under the layout gate at all four widths — it is the one page nobody will
remember to look at. 544 tests, lint, build, `evidence:check`, `mark:check`,
audit and `e2e:ci` all green.

## Sequence

Each step ends with the full suite, `lint`, `build`, `evidence:check`,
`mark:check`, both bundle fences and `e2e:ci` green locally, then a commit and a
push.

1. **The links.** Smallest, and missing from a live site.
2. **The profile picture.**
3. **`/app/try`** — in two commits: the `chain-actions.ts` extraction with no
   behaviour change, then the flow built on it.
4. **The front door**, once there is something for it to point at.
5. **Passkeys**, script-proven first, or reported as a finding.

## What must still be true at the end

- Every string pinned by the caveat and design-system tests survives verbatim,
  and `STATUS_LABELS` stays a closed set.
- The four status labels are in the hero, before the argument.
- `git diff` against `packages/` is empty through step 4. See §5.5 for step 5.
- No page scrolls the body sideways at 1440, 1280, 1024, 768 or 390 — including
  `/app/try`, which is added to `ROUTES`, and including every route that now has
  a footer it did not have.
- Usable with reduced motion and with JavaScript slow.
- Full suite, lint, build, audit gate, both bundle fences and the layout gate
  green.
- The avatar is generated from `lib/mark.ts` and pinned by `mark:check` and
  `design-system.test.ts`, so it cannot drift from the favicon.
- Nothing on the site claims to be further along than testnet and unaudited.
