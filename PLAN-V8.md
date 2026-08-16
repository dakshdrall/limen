# PLAN-V8 — from a permission layer to an agent platform

**Status: proposal. Nothing in this plan has been implemented. No file outside
this one has been touched.**

The repository was inspected, the full suite was run green (544 tests, 25 files,
matching `apps/web/src/generated/evidence.json` exactly), and the findings below
are read off the code rather than recalled from the plans that preceded it.

---

## 0. The one sentence this plan turns on

Limen stops being *the permission layer for agentic money* and becomes *a
platform for creating, deploying and using autonomous AI agents on Stellar,
whose agents are bounded by that permission layer*.

The permission layer is not being replaced. It is being demoted from **the
product** to **the differentiator** — which is a promotion in every sense that
matters, because it stops being a thing that has to be explained and starts
being the reason the thing works.

And it changes exactly one load-bearing fact, which §3 answers outright:

> An agent that answers a Telegram message signs while nobody's browser is open.

Everything else in this document is downstream of that sentence.

---

# PART I — THE AUDIT

*Brief §45, items 1–17. Read from the tree at `9a1ddf4`.*

## 1.1 Current frontend architecture

Next.js **16.2.12**, App Router, React 19.2.4, TypeScript, Tailwind v4. One app,
`apps/web`. No state library, no data-fetching library, no component library.

`apps/web/AGENTS.md` carries a standing instruction that matters for every line
of new code here: *this is not the Next.js you know — read
`node_modules/next/dist/docs/` before writing any code*. That directory exists in
the tree (`01-app`, `02-pages`, `03-architecture`, `04-community`) and every
implementation milestone below inherits that obligation.

**Routes.** `/` (landing, 506 lines, static), `/docs` + three subpages,
`/app/accounts`, `/app/accounts/new`, `/app/accounts/[id]`,
`/app/policies/new`, `/app/policies/[id]`, `/app/activity`, `/app/simulator`,
`/app/try`. Plus `error.tsx` and `not-found.tsx`, both added on the current
branch.

**State.** Three external stores read through `useSyncExternalStore`, never
copied into component state on mount:

| Store | Module | Holds |
|---|---|---|
| Accounts + provenance | `lib/store.ts` | `localStorage`, key `limen.v1` |
| Signing keys | `lib/local-key.ts` | `localStorage`, key `limen.keys.v1` |
| Passkey credential | `lib/passkey.ts` | credential id + public key, no secret |

`store.ts` is explicit that it holds **no claim about chain state** — installed
rules, caps and spend are re-read from the ledger on every load. That discipline
survives the repositioning unchanged and the new dashboard must inherit it.

**Design system.** Enforced by test, not by convention. `test/design-system.test.ts`
is 42KB and pins the typeface, a tabular-numeral default, two spacing rhythms,
the grid column tokens, a four-state verdict vocabulary that survives greyscale,
one accent colour, no keyframe animation, and the rule that *a fact is stated in
one place* (explorer URLs only in `lib/explorer.ts`, truncation only in
`lib/format.ts`). `test/contrast.test.ts` checks contrast ratios. The mark,
favicon and avatars are generated from one definition in `lib/mark.ts` and
regenerated-and-compared in the suite.

## 1.2 Current backend architecture

There is no backend service. There are **eight Next.js route handlers**, all
`runtime = 'nodejs'`, all stateless except for two in-memory maps:

| Route | Does | Network |
|---|---|---|
| `/api/ingest` | tx hash → `ObservedTransaction` | Soroban RPC read |
| `/api/account/[id]` | installed rules + caps, by simulation | Soroban RPC read |
| `/api/account/[id]/activity` | contract events over a stated ledger range | Soroban RPC read |
| `/api/lower` | proposal → `InstallPlan` or named refusal | none |
| `/api/install-preview` | proposal → ScVal XDR | none |
| `/api/explain` | Claude: rationale → plain English | Anthropic |
| `/api/demo/perform` | submits the demo's fixed testnet transfer | Soroban RPC write |
| `/api/waitlist` | email → JSON file | filesystem |
| `/api/report` | error report → webhook, redacted twice | webhook |

`/api/ingest` is documented as *the only file in the repo that opens a network
connection to read chain state* — that is true of the **route** layer;
`packages/chain` reads too, from the browser.

## 1.3 Existing Stellar integration

`packages/chain`, 16 modules, ~2,300 lines, `@stellar/stellar-sdk` **16.2.0**
(verified current: npm `latest` is 16.2.0; 17.0.0 is at `rc`). Protocol 23 `v4`
transaction meta is read alongside Soroban `v3`.

The parts that matter to the new product:

- **`submit.ts`** — the double-simulation pattern. Simulate in recording mode,
  sign the auth entries, **simulate again in enforcing mode**, submit, wait.
  The second simulation is the one that runs `__check_auth`. This exists because
  the first over-limit submission returned `FAILED` for `resourceLimitExceeded`
  and was nearly recorded as a policy refusal. Also `submitWithBorrowedFootprint`,
  which is what lets a call the boundary *refuses* still reach a ledger and have
  a hash.
- **`errors.ts`** — contract error tables transcribed from the OpenZeppelin
  sources at the pinned tag, plus `isBoundaryRefusal` and `isRevokedRule`. These
  two predicates are the difference between "the boundary refused you" and "the
  boundary is gone", and they are deliberately not merged.
- **`read.ts`** — reads installed context rules and spending limits by
  simulation. No fee, no signature, so anyone can audit an account.
- **`events.ts`** — `readActivity`, which pages through the `getEvents` cursor
  and reports `truncated` rather than reading an empty page as "nothing
  happened". States up front that **only successes emit events**.
- **`sign.ts`, `authpayload.ts`** — the `AuthPayload` `__check_auth` expects and
  `auth_digest = sha256(signature_payload ‖ context_rule_ids.to_xdr())`.
  `assertDistinctSigners` and `assertTestnet` live here.
- **`install.ts` / `revoke.ts`** — `add_context_rule`, `remove_context_rule`,
  `remove_policy`, unsigned. One submission per rule, because the rule id comes
  back in the return value and batching would lose the attribution.
- **`browser.ts`** — the browser-safe subset, dynamically imported so read-only
  screens do not pay for the SDK.

## 1.4 Existing Soroban contracts

**Limen writes no Rust.** `evidence.json` records `rustSourceFiles: 0` and that
number is generated, not typed.

Four WASMs from `OpenZeppelin/stellar-contracts` at tag **v0.7.2**, commit
`a9c42169`, recorded by hash in `packages/chain/src/wasm/manifest.json`:
`multisig-account-example`, `multisig-ed25519-verifier-example`,
`multisig-webauthn-verifier-example`, `multisig-spending-limit-policy-example`.
Byte-for-byte reproducibility is explicitly **not** claimed.

Deployed and recorded in `packages/chain/deployments/testnet.json`: the three
shared contracts (ed25519 verifier, webauthn verifier, spending-limit policy),
seven smart accounts, nine context rules, 69 distinct transaction hashes.

## 1.5 Existing permission system

The engine, and the part of this repository that is worth the most.

```
ObservedTransaction  --synthesize-->  PolicyProposal  --lower-->  InstallPlan
                     \                                                  |
                      \--generateDenyCases--> DenyCase[] --evaluate--> Decision
                                                                       |
                                                            add_context_rule
```

- `packages/core/synthesize.ts` — deterministic. No clock, no randomness, no
  locale sort, no model. Gross outflow, never netted. Integer basis points,
  truncating down. Throws with the constraint named rather than approximating.
- `packages/core/evaluate.ts` — **an independent implementation**, sharing no
  code path with `synthesize`. The outflow summation is written twice on
  purpose.
- `packages/core/denycases.ts` — single-axis mutations across six axes:
  `amount`, `asset`, `function`, `contract`, `invocation`, `expiry`.
- `packages/chain/lower.ts` — where composition-only is actually enforced.
  Refuses a contract no audited policy can constrain; refuses any function
  allowlist that is not exactly `['transfer']` (subsumed by `spending_limit`
  panicking `NotAllowed` on every other `fn_name`).

**All six deny axes are refused on live testnet**, each with its own failed
transaction and decoded contract error code — five of the six with a code
recovered from on-ledger diagnostic events, the sixth (`expiry`) honestly
recorded as simulation-only because the survey did not recover its code.

## 1.6 Existing transaction observation

`apps/web/src/lib/extract.ts` (408 lines) — XDR → `ObservedTransaction`. Reads
both Soroban `v3` and Protocol 23 `v4` meta. A meta version with no reader is
refused **by version number** rather than read as "classic, no events".

Governed by the rule *accurate or absent, never quietly narrowed*: a transfer it
cannot fully read fails ingest and names the field, rather than recording the
transfers it managed to parse. Attribution is `'exact'` with one invocation and
`'transaction-level'` with more, and the UI declines to draw a movement under a
call that may not have caused it.

Measured gap, stated in the README: the refusal rate against the real long tail
of testnet traffic is **unmeasured**.

## 1.7 Existing wallet integration

**None, deliberately, on a measurement rather than on effort.**

`README.md` "Why there is no wallet button" records the F4 experiment: a wallet
cannot be an `External` signer (it signs envelopes and auth entries, not raw
32-byte digests), so it can only be `Delegated` — and a `Delegated` signer raises
a *nested* auth requirement inside `__check_auth` that neither simulation can
discover. Recording-mode simulation never runs `__check_auth`; enforcing-mode
simulation runs it and **fails** rather than reporting what it wanted, returning
no `result.auth` for a wallet to sign. The script keeps a control case
(`UnvalidatedContext#3002` from an empty `signers` map) so the real result cannot
be misread the same way twice.

The wallet kit dependency was removed entirely, which took `npm audit` to zero.

**This finding constrains §7 of this plan and is not being re-litigated.**

## 1.8 Existing APIs

The eight routes in §1.2. No versioning, no authentication, no API keys, no
tenancy. Every route is public and unauthenticated; the only protection is
per-IP rate limiting.

## 1.9 Existing database / storage

**There is none.**

- `localStorage` — accounts, provenance, keys, passkey.
- `WAITLIST_STORE_PATH` — a JSON file, defaulting to the system temp directory,
  which a serverless host erases on recycle. Marked `TODO(roadmap)`.
- `lib/tx-cache.ts`, `lib/rate-limit.ts` — in-memory, process-local. Documented
  as raising the cost of a flood rather than bounding it.

`store.ts` states it outright: *No user accounts, no passwords, no email, no
server.*

## 1.10 Existing authentication

**There is none.** There are no users. An account address is a public
identifier, and any browser can read any account's boundary because reads are by
simulation.

The closest thing to identity is `lib/passkey.ts`: a WebAuthn credential that can
*own* a smart account, with the verifier's exact requirements measured rather
than guessed (65-byte uncompressed SEC1 point, XDR-encoded `WebAuthnSigData`,
low-S enforced beneath the contract with no decodable error code, UP and UV both
set, origin **not** validated by the contract).

That last clause matters and is picked up in §7.3: **the contract does not check
origin or `rpIdHash`**, so a passkey assertion is not by itself proof of which
site produced it. Anything that treats a passkey as a login credential has to
check origin itself.

## 1.11 Existing deployment setup

CI (`.github/workflows/ci.yml`) on every push and PR. Beyond the three test
suites, lint and build, it runs six fences that are unusual enough to name,
because **each of them has to survive or be consciously replaced**:

1. `evidence:check` — regenerates the landing's counts and fails on drift.
2. Demo-signer sentinel **must be present** in the server bundle before its
   absence from the client bundle counts for anything.
3. Client bundle can only reach testnet — asserted as *Limen's own source never
   names mainnet* and *no mainnet endpoint in the bundle*, with a self-match
   proving the pattern survived shell quoting.
4. No `S…` StrKey in the client bundle, proved live against a canary.
5. Playwright layout gate on four viewports, selected by `@ci` tag.
6. `npm audit --omit=dev --audit-level=low` — the strictest npm offers, at zero.

Every negative check in this workflow is **two-sided**. That pattern is the
single most portable thing in the repository and every new fence below inherits
it.

There is no hosting configuration in the tree, no Dockerfile, no `vercel.json`,
no migrations, no secret management beyond `process.env`.

## 1.12 Existing testnet functionality

Complete, for the flow it covers, and recorded rather than asserted:

- `packages/chain/scripts/testnet.mjs walkthrough` — install, over-limit, permitted.
- `packages/chain/scripts/acceptance.mjs` — the v4 chain run and the F4 experiment.
- `apps/web/e2e/account-lifecycle.spec.ts` — the nine-transaction browser run,
  performed **three times**, the second cold. Every key generated in the page by
  `createLocalKeys`.
- `scripts/verify-browser-run.mjs` — an independent verifier handed only two
  public keys and a contract address, reading everything else off public Horizon
  and public RPC. It checks *cryptographically* that the agent's four
  transactions carry no owner signature.

## 1.13 What can be reused

Everything in `packages/core` and `packages/chain`, unchanged. See the
module-by-module table in §11.

## 1.14 What needs refactoring

`apps/web/src/lib/chain-actions.ts` is the important one. It is already the seam
this plan needs — every write the product makes, lifted out of four screens into
one module — but it is **browser-only**: it takes `LocalKey` objects, calls
`loadChain()` (a dynamic import for bundle reasons), and reads `RPC_URL` from
browser config. The refactor is to lift its *transaction-shaping* half into a
runtime-neutral package and leave the browser wiring behind. Details in §11.

## 1.15 What needs to be built

The whole product above the boundary: identity, persistence, the agent runtime,
the tool layer, the custody service, the Telegram adapter, the dashboard, the
scheduler, the audit log. §4 onward.

## 1.16 Security risks (existing, before any change)

| # | Risk | Where | Severity now |
|---|---|---|---|
| S1 | Every API route is unauthenticated | all of `src/app/api` | Low today — nothing to steal. **Critical after §3.** |
| S2 | Rate limits are process-local | `lib/rate-limit.ts` | Low → Medium |
| S3 | Waitlist store is a temp file | `/api/waitlist` | Low, data loss only |
| S4 | Live-RPC ingest unmeasured against real traffic | `lib/extract.ts` | Medium — refuses rather than corrupts |
| S5 | Clearing site data strands an account | `lib/local-key.ts` | Accepted; narrowed by passkey |
| S6 | The `expiry` deny axis has no decoded on-ledger code | `deployments/testnet.json` | Recorded, not hidden |
| S7 | Demo account is a shared, funded, rate-limited testnet account | `lib/demo-signer.ts` | Accepted by design |

## 1.17 Missing infrastructure

Database, migrations, job queue/scheduler, session management, secret
management/KMS, structured logging, metrics, per-tenant rate limiting, a shared
cache, deploy configuration, staging environment, key rotation.

---

# PART II — THE BREAK LIST

*Brief §45.1. This is the real cost of the repositioning, and it is on the table
before the plan is approved rather than discovered during implementation.*

Each entry: the claim, where it is stated, where it is pinned, where it renders,
and what happens to it.

## B0 — Already broken today, and not by this plan

**Claim:** *"pinned in both directions by `apps/web/test/caveats.test.ts`"* —
`README.md:507` and `README.md:572`.

**Reality:** `apps/web/test/caveats.test.ts` **does not exist**. It was deleted
in `c034cb8` ("Delete the rendering layer, keep the engine and the data layer")
along with the landing page whose sentences it pinned. `local-key-label.test.ts`
was restored in the same commit; `caveats.test.ts` was not. `scripts/evidence.mjs:52`
already carries a comment noting that its `covers` description outlived the
suite — so this was seen once, in one file, and the two README sentences that
cite the test as their guarantee were not updated with it.

Two README caveats therefore currently name a nonexistent test as the thing that
keeps them honest. **The drift-detection discipline has itself drifted**, and it
did so in exactly the way the discipline exists to prevent: silently, in prose,
while every test stayed green.

**Proposal: fix before anything else, in the first commit after this plan.**
Either restore a `caveats.test.ts` pinning the surviving caveats in both
directions, or strike the two claims. Restore it — the V8 work multiplies the
number of caveats and this plan depends on that mechanism existing. This is
prerequisite work, not V8 work, and it is listed first because approving a plan
that adds fifteen caveats to a repository whose caveat fence is missing would be
the wrong order.

---

## B1 — `NO CUSTODY` — retired and replaced

**Claim:** *"No key of yours reaches a Limen server, an environment variable, or
a log line. Any key that can move funds here was generated in your browser, stays
in it, and is destroyed when you clear site data."*

**Defined:** `apps/web/src/lib/status-labels.ts:44-45`.
**Rendered:** `apps/web/src/app/page.tsx:68` (hero), `apps/web/src/app/docs/page.tsx:30`.
Deliberately **absent** from `/app/accounts/new` and `/app/try`, both of which
document why in their headers.
**Pinned:** the closed-set membership test in `local-key-label.test.ts:269-318`.

**What breaks:** the second sentence, completely. Under §3 a key that can move
funds is generated on a Limen server and stays there.

**Proposal: retire the label and replace it with two.** One label cannot carry
two opposite facts, and narrowing the text while keeping the name `NO CUSTODY`
would be the softening this project has refused everywhere else.

```
'NO OWNER CUSTODY':
  'The key that owns your account — a passkey, or a key generated in your
   browser — never reaches a Limen server. Limen cannot move your funds
   outside the boundary you installed, and cannot remove that boundary.'

'LIMEN HOLDS THE AGENT KEY':          ← loud, wherever an agent is deployed or acts
  'Your agent signs with a key Limen stores and can use while your browser is
   closed. That key can do exactly what the context rule you installed permits
   — one token contract, transfer only, up to your cap, until your expiry — and
   the account enforces that, not Limen. It cannot revoke itself; you can
   revoke it.'
```

`LIMEN HOLDS THE AGENT KEY` is `loud` on the same grounds `NOT AUDITED` is: it
is a thing a person must read **before** they act, and the hero must carry it
above the argument, not under it.

---

## B2 — Design rule 3 — narrowed, and the narrowing named

**Claim:** `README.md:224` — *"Limen custodies nothing of yours. No user's
secret key reaches a Limen server, an environment variable, or a log line.
Signing is client-side only."* Reinforced at `README.md:245-257`: *"Two kinds of
key can therefore move funds here, and neither of them is Limen's to hold"* …
*"There is no code path in this repository that gives Limen custody of a user's
key, and no server-side signer for a user's account."*

**What breaks:** "Signing is client-side only" — false. "No server-side signer
for a user's account" — false; the smart account is the user's account.

An argument is available that the agent key is not *a user's key* because Limen
generates it and the user never sees it. **Reject that argument.** It is a key
that moves the user's funds, and a rule that survives by reclassifying the thing
it was written about has not survived.

**Proposal: rewrite rule 3 as a three-key table**, with the third key's powers
enumerated exhaustively rather than characterised. Draft in §3.4. The rule keeps
its number and its position, and its revision history is written into the file
the way `status-labels.ts` already writes its own.

---

## B3 — "the only signer in the repo" — false

**Claim:** `README.md:435` (Layout) — `src/lib/demo-signer.ts — the only signer
in the repo; testnet-fenced`. Echoed in `demo-signer.ts` and
`test/demo-signer.test.ts`.

**What breaks:** a second server-side signer appears, and it is not a fixed
template — it signs auth entries whose arguments come from an LLM's tool call.

**Proposal: generalise the fence into a registry rather than deleting it.** A
`SERVER_SIGNERS` manifest naming every module in the repository permitted to
hold a secret, with a test asserting the set of modules that can sign equals that
manifest exactly. The demo signer's four fences become the *template* every
entry must satisfy, not a special case. The CI sentinel check gains a second
sentinel for the agent signer, and stays two-sided.

---

## B4 — The keygen tripwire's scan roots — a silent hole

**Claim:** *"`apps/web/test/local-key-label.test.ts` fails the build if any file
that generates, stores, or imports a key stops carrying the label"* —
`README.md:239`, `local-key.ts:28-30`, `status-labels.ts:74-78`.

**Reality:** the test's `ROOTS` are **`apps/web/src` and `packages/chain/src`
only** (`local-key-label.test.ts:42-45`). A new `packages/custody/src` or
`packages/agent/src` is not scanned. Server-side agent keygen would land
**outside every fence in this repository** and nothing would go red.

The header of that constant is itself the evidence: it was widened once already,
to cover `packages/chain/src`, because PLAN-V3 put the agent signer there. The
mechanism works; its scope is a list that has to be maintained.

**Proposal, two parts:**
1. Change `ROOTS` from an enumerated list to **every `packages/*/src` plus
   `apps/*/src`, discovered by directory read**, with a guard test asserting the
   discovered set is non-empty and contains at least the known workspaces. A
   fence whose coverage is a hand-maintained list fails by omission, which is the
   quietest way for a fence to fail.
2. Add a **third label**, `TESTNET ONLY · AGENT KEY (LIMEN-HELD)`, and partition
   the detectors: browser keygen must carry `LOCAL_KEY_LABEL`, server keygen must
   carry the new one, and **carrying the wrong one is a failure**. Forcing a
   server-held key to render `TESTNET ONLY · LOCAL KEY` would make the tripwire
   the source of a false statement.

---

## B5 — `local-key.ts`'s "it is the only one" — false

**Claim:** `local-key.ts:18` — *"This module is not one of two ways to sign — it
is the only one."* And `local-key.ts:46` — *"No server involvement of any kind."*

**What breaks:** the first sentence. The second stays true **of this module**
and should be re-scoped to say so rather than deleted.

**Proposal:** narrow to *"This module is the only way **this browser** signs."*
Keep the export/backup prohibition exactly as it is — it is unaffected and it is
correct.

---

## B6 — `store.ts`'s "no server" — false

**Claim:** `apps/web/src/lib/store.ts:20` — *"No user accounts, no passwords, no
email, no server."*

**What breaks:** all four clauses. §5 introduces users, sessions, a database, and
Telegram identities.

**Proposal:** rewrite the header to state what the *browser* store holds and,
newly, **what the server holds instead** — with a pointer to the data model. The
valuable half of this module's discipline (*no cached claim about chain state*)
is untouched and becomes a rule the server store inherits: §5 forbids caching
installed caps, remaining spend, or rule liveness in Postgres for exactly the
same reason.

---

## B7 — Design rule 1 and the LLM — survives, but only if stated precisely

**Claim:** `README.md:203-208` — *"Claude has exactly two jobs… Its answers
become arguments to the synthesizer, never its output. There is no LLM anywhere
in the path that produces authorization logic."*

**The tension:** brief §6 asks an LLM to turn *"pay my suppliers up to $50"* into
a structured configuration including `max_transaction: 50`. That is an LLM value
reaching a policy.

**This rule does not have to break, and it must not.** The resolution:

- The LLM emits a **draft configuration**, which is data, not policy.
- The draft is rendered for explicit human review and requires an affirmative
  selection. Nothing proceeds on a default.
- The confirmed values enter `synthesize` as `SynthesisOptions` — the same
  channel `/api/explain`'s widening options already use, which is already
  governed by *nothing Claude proposes is ever applied silently* (rule 6).
- `synthesize` remains the only thing that emits a `PolicyProposal`, and `lower`
  remains the only thing that turns one into an install.
- **Demonstration Mode (§16 of the brief) stays the preferred path**, because it
  needs no model at all.

**Proposal:** rule 1 keeps its text and gains one clause — *an LLM may propose
values for user confirmation; it may not produce a proposal* — plus a test
asserting no module under the agent runtime imports `synthesize` or `lower`
directly. The runtime asks the policy service; it does not derive policy.

---

## B8 — "Approved recipients" cannot be enforced on-chain. It is in the brief nine times.

This is the largest single gap between the brief and what the chain can do, and
it is a correctness issue rather than a scheduling one.

**What the brief promises:** §8 *"send up to 50 USDC to approved recipients"*;
§13 *"Send only to approved recipients"*; §14 *"Destination — approved
recipients, address allowlists"*; §19 *"Approved recipients only"*; §20/§51 the
Telegram script — *"Alice is an approved recipient."*

**What exists:** OpenZeppelin's `spending_limit` policy takes exactly two
parameters — `spending_limit` (i128) and `period_ledgers` (u32)
(`packages/chain/src/authpayload.ts:53-58`). It constrains **contract, function,
amount, window and expiry**. It does not see the destination. Verified against
the current `main` of `OpenZeppelin/stellar-contracts`: the policy set is still
`simple_threshold`, `spending_limit`, `weighted_threshold`. **There is no
destination-allowlist policy, and there was none at v0.7.2 either.**

So today the agent key can send up to the cap **to any address**. The demo flow
sends to the owner, but that is `chain-actions.ts` choosing a destination, not a
rule constraining one.

Enforcing a recipient allowlist requires a Rust policy contract nobody has
audited — which design rule 2 forbids, and which `lower.ts` already refuses at
install time.

**Three options, and a recommendation:**

| | What it is | Cost |
|---|---|---|
| A | Drop recipient allowlists from the MVP claim entirely | The brief's demo script changes |
| B | Ship them as an explicitly-labelled **off-chain** check | Honest, useful, and not a security boundary |
| C | Write the Rust policy | Breaks rule 2 and `rustSourceFiles: 0` |

**Recommend B, with the labelling done properly.** A recipient allowlist checked
in the tool layer is genuinely useful — it stops the *common* failure, which is a
confused or prompt-injected model sending to the wrong place — and it is
worthless against an attacker holding the agent key. Both halves go on screen,
in the same words everywhere, using the existing `COMPUTED LOCALLY` vocabulary
beside the `ON-CHAIN` items:

> **Recipient allowlist — COMPUTED LOCALLY.** Limen's tool layer refuses a
> payment to an address you have not approved. Unlike your cap, your asset and
> your expiry, **the ledger does not enforce this** — no audited policy contract
> constrains a transfer's destination. Someone holding the agent key could send
> to any address, up to your cap. Lower your cap if that matters more to you
> than convenience.

And the dashboard's policy panel must **partition** into two headed groups,
`Enforced by the network` and `Enforced by Limen`, rather than listing six
constraints as though they were the same kind of thing. This is the same
distinction the simulator already draws between its local deny table and the
network's refusals, applied to the policy display.

Option C is the trigger for the codegen work the README already gates behind
`compositionOnly: false` — not a reason to write Rust now.

---

## B9 — Revocation currently depends on the browser key. After §3, that is a trap.

Not a documented claim, so it is not strictly a break-list entry — it is worse:
an **emergent defect** the repositioning creates, which no existing test would
catch.

Today: clearing site data destroys both keys, and the account is stranded. That
is stated at creation and is an acceptable trade for testnet dust, because
**nothing else was running**.

After §3: clearing site data destroys the owner's browser key while **Limen's
agent key keeps signing on schedule**. The owner can no longer revoke. The
boundary holds — the cap, the asset, the expiry all still bind — but the user has
lost the ability to stop an agent that is still spending.

Even with a passkey owner (which survives clearing site data) the problem is only
half solved: a passkey signs the auth entry but **cannot pay a Stellar fee**
(`key-roles.ts:51`), and today the fee comes from the browser's local key.

**Proposal, and it is a hard requirement on the MVP:**

1. **Passkey owner is the default** for any account with a deployed agent, not
   an option beside the browser key.
2. **Limen sponsors the fee for owner revocation.** A Limen-owned fee account
   pays; the owner signs the auth entry with the passkey. Limen cannot forge that
   entry, so sponsoring the fee grants Limen nothing.
3. **`valid_until` is mandatory and short** for agent rules — a dead-man switch,
   so an abandoned agent stops on its own.
4. **A revocation path that does not require the web app at all**: `/revoke` as a
   standalone route needing only the passkey, plus `/revoke` as a Telegram
   command, plus a documented `stellar` CLI invocation in `/docs` for the case
   where Limen is down. If Limen holds a key that spends, the user must be able
   to stop it **without Limen's cooperation**. That last one is the only version
   of this that is a real guarantee, and it is the one that must ship.

---

## B10 — Landing hero — repositioned, not falsified

`app/page.tsx:70` — *"The boundary is derived, not authored."* Brief §36 demotes
it. Still true, still the differentiator, moves below the fold. No test change
beyond the copy fences.

## B11 — Claims that survive untouched, stated so they are not re-argued

Listing these is part of the job: a break list that only grows overstates the
damage.

| Claim | Why it survives |
|---|---|
| `TESTNET ONLY` | Unchanged, and enforced by three levels of mainnet gate |
| `NOT AUDITED` | Unchanged, and more load-bearing than before |
| `COMPOSITION ONLY` | Survives **iff** B8 resolves as A or B |
| Design rule 2 (composition only) | Untouched; `lower` still refuses |
| Design rule 4 (`evaluate` independent) | Untouched |
| Design rule 5 (integer math) | Untouched, and inherited by every new amount path |
| Design rule 6 (bias toward less permission) | Untouched, and extended to LLM drafts by B7 |
| The `/app/simulator` local-adjudication caveat | Untouched |
| "Only single-token transfer flows can be installed" | Untouched, and now the reason B8 exists |
| "`validFromLedger` is not installed" | Untouched |
| "The browser write path… nobody has clicked it" | Untouched; needs a server-side twin |
| Ingest long-tail unmeasured | Untouched, and now on the critical path |
| F4 / no wallet button | Untouched; §7.3 routes around it rather than re-testing it |
| `rustSourceFiles: 0` | Survives iff B8 resolves as A or B |

---

# PART III — THE CUSTODY ANSWER

*Brief §12.1. This is the load-bearing decision and it is answered outright.*

## 3.1 The answer

> **Limen generates and holds the agent key on a Limen server. The user's owner
> key never reaches Limen. The agent key is registered on-chain as an `External`
> ed25519 signer on one context rule carrying one `spending_limit` policy, and
> the account — not Limen — decides what it can do.**

Rejected alternative, and why: *the agent runs client-side and acts only while a
tab is open.* The brief says to state this plainly if chosen. It is not chosen,
because it is not an autonomous agent — it cannot answer a Telegram message, it
cannot pay a contractor on Friday, and every promise in §1–§58 of the brief that
distinguishes this from the current product would have to be withdrawn. Choosing
it would mean changing the product, not the wording.

The claim this buys, which is the one the brief identifies as stronger than the
current one:

> Limen holds a key that can only do what you authorized on-chain. The boundary
> is enforced by the account, not by us. Here is the transaction where the agent
> tried to exceed it and the network refused.

That claim is only available because the enforcement was built first. It is on a
ledger already — `c4fff69b…`, `SpendingLimitExceeded#3221`.

## 3.2 The four questions, answered

### Where the agent key lives

Generated **server-side** in `packages/custody`, never in a browser, never sent
to one. Stored in Postgres as ciphertext under envelope encryption: a per-agent
data key, wrapped by a KMS master key (AWS KMS / GCP KMS / Vault — a
`KeyProvider` interface with a KMS implementation and a **local dev
implementation that refuses to start when `NODE_ENV=production`**). The plaintext
seed exists only inside the signer process, only for the duration of one
signature, and is never written to a log, a metric, an error report, a response
body, or a queue message.

`lib/redact.ts` already matches `S…` StrKeys and long hex on the way out of the
browser. The same redactor moves into a shared package and is applied to **every
server log line and every outbound webhook**, not only to error reports. That is
a straight reuse of code whose header already argues for exactly this: *"this is
the last place a value passes before it leaves… a fence that assumes the fences
upstream held is not a fence."*

### Who can use it, and what authenticates a request

Only the **signer service**, and only when handed a *policy-gate decision token*:
a short-lived, single-use, server-signed statement naming the agent, the tool,
the exact arguments, and the decision id. The signer verifies the token,
re-derives the transaction from the token's own arguments — **it never signs
bytes handed to it** — and refuses anything else. This is the demo signer's
fence 3 (*it signs only a transaction it built itself*) generalised from a fixed
template to a validated template.

Above that:

| Surface | Authentication |
|---|---|
| Web | Passkey (WebAuthn) session, origin-checked server-side, `SameSite=Lax` httpOnly cookie |
| Telegram | Verified `initData` HMAC + a **pairing token** minted in the web app and consumed once; binding stored as `(telegram_user_id → user_id)` |
| API/SDK (P2) | Scoped API key, hashed at rest, per-agent |

Telegram username is never an identity. §7.4.

### How it is stored, and what an operator with database access can do

**Stated as a capability list, not as reassurance.** An operator holding the
database *and* the KMS key — the two together, which is the point of splitting
them — can, for each agent, sign transactions the agent's own key could sign.
Exhaustively, that is:

**Can:**
- `transfer` on the **one** token contract named by the rule
- to **any destination** (B8 — no audited policy constrains this)
- up to the **remaining cap** in the current rolling window
- until **`valid_until`**, and only while the owner has not revoked
- spend the XLM in the **agent's own fee account** (a separate, smaller exposure
  — see below)

**Cannot:**
- call any other contract, or any other function on that contract
  (`NotAllowed#3223`, `UnvalidatedContext#3002` — both on a ledger)
- exceed the cap (`SpendingLimitExceeded#3221` — on a ledger)
- act after expiry (`UnvalidatedContext#3002`)
- add, alter or remove a context rule or policy — `remove_context_rule` requires
  the account to authorize itself, and the agent's `CallContract(token)` rule
  does not match a call to the account. **The agent's own revoke attempt is
  refused on a ledger** (`fca28f06…`, `UnvalidatedContext#3002`)
- touch the owner's key, the passkey, or any other agent's key
- act at all once the owner revokes (`ContextRuleNotFound#3000`)

**The fee account is a real second exposure and is not glossed.** The agent pays
its own fees from its own classic `G…` account, which the user funds. A key
holder can drain it. It is bounded by *how much the user funds it with*, so:
Limen funds it in small increments with automatic top-up from a Limen-owned
account rather than asking the user to pre-fund it, and the dashboard shows the
fee balance as a distinct, differently-labelled number from the spendable cap.

### What happens to `NO CUSTODY`

Retired. See **B1** for the two labels that replace it, and **B4** for the third
key label the tripwire needs.

### What happens to design rule 3

Rewritten. See **B2** and §3.4.

## 3.3 Why this is defensible, and where it is weaker than what exists

**Stronger than the alternative in the category.** The comparison is not
"Limen holds a key" versus "nobody holds a key". Every autonomous agent platform
holds a key. The comparison is "Limen holds a key bounded by an audited contract
that refuses in a ledger, with a hash you can check" versus "Limen holds a key
bounded by Limen's own server-side checks". The second is the norm; the first is
what this repository spent seven plans building.

**Weaker than today, in exactly three ways, all of which go on screen:**

1. Today Limen can move nothing. After this, Limen can move up to the cap.
2. Today a compromise of Limen's infrastructure costs users nothing. After this,
   it costs the sum of every live agent's remaining cap, plus fee balances.
3. Today the trust boundary is verifiable by reading the client bundle. After
   this, part of it is a server nobody outside can inspect — which is precisely
   why the parts that *are* verifiable (the context rule, the refusals, the
   revocation) must be the ones doing the load-bearing work, and why the
   dashboard must render the boundary as read from the chain rather than as
   configured in the database.

## 3.4 Design rule 3, rewritten

> **3. Three keys can move funds here. Limen holds exactly one of them, and the
> account decides what it can do.**
>
> | Key | Held by | Can move | Limen's reach |
> |---|---|---|---|
> | **Owner** — passkey | Your device or password manager | Everything the account can do, including revoking the agent | None. Limen never sees it. |
> | **Owner** — browser key *(legacy path)* | This browser's `localStorage` | The same | None. It never leaves the page. |
> | **Agent** | **A Limen server, encrypted** | Exactly what the installed context rule permits, and nothing adjacent | Limen can sign with it. Limen cannot widen what it may do. |
>
> The third row is new in v8 and is the narrowing this rule has taken. It used to
> read *"Signing is client-side only"*, and that stopped being true the moment an
> agent had to answer a message with no browser open. What survives is the claim
> that still holds everywhere: **the key that controls your account is never
> Limen's, and the key that is Limen's is bounded by a contract rather than by a
> promise.** Six refusal transactions on testnet are what that sentence rests on.
>
> The agent key's powers are enumerated at `docs/custody`, not characterised.
> Every one of the six things it cannot do has a transaction hash where the
> network refused it.

---

# PART IV — ARCHITECTURE

## 4.1 Packages

```
packages/core        KEEP, unchanged     synthesize / evaluate / denycases. No deps, no IO, no DOM.
packages/chain       KEEP, +additions    everything that touches the network.
packages/policy      NEW                 the gate: validate → decide → token → audit.
packages/custody     NEW                 agent keygen, envelope encryption, the signer service.
packages/agent       NEW                 the runtime: model abstraction, tool loop, conversation.
packages/tools       NEW                 tool definitions. Every on-chain tool calls packages/chain.
packages/db          NEW                 schema + migrations + typed queries.
packages/shared      NEW                 redaction, status labels, key roles, formatting.

apps/web             REFACTOR            builder, dashboard, docs, landing.
apps/runtime         NEW                 the agent API + worker + scheduler. One Node service.
apps/telegram        NEW                 webhook adapter. Thin, by rule.
```

The dependency direction that must never invert, extending the rule
`packages/core` already states:

```
core  ←  chain  ←  policy  ←  tools  ←  agent
                      ↑
                   custody   (signer; depends on chain and policy, on nothing above)
```

`agent` may not import `core` or `custody` directly. It asks `policy` and calls
`tools`. **A test asserts this**, in the same spirit as the existing rule that
lowering must not be able to reach back and change what was derived.

## 4.2 The request path, end to end

```
Telegram message  /  Web chat  /  API call
        │
        ▼
  apps/runtime — authenticate, resolve user → agent, load conversation
        │
        ▼
  packages/agent — LLM turn, emits a tool call
        │
        ▼
  packages/tools — schema-validate arguments (zod), reject anything off-shape
        │
        ▼
  packages/policy — THE GATE
        │   • is the agent ACTIVE and unexpired?
        │   • re-read the installed rule FROM THE CHAIN (never from the DB)
        │   • asset ∈ rule? function ∈ rule? amount ≤ remaining cap?
        │   • recipient ∈ allowlist?  ← COMPUTED LOCALLY, labelled as such (B8)
        │   • daily/aggregate limits (Limen-enforced, labelled)
        │   • human-confirmation band? → suspend, ask, resume
        │   → writes an AuditEvent, mints a single-use decision token
        ▼
  packages/custody — verify token, REBUILD the transaction from the token's
        │            own arguments, decrypt, sign auth entry, zeroise
        ▼
  packages/chain — submitAuthorized: simulate, sign, RE-SIMULATE ENFORCING, submit
        │
        ▼
  Soroban __check_auth → context rule → spending_limit → ALLOW / DENY
        │
        ▼
  errors.ts: isBoundaryRefusal / isRevokedRule → four distinct outcomes (§4.4)
```

The gate is a **convenience and observability layer, not the security boundary**
(brief §15). Its job is to fail fast, to explain, and to leave a record. If it
were bypassed entirely, `__check_auth` would still refuse — and the security
tests in §10 prove that by bypassing it on purpose.

## 4.3 What the runtime calls, per brief §44.1

Where the agent runtime needs an on-chain action, it calls an existing module. No
reimplementation:

| Runtime need | Calls |
|---|---|
| Read installed boundary | `packages/chain/read.ts` — `readAllContextRules`, `readSpendingLimit` |
| Read balances | `packages/chain` — new `balance.ts`, SAC `balance` by simulation (§6.1) |
| Read activity | `packages/chain/events.ts` — `readActivity`, with its `truncated` flag surfaced |
| Build a transfer | `packages/chain/token.ts` — `transferFunction` |
| Sign an auth entry | `packages/chain/sign.ts` — `signAs` (+ `assertDistinctSigners`, `assertTestnet`) |
| Submit | `packages/chain/submit.ts` — `submitAuthorized` |
| Get a refused attempt onto a ledger | `packages/chain/submit.ts` — `submitWithBorrowedFootprint` |
| Classify a failure | `packages/chain/errors.ts` — `isBoundaryRefusal`, `isRevokedRule`, `describeContractError` |
| Derive a policy | `packages/core/synthesize.ts`, via `packages/policy` |
| Check a policy independently | `packages/core/evaluate.ts` |
| Lower to an install | `packages/chain/lower.ts` |
| Install / revoke | `packages/chain/install.ts`, `revoke.ts` |
| Ingest an observed tx | `apps/web/src/lib/extract.ts` → **moves to `packages/chain/extract.ts`** (§11) |

## 4.4 Error handling — four outcomes, never collapsed

Brief §32. The vocabulary already exists in `lib/verdict.ts` and is pinned by
`design-system.test.ts` at exactly four states; it extends rather than changes:

| Outcome | Source | What the user is told |
|---|---|---|
| **Agent error** | the model or the tool layer | "I couldn't work out what you meant." No hash. |
| **Refused by Limen** | `packages/policy` | The named constraint, and **whether the ledger would also have refused**. Explicitly labelled as not having reached a ledger. |
| **Refused by the network** | `isBoundaryRefusal` | The contract error code, the axis, **and the hash**. |
| **Infrastructure error** | RPC, timeout, budget | "This didn't reach the network." Never rendered as a refusal. |

The discipline the README already states, carried forward verbatim as a rule on
the runtime: **a failure is not a refusal until its error code says so**, and
**a refusal that never reached a ledger is evidence of nothing**. Rows two and
three are visually distinct in the activity feed, and row two never borrows row
three's badge.

---

# PART V — DATA MODEL

Postgres. Drizzle (SQL-first, no runtime, migrations are readable files —
matching this repository's preference for things a reviewer can check by
reading). Every amount is `NUMERIC`/`TEXT` and handled as `bigint`: **design
rule 5 crosses the database boundary intact**, and there is no `float8` anywhere
near an amount.

**The inherited prohibition (B6):** no table caches installed caps, remaining
spend, or whether a rule is live. Those are read from the ledger. Where a
denormalised copy is unavoidable for a list view, the column is named
`*_last_seen` and every render states the ledger it was read at.

```
User
  id, created_at
  auth_method            'passkey' | 'browser_key'
  passkey_credential_id  bytea, unique, nullable
  passkey_public_key     bytea            -- 65-byte SEC1, the contract's form
  display_name

Session
  id, user_id, expires_at, created_ip_hash    -- hashed; the IP itself is never stored

TelegramLink
  id, user_id, telegram_user_id (unique), linked_at, paired_via_token_id
  -- username deliberately absent: it is not identity (brief §20)

Agent
  id, user_id, name, description
  status         DRAFT|CONFIGURED|DEPLOYING|ACTIVE|PAUSED|REVOKED|EXPIRED|ERROR
  network        'testnet'                    -- one-member union, level 1 mainnet gate
  model_provider, model_id                    -- brief §28
  system_instructions
  risk_level     conservative|balanced|autonomous   -- compiles to policy, not decoration
  created_at, deployed_at, paused_at, revoked_at

AgentAccount
  agent_id (unique), smart_account_contract_id, deploy_tx_hash
  owner_signer_kind 'passkey'|'ed25519', owner_public_key
  agent_public_key         -- G… ; the PUBLIC half only
  agent_fee_account        -- the classic account paying fees
  context_rule_id, install_tx_hash

AgentKey                                     -- the §3 answer, in one table
  agent_id (unique)
  ciphertext bytea                           -- the seed, envelope-encrypted
  wrapped_data_key bytea
  kms_key_id, algorithm, created_at, rotated_at
  -- NO plaintext column exists, at any point, under any name.
  -- Enforced by a schema test, not by review.

Policy                                       -- what was DERIVED and INSTALLED
  id, agent_id
  source              'demonstrated' | 'described'      -- brief §17, two modes
  observed_tx_hash, observed_ledger                     -- provenance; local-only
  headroom_bps, window_ledgers, valid_until_ledger
  proposal_json                                          -- the PolicyProposal, verbatim
  install_plan_json                                      -- the InstallPlan, verbatim
  install_tx_hash, context_rule_id
  enforced_offchain_json    -- recipient allowlist, daily limits. LABELLED as B8 requires.
  status, created_at

Conversation / Message
  agent_id, channel 'telegram'|'web'|'api', external_id
  role, content, tool_calls_json, created_at

ToolExecution
  id, agent_id, conversation_id, tool_name, arguments_json
  policy_decision   'permit'|'refuse'|'confirm_required'
  policy_reason, decision_token_id
  outcome           'agent_error'|'refused_by_limen'|'refused_by_network'|'infra_error'|'succeeded'
  created_at

Transaction
  id, agent_id, tool_execution_id
  hash, reached_ledger bool, ledger
  amount TEXT, asset, destination
  op_result_name, contract_error_codes int[]
  is_boundary_refusal bool, is_revoked_rule bool
  created_at

AuditEvent
  id, actor 'user'|'agent'|'system'|'operator'
  actor_id, action, target, result, metadata_json, created_at
  -- append-only; no UPDATE or DELETE grant on this table for the app role

ScheduledTask
  id, agent_id, cron, next_run_at, last_run_at, enabled    -- "every Friday"

IdempotencyKey
  key, agent_id, response_json, created_at    -- replay defence (§10)
```

**Deliberately absent:** any column holding a plaintext secret; any cached
`current_cap` or `remaining_spend`; any `is_live` boolean about a context rule;
Telegram usernames; raw IP addresses.

---

# PART VI — THE AGENT RUNTIME

## 6.1 Tools

Every tool is a schema, a handler, and a policy class. Arguments are validated
before the gate sees them, so the gate is never reasoning about a malformed
shape.

| Tool | Kind | Backed by |
|---|---|---|
| `get_balance` | read | `packages/chain` — new `balance.ts` (SAC `balance` by simulation) |
| `get_boundary` | read | `read.ts` — `readAllContextRules` + `readSpendingLimit` |
| `get_activity` | read | `events.ts` — `readActivity`, `truncated` surfaced to the user |
| `get_transaction` | read | `submit.ts` — `waitForTransaction` / RPC |
| `send_payment` | **write** | `token.ts` + `sign.ts` + `submit.ts` |
| `explain_refusal` | read | `errors.ts` — `describeContractError` |

**`invoke_contract` and `monitor_account` are deliberately not in the MVP.**
`invoke_contract` cannot be constrained by any audited policy (`lower.ts` refuses
exactly this today, and the refusal is correct); shipping it would mean either an
unconstrained context rule or generated Rust. `monitor_account` needs the
scheduler, which is M6.

## 6.2 The loop

Bounded and boring. Max tool calls per turn, max tokens, wall-clock timeout, and
**at most one write tool per turn** — a turn that wants two payments asks twice.
Conversation state in Postgres, not in the model's context alone.

Memory (brief §27): recipients, preferences, recurring tasks. **Financial
authorization never reads memory.** The recipient allowlist lives in
`Policy.enforced_offchain_json` and is consulted by the gate, never recalled by
the model. A test asserts the gate takes no input from the conversation store.

## 6.3 Model abstraction

`ModelProvider` interface: `complete(messages, tools) → ToolCall | Text`.
Anthropic first (`@anthropic-ai/sdk` is already a dependency at ^0.115.0;
`/api/explain` is the existing integration to model the shape on). Default to the
current Claude models per the repository's own standing guidance.

Brief §28's requirement — *changing the LLM must not change the security
boundary* — is testable and gets a test: the security suite in §10 runs its full
set against a **`HostileModelProvider`** that emits deliberately malicious tool
calls, and every assertion must hold identically.

---

# PART VII — STELLAR, AUTHORIZATION, AND TELEGRAM

## 7.1 The account model

Unchanged from what is already deployed and proven, which is the point:

```
        Owner (passkey)                     Agent (Limen-held ed25519)
              │                                        │
    Default context rule                    CallContract(token) rule
      no policy — full authority              + spending_limit policy
              │                                        │
              └────────────  Smart account  ───────────┘
                          (OpenZeppelin v0.7.2)
                                   │
                              __check_auth
```

Deploy → fund → observe/describe → derive → lower → install → run. Every step
already has a transaction hash in `deployments/testnet.json`.

## 7.2 The 60-second claim

Ledger close is ~5s. Deploy, fund, one observed transfer, one install — four
submissions plus friendbot. **Plausible, and unmeasured.**

This repository does not print numbers it has not generated. So: **the landing
page does not state a duration until `scripts/evidence.mjs` produces one from a
timed, recorded run**, the same way it produces test counts and transaction
counts. If the measured number is 90 seconds, the page says 90. A `deploySeconds`
field is added to the deployments file, and the hero reads it through
`lib/evidence.ts` like every other figure.

## 7.3 Authentication, without reopening F4

**Passkey is both the identity and the owner.** One credential:

- **As identity** — a WebAuthn assertion verified *server-side*, with **origin
  and challenge checked by Limen**. This is required and is not optional: §1.10
  records that the on-chain verifier checks neither `origin` nor `rpIdHash`, so
  the contract's acceptance of an assertion is not evidence of which site
  produced it. The login path must not inherit that gap.
- **As owner** — the same credential as the `External` webauthn signer on the
  Default context rule, which `deployments/testnet.json`'s `webauthnRun` block
  already proves works against the deployed verifier.

This gives a durable identity, survives clearing site data, needs no wallet, and
does not reopen the F4 measurement. **No wallet button, still.**

## 7.4 Telegram

The bot is an adapter with **no business logic** — brief §20/§21, and the rule
`chain-actions.ts` already established for `/app/try`: *do not fork the logic*. A
test asserts `apps/telegram` imports neither `packages/policy` nor
`packages/custody` nor `packages/chain`; it may only call the runtime's HTTP API.

**Linking.** User clicks *Connect Telegram* in the web app → server mints a
single-use, short-TTL pairing token → deep link `t.me/<bot>?start=<token>` →
bot receives `/start <token>`, verifies `initData` HMAC against the bot token,
consumes the token atomically, writes `TelegramLink`. Username is never consulted.

**Every inbound update** verifies the `initData` HMAC and resolves
`telegram_user_id` against `TelegramLink`. An unlinked chat gets an offer to
link and nothing else. Webhook secret token set on `setWebhook` and checked per
request.

Commands `/status /balance /activity /limits /pause /resume /revoke` plus natural
language. `/pause` and `/revoke` work from Telegram because a person who needs to
stop an agent is holding a phone — but **`/revoke` requires the passkey**, so the
bot replies with a one-time deep link into the web app. Telegram alone cannot
revoke, and it must not be able to: Telegram is not the security boundary.

## 7.5 Deployment

| Component | Where | Why |
|---|---|---|
| `apps/web` | Vercel | Already shaped for it |
| `apps/runtime` | One long-lived Node container (Fly/Railway/Render) | Needs a scheduler, a queue, and **a single writer per agent** for sequence numbers |
| `apps/telegram` | Same container, separate route | One deploy, no cross-service auth |
| Postgres | Managed (Neon/Supabase/RDS) | — |
| Redis | Managed | Shared rate limits, the tx cache, the submission lock — retires two `TODO(roadmap)`s |
| KMS | AWS KMS / GCP KMS / Vault | The master key that must not sit beside the database |

**Sequence-number serialization is a correctness requirement, not an
optimisation.** The demo signer already serializes submissions so concurrent
reviewers cannot collide; with N agents sharing fee accounts and a scheduler
firing, this becomes a per-fee-account lock in Redis. Two agents building on the
same sequence number produce a failure that looks exactly like a refusal, which
is the one failure this product cannot afford to render wrong.

---

# PART VIII — SECURITY RISKS INTRODUCED

| # | Risk | Mitigation | Residual |
|---|---|---|---|
| N1 | **Agent key compromise via DB + KMS** | Split trust; short `valid_until`; small caps; per-agent data keys; rotation | Bounded by cap × live agents. **Stated on screen.** |
| N2 | Prompt injection → hostile tool call | Gate + on-chain enforcement; `HostileModelProvider` suite; one write per turn | Recipient is off-chain only (B8) |
| N3 | Telegram identity spoofing | `initData` HMAC, pairing token, webhook secret | Revoke still needs the passkey |
| N4 | Cross-tenant access (agent A acting for user B) | Every query scoped by `user_id`; ownership re-checked at the gate; §10 test | — |
| N5 | Replay | `IdempotencyKey`; single-use decision tokens | — |
| N6 | Sequence collision rendered as refusal | Per-fee-account Redis lock; `isBoundaryRefusal` before any refusal claim | — |
| N7 | Secret in a log / report / metric | Shared redactor on **every** egress; server-side sentinel greps in CI | — |
| N8 | Fee-account drain | Small increments, auto top-up, separately labelled balance | Bounded and visible |
| N9 | Signer service asked to sign arbitrary bytes | It rebuilds from the token's arguments; no "sign this XDR" entrypoint exists | — |
| N10 | An operator changes a policy in the DB to widen an agent | The DB is not the boundary — the gate re-reads the rule from the chain, and the chain is what enforces | **This is the whole argument, and it holds** |

N10 is worth reading twice. It is the reason the ordering of this project's work
turned out to be correct: because enforcement was built first, a database
compromise cannot widen an agent's authority. It can only forge Limen's own
opinion about it.

---

# PART IX — MILESTONES

**M0 — Repair (prerequisite, not V8).** Restore `caveats.test.ts` (B0). Widen the
tripwire's `ROOTS` to every workspace (B4). Both before any new subsystem, so the
fences exist before there is something to fence.

**M1 — Foundations.** `packages/db` + migrations. `packages/shared` (redactor,
labels, key roles lifted out of `apps/web`). Passkey authentication with
server-side origin verification. Sessions. Redis. **The label changes from B1,
B2, B4, B5, B6 land here**, in the same commits as the code that makes them true —
never after.

**M2 — Custody.** `packages/custody`. Keygen, envelope encryption, the signer
service, decision tokens. The `SERVER_SIGNERS` registry and its CI fence (B3).
The schema test asserting no plaintext column exists.

**M3 — Agent lifecycle.** Create → configure → deploy → active → pause → revoke.
Both security modes (§17). Deployment reuses `deployAccount`, `installBoundary`.
**Ends with a recorded testnet run and its hashes in `deployments/testnet.json`**,
per the repository's standing rule. Revocation-without-Limen (B9) ships here, or
M3 is not done.

**M4 — Runtime and tools.** `packages/agent`, `packages/tools`,
`packages/policy`. Read tools, then `send_payment`. Web chat first — Telegram is
a channel, not a prerequisite.

**M5 — End-to-end on testnet.** The brief §51 demo, driven from the web chat.
Permitted, refused, revoked. Hashes recorded.

**M6 — Telegram.** Adapter, pairing, commands, notifications. The scheduler
("every Friday") lands here with it.

**M7 — Dashboard.** Lifecycle state, balances, the boundary read from the chain,
the activity feed with its four outcomes distinguished, transaction previews, the
policy panel partitioned into `Enforced by the network` / `Enforced by Limen`.

**M8 — Security suite.** All nineteen attacks from brief §55, each producing a
hash or stating plainly why there is none. Then the landing rewrite (§35/§36),
last — because the page states measured numbers and the measurements have to
exist first.

**P2, explicitly deferred:** SDK, marketplace, multi-agent, DeFi tools,
mainnet, agentic payments, Rust codegen.

---

# PART X — THE SMALLEST WORKING MVP

One user, one agent, one asset, one channel:

> Sign in with a passkey. Describe a payment agent, or demonstrate one
> transaction. Review the derived boundary. Deploy — smart account, agent key
> generated server-side, rule installed. Talk to it in the web chat: *"what's my
> balance"*, *"send 4 XLM to G…"*. It does it, on testnet, with a hash. Ask for
> more than the cap: **the network refuses**, with a hash and a contract error
> code. Revoke from the dashboard. Ask again: it fails, and it fails
> *differently*.

That is M0–M5. It is the whole §52 wow moment minus Telegram, and every
transaction in it already has a precedent hash in `deployments/testnet.json`.

---

# PART XI — KEEP / REFACTOR / REUSE / REPLACE

*Brief §44 and §44.1. Every existing module, with the reason.*

## `packages/core` — **KEEP**, not one line changed

| Module | Verdict | Reason |
|---|---|---|
| `types.ts` | KEEP | The domain model. Integer amounts, `bigint`, no floats. |
| `synthesize.ts` | KEEP | Deterministic derivation. The runtime calls it through `packages/policy`, never directly. |
| `evaluate.ts` | KEEP | The independent implementation. **Deduplicating it is forbidden** and the file says so. |
| `denycases.ts` | KEEP | The six axes. Now also the shape of the §10 security suite. |
| `test/*` | KEEP | 53 tests. |

## `packages/chain` — **KEEP + ADD**

| Module | Verdict | Reason |
|---|---|---|
| `lower.ts` | KEEP | Where composition-only is enforced. Its refusals become user-facing copy. |
| `plan.ts` | KEEP | OZ limits. `SPENDING_LIMIT_ENFORCED_FN` is the constant B8 turns on. |
| `errors.ts` | KEEP | The four-outcome vocabulary depends on it entirely. |
| `submit.ts` | KEEP | Double simulation. The runtime must not build its own submit path. |
| `read.ts` | KEEP | The dashboard reads the boundary through this, not from the DB. |
| `events.ts` | KEEP | Activity, with `truncated` honesty intact. |
| `sign.ts` | KEEP | `signAs`, `assertDistinctSigners`, `assertTestnet`. Custody calls these. |
| `authpayload.ts` | KEEP | The auth digest. |
| `install.ts` / `revoke.ts` / `deploy.ts` / `token.ts` | KEEP | Lifecycle. |
| `browser.ts` / `bytes.ts` / `network.ts` | KEEP | — |
| `deployments/testnet.json` | KEEP | The evidence. Appended to, never rewritten. |
| `wasm/manifest.json` | KEEP | The pinned tag and four hashes. |
| **`balance.ts`** | **ADD** | SAC `balance` by simulation. `get_balance` needs it; nothing reads balances today. |
| **`extract.ts`** | **MOVE** | From `apps/web/src/lib/`. The runtime needs ingest and must not import from the web app. Pure logic, no Next.js — a clean move. Its 22KB test moves with it. |

## `apps/web/src/lib` — mixed

| Module | Verdict | Reason |
|---|---|---|
| `chain-actions.ts` | **SPLIT** | The transaction-shaping half → `packages/chain/actions.ts`, runtime-neutral. The browser wiring (`loadChain`, `LocalKey`) stays. This is the seam the module was already built to be. |
| `extract.ts` | MOVE | → `packages/chain` (above) |
| `redact.ts` | MOVE | → `packages/shared`. Applied to every server egress, not only reports. |
| `status-labels.ts`, `key-roles.ts`, `markers.ts` | MOVE | → `packages/shared`. Content, not markup — the direction these files already argue for. |
| `local-key.ts`, `use-local-keys.ts` | KEEP | The browser owner path. Docstring narrowed per B5. |
| `passkey.ts`, `use-passkey.ts` | **PROMOTE** | From an option to the default owner and the identity. The measured verifier requirements are the most expensive knowledge in the repository. |
| `store.ts` | NARROW | Stays for browser-local provenance. Header rewritten per B6. |
| `rate-limit.ts`, `tx-cache.ts` | **REPLACE** | Redis-backed. Retires two `TODO(roadmap)`s. |
| `demo-signer.ts` | KEEP | The template for B3's registry. Its four fences are the pattern. |
| `report.ts`, `verdict.ts`, `explorer.ts`, `format.ts`, `mark.ts`, `theme.ts` | KEEP | — |
| `evidence.ts`, `recorded-runs.ts` | KEEP + EXTEND | Extended with `deploySeconds` (§7.2) and the V8 run blocks. |
| `demo-state.ts`, `use-lowering.ts`, `headroom-options.ts` | KEEP | — |
| `repository.ts`, `site-links.ts`, `docs-nav.ts` | KEEP | — |

## `apps/web` screens

| Screen | Verdict |
|---|---|
| `/` | **REWRITE** — brief §35/§36. Last, after the numbers exist. |
| `/app/simulator` | **KEEP** — the deny table, locally adjudicated and labelled. Becomes *Try a Demo* (§35's secondary CTA). |
| `/app/policies/[id]` | **KEEP → FOLD** into the agent dashboard. Six network refusals with hashes; this is the product. |
| `/app/try` | **REFACTOR** into *Create an Agent*. Already the whole product as one path. |
| `/app/accounts/*` | KEEP as the technical view behind the agent view |
| `/app/activity` | FOLD into the dashboard's activity feed |
| `/docs` | KEEP + **`/docs/custody`** — new, and mandatory: the §3 answer, with the agent key's powers enumerated and each refusal's hash. |

## CI

| Check | Verdict |
|---|---|
| Three test suites | KEEP |
| `evidence:check` | KEEP + extend |
| Demo-signer sentinel | **GENERALISE** → the `SERVER_SIGNERS` registry (B3) |
| Testnet-only bundle gate | KEEP, all three levels |
| No `S…` in the client bundle | KEEP, and **add the server-side twin**: no plaintext seed in any log sink, proved two-sided |
| Playwright layout gate | KEEP, extended to new routes |
| `npm audit --audit-level=low` | KEEP at zero |
| **New:** dependency-direction test | ADD — `agent` may not import `core` or `custody` |
| **New:** schema test | ADD — no plaintext-secret column exists |
| **New:** Telegram isolation test | ADD — the adapter imports no policy, custody, or chain module |

---

# PART XII — HOW THE DISCIPLINES SURVIVE

*Brief §44.1. Each one, and the mechanism that carries it into V8.*

**Every claim traces to a file, and a check fails when it drifts.** `evidence.mjs`
extends to the V8 runs. `caveats.test.ts` is restored first (B0) and pins every
new caveat in both directions. The independent re-derivation in
`evidence.test.ts` — which deliberately computes each chain figure by a different
route than the generator — extends to the new figures.

**Every screen states whether what it shows is on-chain, computed locally, or a
shipped fixture.** The existing `ON-CHAIN` / `COMPUTED LOCALLY` labels now carry
more weight than before, because B8 puts two constraints of *different kinds*
side by side in one policy panel. The panel is partitioned under two headings
rather than mixed, and the dashboard reads the boundary from the ledger at a
stated sequence number — never from Postgres.

**A refusal is never read off an absence.** `isBoundaryRefusal` gates every
refusal claim in the runtime, exactly as it does in the browser. The four-outcome
vocabulary (§4.4) makes *refused by Limen* structurally unable to borrow *refused
by the network*'s badge. Every §10 security test produces a hash or states why it
could not.

**Limits are stated before the argument.** The hero carries the labels above the
scene, which is already a requirement in `app/page.tsx`'s header. `LIMEN HOLDS
THE AGENT KEY` is `loud` and appears before any deploy action, not after it.

**A caveat is retired only by becoming false.** B0 is the live counter-example
and it is fixed first. Every retirement in this plan (B1, B3, B5, B6) is pinned
in both directions: the old sentence must be absent, the new one present.

---

# PART XIII — WHAT MUST BE TRUE AT THE END

1. A person signs in with a passkey, describes or demonstrates an agent, reviews
   the derived boundary, deploys it, and talks to it — from the web and from
   Telegram.
2. The agent moves real testnet funds, and every movement has a hash.
3. Asking it to exceed its authority produces a **network** refusal with a
   contract error code and a hash — not Limen's opinion.
4. The user can revoke, **including with Limen uncooperative**, and the next
   attempt fails differently (`ContextRuleNotFound#3000`).
5. `NO CUSTODY` is gone from every screen, replaced by two labels that are
   precisely true, in the same words everywhere.
6. `/docs/custody` enumerates what Limen's key can and cannot do, with a hash
   beside each thing it cannot.
7. Design rule 3 reads as the three-key table, with its narrowing written into
   its own history.
8. Every number on the landing page is generated. The duration claim exists only
   if it was measured.
9. `rustSourceFiles` is still `0`. `npm audit` is still `0`.
10. All nineteen §55 attacks are run and recorded.
11. `caveats.test.ts` exists again and pins every caveat in both directions.
12. The full suite is green, and the count on the page matches the count in the
    run.

---

## Two things this plan asks you to decide

**1. B8 — recipient allowlists.** The brief promises them nine times; the chain
cannot enforce them. This plan recommends shipping them as an explicitly
off-chain check, labelled as sharply as the passkey caveat is. The alternative is
writing an unaudited Rust policy, which breaks design rule 2. **If you want them
on-chain, that is a different plan and it starts with an audit budget.**

**2. B9 — passkey as the default owner.** This plan makes it mandatory for any
account with a deployed agent, because a browser-only owner key plus a
server-held agent key is a configuration where the user can lose the ability to
stop something that is still spending. That closes the browser-key path for new
agents. It is the right trade and it is a product decision, not an
implementation detail.

Everything else in this document follows from the §3 answer, and the §3 answer
follows from one sentence: an agent that answers a message signs while nobody's
browser is open.
