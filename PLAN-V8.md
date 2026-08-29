# PLAN-V8 — from a permission layer to an agent platform

**Status: approved in outline; the two open decisions are taken and recorded
(B8 off-chain with three conditions, B9 passkey mandatory). Nothing in this plan
has been implemented. No file outside this one has been touched.**

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

**DECIDED: fixed first, before any V8 work.** A README citing a test that does
not exist is the same fault this project keeps finding, and it must not survive
into a plan that adds surface.

`caveats.test.ts` is **restored**, not struck — striking the two sentences would
remove the evidence of the failure along with the failure, and the V8 work
multiplies the number of caveats this repository has to keep honest. The restored
suite pins every surviving caveat in **both directions**: the sentence present
where it still holds, and absent where it has stopped holding. That two-sided
shape is what makes it able to catch B1, B3, B5 and B6 when they land.

It is prerequisite work rather than V8 work, and it is **M0**. Approving a plan
that adds fifteen caveats to a repository whose caveat fence is missing would be
the wrong order, and the fence has to exist before there is anything new to
fence.

One thing the restored suite must do that the deleted one did not: **assert it is
non-vacuous.** The original pinned sentences on a landing page, and when that
page was deleted the suite went with it rather than going red. A guard asserting
the set of pinned caveats is non-empty and covers every entry in the README's
"Not done yet" list turns a future deletion into a failure instead of a silence —
which is precisely the hole this entry exists because of.

---

## B1 — `NO CUSTODY` — retired and replaced

**Claim:** *"No key of yours reaches a Limen server, an environment variable, or
a log line. Any key that can move funds here was generated in your browser, stays
in it, and is destroyed when you clear site data."*

**Defined:** `apps/web/src/lib/status-labels.ts:44-45`.
**Rendered as a label:** `apps/web/src/app/page.tsx:68` (hero),
`apps/web/src/app/docs/page.tsx:30`.
**Rendered a third time, as prose, and this one is easy to miss:**
`apps/web/src/app/docs/page.tsx:73` and `apps/web/src/app/page.tsx:424` each
restate the claim in a limits list — *"No custody. No key of yours reaches a
Limen server… Any key that can move funds here was generated in your browser and
stays in it."* Found while restoring the caveat fence in M0. It is not the label
constant, so a search-and-replace on `NO CUSTODY` would leave both standing, and
the sentence is the part a reader actually reads.
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

**Three options were put:**

| | What it is | Cost |
|---|---|---|
| A | Drop recipient allowlists from the MVP claim entirely | The brief's demo script changes |
| B | Ship them as an explicitly-labelled **off-chain** check | Honest, useful, and not a security boundary |
| C | Write the Rust policy | Breaks rule 2 and `rustSourceFiles: 0` |

### DECIDED: B, off-chain, under three conditions

A recipient allowlist checked in the tool layer is genuinely useful — it stops
the *common* failure, which is a confused or prompt-injected model sending to the
wrong place — and it is **worthless against an attacker holding the agent key**.
Both halves go on screen, in the same words everywhere.

Option C remains the trigger for the codegen work the README already gates behind
`compositionOnly: false` — not a reason to write Rust now.

#### B8.1 The check is server-side, in the tool layer. Never in React.

Brief §15 is explicit that the boundary must not exist only in the frontend, and
a recipient check in a React component is not a boundary — it is a hint that
anyone calling the API directly skips. The allowlist is read from
`Policy.enforced_offchain_json` and evaluated inside `packages/policy`, on the
server, on the same path every other gate check takes. The web app may *also*
show the user which recipients are approved; that display is a convenience and
is never the thing that decides.

**Pinned by test:** no module under `apps/web/src/components` may import the
recipient-check function, and the §10 suite calls the runtime API directly with a
disallowed recipient — bypassing the UI entirely — and asserts the refusal still
happens.

#### B8.2 The policy panel is partitioned, and the split is real

Six constraints, two groups, and the grouping is a statement about **who
refuses** rather than a visual tidy-up:

| Constraint | Group | Backed by |
|---|---|---|
| `amount` | **Enforced by the network** | `SpendingLimitExceeded#3221` — hash `ac477549…` |
| `asset` | **Enforced by the network** | `UnvalidatedContext#3002` — hash `1312be89…` |
| `function` | **Enforced by the network** | `NotAllowed#3223` — hash `45a0eb20…` |
| `contract` | **Enforced by the network** | `UnvalidatedContext#3002` — hash `6b7f4ded…` |
| `expiry` | **Enforced by the network** | `UnvalidatedContext#3002` — hash `f5ebce51…`, error code not decoded on-ledger *(the standing caveat, carried)* |
| `recipient` | **Enforced by Limen** | **No hash.** No audited policy contract constrains a transfer's destination. |

The allowed-contract row is network-enforced and stays in the top group. That
matters: the temptation when adding one off-chain constraint is to move
everything address-shaped down beside it, which would silently demote a
constraint the ledger genuinely imposes and has a hash for.

**These five are not the six deny axes, and the difference is deliberate.** The
sixth axis — `invocation`, an appended second call, refused
`ContextRuleIdsLengthMismatch#3014` at hash `e365e681…` — is network-enforced
like the rest but is **not a row in this panel**, because it is not a constraint
a user configures. It is a structural property of how the rule is signed. It
keeps its place in the deny table on `/app/simulator` and on `/docs/reference`,
and a reader who counts five here and six there must find that difference stated
rather than infer that something was quietly dropped.

**The off-chain row must never borrow the visual language of a hash-backed
one.** Concretely, and enforceable by the design suite the same way the four
verdict states already are:

- No `ExplorerLink`, no truncated hash, no monospace hash column — the row has
  nothing to link to, and an empty hash cell reads as *pending*, not as
  *inapplicable*.
- It carries `COMPUTED LOCALLY`, which is the existing label for exactly this
  and already means *nothing on chain asserts it, and no network enforced it*.
- The reason is stated in the row, not in a footnote: *no audited policy
  contract constrains a transfer's destination*.
- The group heading is rendered even when a group has one member. A single
  ungrouped row beneath five grouped ones reads as an afterthought rather than
  as a different kind of thing.

The panel copy:

> **Enforced by Limen — recipient allowlist.** Limen's server refuses a payment
> to an address you have not approved. Unlike your cap, your asset, your
> function, your contract and your expiry, **the ledger does not enforce this**
> — no audited policy contract constrains a transfer's destination. Someone
> holding the agent key could send to any address, up to your cap. Lower your
> cap if that matters more to you than convenience.

This is the same distinction the simulator already draws between its local deny
table and the network's refusals, applied to the policy display. The precedent
for keeping two kinds of refusal visually apart is already in the codebase:
`errors.ts` deliberately keeps `REVOKED_RULE_CODES` out of
`BOUNDARY_REFUSAL_CODES` so *"the boundary refused you"* and *"the boundary is
gone"* cannot render identically.

#### B8.3 The §55 test asserts provenance, and the absence is the finding

Brief §55's *"use unauthorized recipient"* case does not assert "the payment was
refused". It asserts **where the refusal came from**:

```
attempt:    send_payment to an address not in the allowlist
expect:     refused
expect:     refused_by_limen, NOT refused_by_network
expect:     no transaction hash — nothing reached a ledger
expect:     the recorded reason names the off-chain allowlist
```

The absent hash is the **result**, not a gap in the test. Every other case in
§10 produces a hash; this one produces a recorded statement that it could not,
and the report says so in those words. A suite that quietly let this row look
like the other five would be asserting network enforcement that does not exist —
which is the precise failure the `resourceLimitExceeded` incident taught this
repository to test for.

The companion case is the one that proves the honesty of the pair: **with the
gate bypassed** — calling `packages/custody` with a hand-built decision token for
a disallowed recipient — the payment **succeeds on-ledger, with a hash**. That
transaction is recorded in `deployments/testnet.json` as evidence of the limit,
not hidden as an embarrassment. It is the single clearest demonstration of what
"enforced by Limen" costs, and it belongs on `/docs/custody`.

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

### DECIDED: mandatory. Revocation that depends on Limen's cooperation is not revocation.

That is the one failure the §3 custody answer cannot survive. If Limen holds a
key that spends, and stopping it requires Limen to be up, honest and willing,
then the boundary is a promise again and the whole argument collapses back to
where every other platform already is.

**Five requirements on the MVP:**

1. **Passkey owner is mandatory** for any account with a deployed agent — not a
   default, not a recommendation. §B9.1 for what that means for existing
   accounts.
2. **Limen sponsors the fee for owner revocation.** A Limen-owned fee account
   pays; the owner signs the auth entry with the passkey. Limen cannot forge that
   entry, so sponsoring the fee grants Limen nothing and removes the last reason
   revocation could need the browser's local key.
3. **`valid_until` is mandatory and short** for agent rules. **A mitigation, not
   a substitute** — see §B9.2.
4. **A revocation path that does not require Limen at all.** `/revoke` as a
   standalone route needing only the passkey; `/revoke` from Telegram (which
   deep-links to the passkey, since Telegram must not be able to revoke on its
   own); and a **documented `stellar` CLI invocation in `/docs/custody`** for the
   case where Limen is down, gone, or refusing. That last one is the only version
   of this that is a real guarantee, and it is the one that must ship. It is
   verified in M8 by revoking an account **with the runtime stopped**, and the
   resulting hash is recorded.
5. **No agent deployment from an IP-reached origin** — §B9.3.

#### B9.1 Existing browser-key accounts, and what "cannot be upgraded" means exactly

The owner signer is **fixed at creation**: it is chosen on `/app/accounts/new`
and written into the account's constructor, and which owner an account has is
read back from the chain (the Default rule names its verifier) rather than
remembered. So a browser-key account cannot become passkey-owned **through any
code path that exists today**.

One precision, because the file that records this finding is explicit that
nobody should plan around its absence: `packages/chain/src/deploy.ts:29-42` names
`batch_add_signer` as a contract primitive that **could** add a second owner
signer later, authorized by the first. It is out of scope for V8 and is not
being built. But the honest statement is *no upgrade path is built*, not *the
contract forbids it* — and if enough existing accounts turn out to want one, that
is the primitive it would be built on.

**So the rule is per-account, evaluated at agent-deploy time**, not a global
switch and not a migration:

- An account whose Default rule names the **webauthn verifier** → agent
  deployment proceeds.
- An account whose Default rule names the **ed25519 verifier** → agent
  deployment is refused, with a **message rather than a disabled button**:

> **This account is owned by a key in this browser.** An agent Limen runs for
> you keeps signing after you close this tab — so the key that can stop it must
> outlive the tab too. Clearing site data would destroy this account's owner key
> while the agent kept spending.
>
> An account's owner is fixed when it is created, so this one cannot be
> converted. **Create a passkey-owned account** and deploy your agent there.
>
> This account keeps working for everything else: derive a boundary, install it,
> run the browser agent flow at `/app/try`. It is agent deployment specifically
> that needs an owner your browser cannot lose.

A disabled button with a tooltip would leave a person guessing at a rule; the
message names the reason, the consequence, and the next action. The existing
browser-key path is **not deprecated** — it remains the whole of `/app/try`, the
lifecycle e2e suite, and the three recorded browser runs, none of which involve
a Limen-held key.

#### B9.2 Expiry is a mitigation, not a substitute

Stated plainly because it is the tempting shortcut: *"`valid_until` bounds the
damage, so requirement 4 can slip to P1."* It cannot.

**A seven-day `valid_until` is seven days of an agent nobody can stop.** For an
agent with a 500-unit daily limit that is 3,500 units, spent by a key the owner
cannot revoke, on a schedule they cannot pause. Expiry bounds the *total*; it
does nothing about the interval, and the interval is the whole complaint.

Expiry earns its place for the case requirement 4 does not cover — an account
genuinely abandoned, where nobody is trying to revoke because nobody is left —
and it is mandatory for that. It is not the answer to *"what if the owner wants
to stop this now"*. Requirement 4 is, and it ships in M3 or M3 is not done.

#### B9.3 No agent deployment from an IP-reached origin

Inherited from PLAN-V7 §5.4.2's measured finding: **WebAuthn refuses an
IP-literal origin.** A Relying Party ID must be a registrable domain, so
`navigator.credentials.create` on `http://127.0.0.1:3000` fails with
`SecurityError: This is an invalid domain` before any authenticator is consulted.
`localhost` and a real domain are the two origins where the passkey path
functions at all.

Since B9 makes a passkey owner mandatory for agent deployment, that finding stops
being a developer-ergonomics footnote and becomes a **deployment
precondition**. If the app is reached by IP, no passkey can be created, so no
compliant account can be created, so no agent may be deployed — and the failure
must arrive as a stated reason at the top of the flow rather than as a
`SecurityError` in the console at the moment someone commits.

**So:** the create-agent flow checks the origin **before** offering anything, and
an IP-literal origin gets a named refusal — *Limen must be reached by a domain
name; passkeys cannot be created on an IP address* — with `localhost` called out
as the working local option. The check is server-side as well as client-side, so
a deployment API call from an IP-reached origin is refused rather than merely
undisplayed. This also becomes a documented hosting requirement in
`/docs/custody`.

---

## B10 — Landing hero — repositioned, not falsified

`app/page.tsx:70` — *"The boundary is derived, not authored."* Brief §36 demotes
it. Still true, still the differentiator, moves below the fold. No test change
beyond the copy fences.

## B12 — Two claims that left the landing during the V6 rebuild. Found by M0.

Not caused by the repositioning, and not caused by anything becoming false.
Surfaced by restoring `caveats.test.ts`, and recorded here because M0 is a repair
of the fence and landing copy is a product decision.

**B12.1 — the landing's limits list lost two entries.** It used to state *no
wallet, and no key recovery* and *one contract per boundary*. The rebuilt list
states five: `Testnet only`, `Not audited`, `Composition only`, `No custody`,
`Single-transaction derivation`. Both dropped limits are **still true** and both
are **still in the README** — the wallet finding under *Why there is no wallet
button*, the recovery caveat under *Your account is stranded if you clear your
browser*, the contract limit under *Only single-token transfer flows can be
installed*. They were not retired; they left the page.

The comment on the test that used to pin them read: *"a limits list that quietly
shortens as features land reads as marketing."* The list then quietly shortened,
in the same rebuild that deleted the test.

**B12.2 — the landing no longer mentions the browser run.** Neither the retired
*"the browser has not signed anything yet"*, nor the replacement *"the browser
has signed, and no person has clicked"*, nor the driver caveat. Defensible on its
own terms: the V6 landing argues from the recorded deny-axis survey rather than
from the browser lifecycle run, so a caveat about the lifecycle run has nothing
on that page to qualify. Pinned in M0 as a **conditional** — if the landing ever
cites the run again, it must cite the limit with it.

**Proposal for both: decide during M8, when the landing is rewritten anyway.**
The V8 landing will make claims neither of these lists anticipated, so restoring
two entries to a list that is about to be replaced is churn. What M0 guarantees
in the meantime is that neither claim can now be lost from the README as well,
and that the browser-run caveat cannot come back without its limit.

**What this pair is actually evidence for.** Both are small. Neither is a
falsehood. The point is that they happened *in the same rebuild that deleted the
suite that would have caught them*, and stayed unnoticed for two versions — which
is the case for M0 blocking everything, made out of this repository's own history
rather than out of principle.

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
packages/kv          NEW                 shared state: rate limits, the tx cache, the queue.
                                         Two access paths like db — HTTP for web, TCP for the
                                         runtime, because the queue has to block.

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

## 7.5 Deployment and the stack

| Component | Where | Why |
|---|---|---|
| `apps/web` | Vercel | Already shaped for it |
| `apps/runtime` | One long-lived Node container (Fly/Railway/Render) | §7.5.4 — and **not for the reason usually given** |
| `apps/telegram` | Same container, separate route | One deploy, no cross-service auth |
| Postgres | Neon (managed) | §7.5.2 |
| Redis | Managed | Shared rate limits, the tx cache, the submission lock — retires two `TODO(roadmap)`s |
| Master key | `KeyProvider` interface; env-var master at M2 | §7.5.3 |

**Sequence-number serialization is a correctness requirement, not an
optimisation.** The demo signer already serializes submissions so concurrent
reviewers cannot collide; with N agents sharing fee accounts and a scheduler
firing, this becomes a per-fee-account lock in Redis. Two agents building on the
same sequence number produce a failure that looks exactly like a refusal, which
is the one failure this product cannot afford to render wrong.

### 7.5.1 Drizzle, specifically, and not Prisma

Both were candidates. Drizzle wins on a reason particular to this repository
rather than on general preference.

**The audit gate is at `--audit-level=low`, which is the strictest npm offers,
and it currently stands at zero.** Getting it there cost real work: 36 advisories
reduced to 23 by five overrides, then to zero only by *removing a dependency
nothing imported* — `@creit.tech/stellar-wallets-kit`, which dragged in
`elliptic` through two independent paths under an advisory covering `*`, every
published version, with no version to pin to and no override that could reach
it. The README documents that episode at length, and its lesson is that a
transitive dependency you do not control can hold a security gate hostage
indefinitely.

Prisma ships a binary query engine and a substantially larger dependency
surface. Drizzle is TypeScript that compiles to SQL, with the driver as the only
native-adjacent piece. On a gate that has already been held hostage once, the
smaller surface is not a stylistic preference — it is the difference between an
advisory being a fix and an advisory being a hostage negotiation.

Two secondary reasons that matter here specifically:

- **Migrations are readable SQL files.** A reviewer can check them by reading,
  which is the standard every other artefact in this repository is held to.
  Prisma's migration diffing is a step further from what actually runs.
- **No codegen step in the build.** `evidence:check` already re-runs three
  suites; adding a generate step that must be in sync or the build lies is the
  class of problem this project keeps designing away from.

### 7.5.2 Connection pooling — the decision, not a detail

Correct: a plain `pg` client from serverless functions exhausts Postgres.
Vercel autoscales to 30,000 concurrent executions, each instance opening its own
connection, against a Postgres accepting a few hundred. Vercel's own limits page
lists **1,024 file descriptors shared across concurrent executions** and names
database connections as consumers of them.

**Two access paths, one schema, chosen per runtime shape:**

| Consumer | Driver | Endpoint | Why |
|---|---|---|---|
| `apps/web` (Vercel, many short-lived instances) | `drizzle-orm/neon-http` | Neon HTTP | Stateless. Each query is an HTTP request; **there is no connection to exhaust**, so the 30,000-instance case has no pool to run out of. |
| `apps/runtime` (one long-lived process, small fixed count) | `drizzle-orm/node-postgres` with a bounded `pg.Pool` | Neon **pooled** (`-pooler`, PgBouncer transaction mode) | A known, small number of processes holding a bounded pool is the case a pool is actually for. |
| Migrations | `drizzle-kit` | Neon **direct** (unpooled) | Transaction-mode poolers break DDL and the session advisory locks migration tools take. Running migrations through the pooler is a well-known way to get a half-applied schema. |

**The constraint this buys, stated because it is load-bearing elsewhere in this
plan.** `neon-http` is documented as supporting single non-interactive queries
and **not** interactive transactions — multi-statement work with conditional
logic between statements needs the WebSocket driver or the pooled endpoint. That
is acceptable because of how the work divides: the web app reads and writes
single rows, and **every multi-statement money-path operation lives in
`apps/runtime`**, which is on `node-postgres` and has full transaction support.
If a web route turns out to need an interactive transaction, it moves to the
runtime API rather than the driver changing — which is the right pressure anyway,
since a money-path write reaching the database from a Vercel function is
something this architecture should resist.

And transaction-mode pooling breaks three things the design must therefore not
use: **session-level advisory locks** (the sequence lock is Redis — already the
plan), **`LISTEN`/`NOTIFY`** (job dispatch is Redis, not Postgres pub/sub), and
**named prepared statements** (Drizzle's `.prepare()` is not used on the pooled
path). All three are decided here rather than discovered as an intermittent
failure under load.

**One thing to verify at M1 rather than assume**, in the idiom this repository
uses everywhere else: that `drizzle-orm/neon-http` behaves as documented for the
specific query shapes the web app needs, measured against a real Neon instance
before the schema is built on top of it. The driver's transaction limitation is
documented; how it surfaces in Drizzle's API is the part worth ten minutes and a
recorded result.

#### RUN — the `neon-http` transaction measurement

**Status: run against live Neon, 2026-08-21. Case 1-and-2, not case 3.** The
result is recorded here in full rather than as a tick, because the whole point
of the entry was that a measurement quietly becoming "checked" is the failure.

**Result, measured rather than inferred:**

- `db.transaction(...)` on a `createWebDb` handle **throws**
  `"No transactions support in neon-http driver"`, and **leaves no rows
  behind**. That is case 2 — the recoverable one — and it rules out case 3,
  which was the case the measurement existed for.
- `db.batch([...])` **is atomic**. Proved by the destructive half rather than
  the happy path: a deliberate unique-constraint violation in the second
  statement rolled the whole batch back, and zero rows survived.
- Single statements work, as documented.

**What follows, and what does not.**

`createWebDb` does **not** grow a fence. The fence in the plan above was
conditional on case 3 — a silent unwrap has to be turned into a loud refusal
because nothing else would show it. A driver that already throws is already
loud, and wrapping a throw in a different throw adds a mechanism with nothing
left to catch.

What the batch result buys is narrower and worth stating: **`apps/web` can write
two rows atomically without an interactive transaction.** That is not a licence
to move money-path work back into the web app — `web.ts`'s rule stands, and a
route needing conditional logic between statements still moves to
`apps/runtime`. It is what lets the agent builder write an `agents` row and a
`policies` row as one unit, which is a pair of inserts with no logic between
them, rather than as two writes with a window where the first can survive alone.

Source reading agrees and is not the evidence: `drizzle-orm@0.45.2`'s
`neon-http/session.js` maps `batch` onto `client.transaction(builtQueries)` and
defines `transaction` as a bare throw. It is recorded because it explains the
measurement, not because it substitutes for it.

**Still outstanding, and it is one line under `packages/`.**
`packages/db/src/web.ts:41` still says this measurement *"has **not** been run"*.
That sentence is now false and is the exact drift-in-prose failure B0 exists
about. It was left in place deliberately rather than edited in passing: the
agent-builder work is fenced off from `packages/`, and a header rewrite there
belongs to whoever is allowed to touch it. **It is the first thing the next
change under `packages/db` should fix.**

**What it would settle.** Neon documents that `neon-http` supports single
non-interactive queries and not interactive transactions. What is *not*
documented, and is the part that matters, is **how that surfaces in Drizzle's
API**. There are three possibilities and they are not equally survivable:

1. `db.transaction()` is absent from the type — a compile error, which is the
   good case and needs no further fence.
2. It exists and throws at runtime — recoverable, but it must be proved to throw
   rather than assumed to, or a rarely-taken route carries it to production.
3. **It exists and silently runs the statements unwrapped.** This is the case
   the measurement is for. A caller believing three writes are atomic when they
   are three independent writes is precisely the failure the whole two-path
   division of work exists to prevent, and nothing in the type system or the
   test suite would show it.

**What it cannot be inferred from.** Not from the Neon documentation, which
describes the driver and not the ORM wrapper. Not from `drizzle-orm`'s types
alone, because case 3 is a runtime behaviour that type inspection cannot
distinguish from case 1. And **not from the local Postgres this milestone runs
against**: `neon-http` speaks Neon's HTTP protocol, so a container cannot
exercise the driver at all. Every other schema property in M1 is proved against
a real database; this one specifically cannot be.

**What would close it.** A Neon instance, and roughly ten minutes: call
`db.transaction()` on a `createWebDb` handle with two statements where the
second fails, then read the table. If the first statement's effect survives, it
is case 3, and `createWebDb` grows a fence that makes `transaction` unreachable
— the same shape as `assertPoolable` in `packages/db/src/forbidden.ts`, and for
the same reason: a limitation that only shows up as silent wrong behaviour has
to be turned into a loud refusal.

**The session store shares this constraint, and is handled the same way.**
`apps/web/src/lib/session.ts` reaches Postgres over the same `neon-http` path,
so a local container cannot exercise its binding either. The response is to make
the untestable part as small as possible rather than to pretend it is covered: a
`SessionStore` interface holds every decision — token hashing, expiry filtering
in the lookup rather than after it, cookie attributes, immediate revocation —
and all of it is proved against a fake. What is unproven is the Drizzle binding
underneath, which is thin by design and is a handful of statements. The
distinction worth keeping is that this one has no silent-wrong-answer mode
either: a session lookup that does not work fails visibly at the first login.

**Why M1 proceeded without it.** The two properties M1 actually has to
establish — that the migration applies, and that the schema fences fire — are
both provable against local Postgres, and both were. This is a question about
one driver's behaviour, and holding four commits of foundations on a Neon
account that does not exist yet would have been the wrong trade. `web.ts`'s
header states the same thing at the code, so a reader of the module is told
before a reader of this plan.

#### RUN — the append-only grant, refused by a real Postgres

**Status: run against a local Postgres 16, 2026-08-22.** Recorded here for the
reason the two entries around it are: `packages/db/test/append-only.test.ts` had
been skipping its six real assertions on every machine without a database, and a
fence that has never been exercised is a `GRANT` somebody typed rather than
access somebody was refused.

**The arrangement, which is the test's subject and not its scaffolding.**
Postgres gives a table's owner every privilege on it regardless of grants, so
"append-only" is a deployment fact. The run constructs exactly the deployment
the property depends on: `limen_owner` owns the database and every table and is
the role the migrations connect as; `limen_app` is the NOLOGIN group role `0001`
creates; and the test creates `limen_test_app` per run — a login role that owns
nothing and holds its privileges only through membership in `limen_app`.

**Result, as refusals rather than as a tick.**

| As `limen_test_app`, a non-owner | Postgres |
|---|---|
| `INSERT INTO audit_events` | `INSERT 0 1` |
| `SELECT FROM audit_events` | permitted |
| `UPDATE audit_events SET action = 'rewritten'` | `ERROR: permission denied for table audit_events` |
| `DELETE FROM audit_events` | `ERROR: permission denied for table audit_events` |
| `UPDATE agents` | permitted |

The last row is what makes the two refusals mean something: a role with no
privileges anywhere would produce the same two errors for the wrong reason.
`\dp` agrees with both halves — `limen_app=ar/limen_owner` on `audit_events`
against `limen_app=arwd/limen_owner` on `agents` — but the privilege table is a
reading of the same SQL and is not the evidence. **The grant holds.**

**One finding, and it is about PG16 rather than about the fence.** The suite was
not re-runnable on first setup. PG16 changed `createrole_self_grant` to default
to empty, so a `CREATEROLE` role now receives only `ADMIN OPTION` on roles it
creates — not `SET` or `INHERIT`. `DROP OWNED BY` requires the *privileges of*
the role, so the test's `afterAll` cleanup failed; and because that cleanup is
deliberately `.catch()`-swallowed, it failed silently and left the throwaway
role behind holding a database-level `CONNECT` grant. The next run's
uncaught `DROP ROLE IF EXISTS` then died with *"cannot be dropped because some
objects depend on it"*. Fixed in the environment and not in the test —
`ALTER ROLE limen_owner SET createrole_self_grant = 'set, inherit'` — which
restores the posture CI already has for free, since CI's container connects as
the `limen` superuser. Two consecutive runs then passed. It is worth knowing
that the test's re-runnability rests on a role attribute nothing in the
repository states.

**Standing it up, since `.env.m1` is gitignored and nothing else records this.**
Ubuntu's `postgresql-16`, started with `pg_ctlcluster 16 main start` because a
Codespace has no runlevel for `invoke-rc.d` to find:

```sql
CREATE ROLE limen_owner LOGIN PASSWORD '…' CREATEROLE;
ALTER  ROLE limen_owner SET createrole_self_grant = 'set, inherit';
CREATE DATABASE limen_test OWNER limen_owner;
```

Then `MIGRATE_DATABASE_URL=…limen_owner@127.0.0.1:5432/limen_test npm run
migrate -w @limen/db`, and the same URL as `TEST_DATABASE_URL`. Note that
`TEST_DATABASE_URL` is the **owner** connection, not the application one: the
test creates the throwaway login role, grants it `limen_app` and grants it
`CONNECT`, all of which is owner work, and *derives* the non-owner application
connection from it by swapping the credentials. CI's `TEST_DATABASE_URL` is its
container's superuser for the same reason.

**What it costs the numbers.** `@limen/db` reports 34 passing and zero pending,
which is the count `apps/web/src/generated/evidence.json` already carried —
`scripts/evidence.mjs` refuses to record a skipped test as a passing one, so
that figure could not have been generated without a database and is now
reproducible outside CI.

#### PARTLY RUN — the shared-store contract, and what a container can prove

**Status: run against a real Redis, except for Upstash.** Recorded in the same
register as the `neon-http` measurement above, and deliberately kept next to it,
because the two ended differently for a reason worth keeping.

**What ran.** A Redis 7 container, with `REDIS_URL` pointed at it:

| Suite | Against | Result |
|---|---|---|
| `packages/kv/test/contract.test.ts` | `MemoryKeyValue` **and** `RuntimeKeyValue` | 35 cases. Without `REDIS_URL` the same file runs 25 — the ten-case difference *is* the real-service coverage. |
| `apps/runtime/test/queue-redis.test.ts` | real Redis | 8 cases. The at-least-once claim: a reserved job sits in `processing` until settled, a job whose worker died is recovered, FIFO order holds, and `LREM` settles exactly one of two byte-identical jobs. |
| `apps/runtime` process | real Redis | Starts, recovers, blocks on an empty queue, and on `SIGTERM` finishes in flight and exits 0 rather than being killed. |

So the durability argument of §7.5.4 reason 1 is **proved rather than asserted**.
That matters more than the count: `BLMOVE` leaving a job recoverable is the
property the whole worker design rests on, and it is not a property a fake can
establish — a mock that agreed with the design would have proved only that the
design agrees with itself.

**What is still unrun: `UpstashKeyValue`.** It needs an Upstash account, and its
HTTP protocol is not something a container speaks. The contract suite is already
parameterised over implementations, so pointing it at a real instance is
configuration rather than new test code — no suite to write at the moment
somebody is least inclined to write one.

**Why proceeding on that is acceptable, when the `neon-http` one was not.** The
difference is the failure mode, not the effort. `db.transaction()` may silently
run statements unwrapped, and nothing in the types or the suite would show it —
a caller believes three writes are atomic and they are three writes. `INCR` has
no equivalent: it either returns a monotonically increasing number or it does
not, and the contract suite says which the moment it is pointed at one. An
unverified property with a silent-wrong-answer mode blocks; one without it does
not.

**What this run also found, which is worth more than the passes.** Two orphaned
workers from a shutdown test were left blocked on the default queue keys, and
they ate the fixtures the suite enqueued — six failures that read exactly like a
broken queue. The fix is in the code rather than in a habit: `Queue` takes a
`namespace`, the Redis suite runs in a unique one, and a case asserts it is
**not** the default, so the suite can neither be stolen from nor delete real
jobs in its own `beforeEach`. Verified by running a competing worker on the
default keys throughout the suite and watching all 27 cases pass.

**Provisioning Upstash is still not done and is not doable here** — no Vercel or
Upstash credentials in this environment. Until it exists the production
deployment refuses to start, which is the designed behaviour and the reason that
refusal was built before the traffic rather than after.

### 7.5.3 KMS: build the interface, not the dependency

**Agreed, and adopted.** The interface ships at M2; the dependency does not.

```ts
interface KeyProvider {
  wrapDataKey(plaintext: Uint8Array): Promise<WrappedKey>;
  unwrapDataKey(wrapped: WrappedKey): Promise<Uint8Array>;
  readonly id: string;   // recorded on every AgentKey row
}
```

Two implementations. `EnvMasterKeyProvider` reads a master key from an
environment variable. `KmsKeyProvider` calls AWS KMS / GCP KMS / Vault and is
**not written at M2**.

The threat model this is honest about:

| Threat | Env-var master | Real KMS |
|---|---|---|
| Database dump | Protected | Protected |
| Backup leak | Protected | Protected |
| SQL injection | Protected | Protected |
| Read-only DB access by an operator | Protected | Protected |
| **Full host compromise / env leak** | **Not protected** | Protected (key never leaves the KMS) |

So the two differ **only** when the environment variable leaks along with the
database — and that is precisely the exposure `LIMEN_DEMO_SECRET` already carries
today, on testnet, deliberately, and documented. Adding a second value with the
same exposure profile does not introduce a new class of risk; it widens an
accepted one.

Three conditions on accepting that trade:

1. **It is stated on `/docs/custody`, in the same register as everything else** —
   not in a config comment. Draft: *"Your agent's key is encrypted in our
   database with a master key held in the server's environment, not in a
   hardware security module. Someone who obtained both the database and the
   server's environment could use your agent's key — within the boundary your
   account enforces, which is the part that does not depend on us. On mainnet
   this would not be acceptable, and it is one of the reasons there is no
   mainnet."*
2. **Real KMS is a documented mainnet precondition**, listed beside "not audited"
   as a thing that must become true first — not a `TODO(roadmap)` that decays.
3. **Swapping it is a module, not a refactor.** Pinned by test: exactly one
   module constructs a `KeyProvider`, `kms_key_id` is recorded on every
   `AgentKey` row from the first migration so rows are attributable after a
   provider change, and the env-var implementation **refuses to construct when
   `NODE_ENV=production` and the network is not testnet** — the same shape as
   `demo-signer.ts`'s hard throw, which is a fence rather than a warning.

### 7.5.4 Where the runtime runs — decided here, at M1, not discovered at M4

Correct that this matters more than the database, and correct to force it now.
The recommendation is a **persistent process for `apps/runtime`, with `apps/web`
staying on Vercel** — but the usual reason for that is not the real one, and
getting it right changes what the design has to defend.

**Duration is not the binding constraint.** Measured against Vercel's current
limits rather than assumed: with fluid compute, Node functions default to **300s
on every plan**, with 800s available on Pro and Enterprise. An agent turn — LLM
call, build, simulate, sign, re-simulate enforcing, submit, wait for close — is
**15–45 seconds typically**. It fits with an order of magnitude to spare. And
Vercel bills active CPU, explicitly *not* I/O wait, so the cost objection to
sitting on a ledger close is weaker than it sounds too. If duration were the only
issue, the runtime would go on Vercel.

**The four reasons that do bind:**

1. **Durable execution of money-moving work.** An agent turn that dies after
   submission and before recording has spent funds with no record. This needs a
   queue with at-least-once delivery, an idempotency key checked before
   submission, and a retry that can tell "not yet submitted" from "submitted,
   result unknown". That is a worker-and-queue shape. It is buildable on
   functions, but every part of it is then reconstructed from primitives that a
   persistent worker gets for free.
2. **The scheduler.** Brief §6's *"pay my contractor 20 USDC every Friday"* is a
   different shape from a request. Vercel Cron can poll a `ScheduledTask` table
   on a minute tick and would work; a persistent process with a real scheduler
   is the honest fit, and it is the same process the queue already needs.
3. **Single-writer discipline.** Redis locks make correct behaviour *possible*
   across N instances. A bounded set of long-lived workers makes it *cheap*, and
   makes the failure mode when the lock layer misbehaves a queue backup rather
   than two transactions on one sequence number — which, per §7.5, is the one
   failure this product cannot afford to render wrong.
4. **Availability coupling.** The money path's uptime should not be a property
   of the frontend host's function semantics. Separating them means a web
   deployment cannot take the agents down.

**And the accept-fast, work-async shape follows from these rather than from
duration.** Telegram retries an unacknowledged webhook, and an agent turn should
not be inside a webhook handler regardless of how long the handler is allowed to
live:

```
Telegram webhook / web chat POST
        │  verify, enqueue, ACK immediately  (< 1s)
        ▼
    Redis queue
        │
        ▼
  apps/runtime worker — the agent turn, idempotency-keyed
        │
        ▼
  result delivered: Telegram sendMessage, or SSE to the open web tab
```

**The honest alternative, recorded so it is not rediscovered as an idea.** This
*could* run entirely on Vercel: fluid compute for duration, Vercel Cron for the
scheduler, Redis for locks, `waitUntil` for post-response work, and Vercel
Workflows — which exist for exactly the pause-and-resume case — for durability.
That is a legitimately simpler operational story, one deploy target, and it
should be reconsidered if the container turns out to be the main source of
operational cost. It is not chosen because reasons 1 and 4 are about the money
path specifically, and the money path is the thing this project has spent seven
plans making checkable.

**Decided at M1**, which is where the process boundary gets built into the
package layout. Discovering it at M4 would mean moving `packages/agent`'s
callers, its queue, and its scheduler after they have consumers.

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

Each milestone ends with the fence that keeps it honest, because a milestone that
ships behaviour and defers its check is how the B0 fault happened.

### M0 — Repair. Its own branch, its own PR, off `main`.

- Restore `caveats.test.ts` (**B0**), two-sided, with the non-vacuity guard.
- Correct `README.md:507` and `README.md:572` to name the restored suite truly.
- Widen the tripwire's `ROOTS` from an enumerated list to discovered
  `packages/*/src` + `apps/*/src` (**B4**), with a guard asserting the discovered
  set is non-empty and contains the known workspaces.

**Branched from `main`, not from the V8 branch, and the reason is not
separability.** M0 is correct whether or not V8 ever happens. Verified on
`main` at `b9cdc82`: `README.md:507` and `README.md:572` both cite
`apps/web/test/caveats.test.ts`, and `git cat-file -e main:apps/web/test/caveats.test.ts`
fails — the file is not there. That is a live inaccuracy in the shipped README of
the default branch today. If V8 stalls, gets rethought, or is abandoned, this
repair must already have landed rather than being held hostage to it.

**Done when:** the suite is green, deleting any pinned caveat turns it red,
adding an unscanned workspace turns it red, and the PR is merged to `main`
independently of anything else in this plan.

**Delivered — PR [#15](https://github.com/dakshdrall/limen/pull/15),
`m0-restore-caveat-fence`, branched from `main` at `3cfce13`.**

- `caveats.test.ts` restored. 45 of its 60 original assertions still passed
  against the rebuilt tree; of the 15 that did not, **none had become false** —
  every one was a claim that had moved (the label set to `lib/status-labels.ts`,
  four verdict sentences to `lib/verdict.ts`, the two-runs seam into the
  deployments file, four docs claims into the README when V6 split `/docs`). Each
  is re-pointed with the move recorded at the assertion.
- **The README needed no edit.** Both cited claims are genuinely pinned in both
  directions by the restored suite, verified by name — so restoring made the
  sentences true rather than requiring them to be rewritten, which is the
  outcome that keeps the evidence of the failure.
- The guard lives in `evidence.test.ts`, not in `caveats.test.ts`: *every file
  the README cites is a file that exists*, two-sided, scoped to this
  repository's own directories so the quoted OpenZeppelin sources are not read
  as missing. A suite cannot assert its own existence, and being deleted again
  is the fault being guarded.
- The keygen tripwire's roots are **discovered**, not enumerated. Verified by
  putting a `Keypair.random()` in a `packages/custody/src` and watching the
  suite go red — the precise B4 scenario — then removing it.
- Two findings surfaced and recorded as **B12** rather than repaired.
- 615 tests over 26 files, up from 544 over 25. `evidence.json` regenerated,
  `evidence:check` up to date, lint and build clean.

### M1 — Foundations, and the process boundary

`packages/db` + Drizzle migrations (§7.5.1). `packages/shared` (redactor, status
labels, key roles lifted out of `apps/web`). Passkey authentication with
**server-side origin and challenge verification** (§7.3 — the contract checks
neither, so the login path must). Sessions. Redis, retiring the two
process-local `TODO(roadmap)`s.

**Three stack decisions land structurally here, not just on paper:**

- **§7.5.2** — the two access paths wired and the third proved: `neon-http` from
  `apps/web`, bounded `pg.Pool` from `apps/runtime`, migrations against the
  direct endpoint. Plus the ten-minute measurement of how `neon-http`'s
  transaction limitation surfaces in Drizzle's API, **recorded** rather than
  assumed.
- **§7.5.3** — the `KeyProvider` interface exists with the env-var
  implementation and its production refusal, and exactly one module constructs
  one, pinned by test. `kms_key_id` is on `AgentKey` from the **first** migration,
  so rows stay attributable across a future provider swap.
- **§7.5.4** — `apps/runtime` exists as a separate deployable with the queue and
  the worker loop, even though nothing enqueues yet. The process boundary is a
  property of the package layout, and building it after `packages/agent` has
  consumers means moving them.

**The label and prose changes from B1, B2, B5 and B6 land here**, in the same
commits as the code that makes them true — never after. B4's third label
(`TESTNET ONLY · AGENT KEY (LIMEN-HELD)`) is added here and is unused until M2,
which is the correct order: the closed set gains the label before anything can
render it.

**Done when:** `NO CUSTODY` appears nowhere in the tree, its two replacements are
in the closed set and rendered, and `caveats.test.ts` pins the retirement in both
directions.

#### AMENDED at M1: one of the two replacements renders at M3, not here

This done-when asked for both replacement labels to be **rendered**. One of them
is not, and the deviation is recorded here rather than absorbed.

`NO OWNER CUSTODY` replaces `NO CUSTODY` immediately, in the hero spec strip and
on the docs overview. It is true today.

`LIMEN HOLDS THE AGENT KEY` enters the closed set at M1 and **renders nowhere**
until M3. At M1 there is no agent key: `packages/custody` is M2, and no key is
held *for a user* until M3 deploys one. Rendering it now would put a
present-tense claim on a public preview about a risk this project has not yet
taken on — and **overstating a risk you have not taken on is still stating
something false.** The rule this project runs on is that a claim is true when it
is read, not that limits arrive as early as possible.

Two further reasons, both about whether the label works at all:

- A label that means nothing the first time a reader meets it means less the
  second time. Landing it with the fact is what keeps it worth reading.
- The ordering precedent is already in this plan. B4's third label,
  `TESTNET ONLY · AGENT KEY (LIMEN-HELD)`, enters the set at M1 and is unused
  until the key it names exists — *"the closed set gains the label before
  anything can render it"*. This is the same rule applied to the same kind of
  claim.

**A wording that was true in both tenses was considered and rejected outright.**
A label written to be accurate before and after M3 is hedged by construction, and
hedging a custody claim is the specific softening this project exists not to do.

**The absence is pinned in both directions**, so M3 has to flip it deliberately
rather than someone noticing later that it was never shown: `caveats.test.ts`
asserts the label is in the closed set *and* appears in none of the rendering
sites. Proved non-vacuous by adding it to the hero strip and watching that test
name it, then removing it.

**B2 moves with it, for the same reason.** §3.4's rewritten design rule 3 is a
three-key table whose third row reads *"Agent — held by a Limen server,
encrypted"*. That row is false at M1. The README's current rule 3 — *"Signing is
client-side only"*, *"no server-side signer for a user's account"* — is still
true at M1 and stays until the code that breaks it lands. It is rewritten in the
milestone that makes the new table true, which is M3.

**B5 does land at M1**, and the distinction is the whole point. Its narrowing —
`local-key.ts`'s *"it is the only one"* becoming *"this module is the only way
this browser signs"* — is true **both before and after** the agent key exists.
That is not hedging; it is a claim that was always over-broad, corrected. A
rewrite that is accurate today lands today; one that is only accurate after a
feature lands with the feature.

**B6 lands at M1 too, in the sessions commit**, not this one. `store.ts`'s *"No
user accounts, no passwords, no email, no server"* is true until the commit that
adds users, sessions and Postgres — and false the moment it lands. Same rule:
the prose changes in the commit that makes it change, never before and never
after.

#### AMENDED at M1: B6 landed with the auth routes, not with sessions

The line above says B6 lands *"in the sessions commit"*. It landed one commit
later, with `/api/auth`, and the deviation is recorded rather than absorbed
because the rule it follows is the same one: **the prose changes in the commit
that changes the fact.**

The sessions commit added a `sessions` table and the code to issue and read one.
It did not add a user, and nothing in the application could create a session,
so `store.ts`'s four absences were all still true the moment that commit landed.
The commit that made three of them false is the one that registers a passkey as
a user and hands back a cookie. Landing the prose a commit early would have been
the same error as landing it a commit late, in the other direction.

Both directions are pinned in `caveats.test.ts`, and the retirement was proved
non-vacuous by putting the sentence back and watching the test name it.

One consequence for anyone reading `store.ts`: it does **not** quote its own
retired sentence. A file that quotes a claim in order to explain that the claim
is retired still contains the claim, and the absence test cannot tell the two
apart. The header says so, so that the next person to want the quote finds the
reason instead.

#### The credential public key is parsed server-side. Recorded here because the alternative was defensible.

§7.3 requires the login path to check origin and challenge itself, because the
deployed verifier checks neither. **The same argument decides where the public
key comes from**, and the answer is not the obvious one.

`navigator.credentials.create` hands the page two views of the same credential:
`response.getPublicKey()`, which the browser decodes to SPKI, and
`attestationObject`, which is what the authenticator produced. Posting the first
is smaller, simpler, and needs no CBOR at all. The exposure from doing so is
genuinely narrow — a caller registering a key it controls is what registration
*is*, so there is no live exploit here.

It was still rejected, and the reason is the shape rather than an attack: **a
server-side signature check whose root of trust is a value the client computed
is a trust boundary with a seam in it.** Every future change to auth has to
re-derive why that is safe, and that reasoning is subtle enough to eventually be
got wrong. `users.passkey_public_key` is now written from
`parseAttestationObject` and from nowhere else.

**What was built is not a CBOR library.** It reads one map with three known
keys and one map with five known integer labels, requires exactly `alg: -7`,
`kty: 2`, `crv: 1`, and refuses everything else — including encodings that are
merely unusual rather than malformed, such as a length written in more bytes
than it needs. Indefinite lengths, tags, arrays, floats and 64-bit lengths are
all refused at the first byte. A parser that refuses everything it was not
written for is smaller than one that copes, and every shape it refuses is one
that cannot then reach a key, a column or a signer.

**Attestation is `none`, and what that does and does not prove is written down**
in `attestation.ts`'s header rather than left to be inferred from the absence of
a signature check. `attStmt` is empty, so nothing signs `authData`; registration
establishes that a ceremony named a credential, and *possession* is proved at
login. The rule that follows and is enforced in `auth.ts`: a registration
creates a user and never adopts one.

#### The parser was measured against a real browser, and the measurement is the deliverable

`e2e/passkey-registration.spec.ts` drives Chrome's virtual authenticator over
CDP — the way `passkey-owner.spec.ts` does — and runs the shipped parser against
the registration responses it produces. It spends nothing, so unlike that suite
it is tagged `@ci` and gates every push.

It follows that file's discipline about instruments. Before any assertion about
the parser, a **general** CBOR decoder written out in the spec asserts the
authenticator actually produced the shapes the parser was written for; the
extracted point is compared against the browser's own SPKI decoding as a third
opinion; and the refusals are exercised on genuine bytes with one thing changed,
so a parser that accepted everything could not pass.

**RUN RECORD**, `npm run e2e:ci -w @limen/web`, 2026-08-19:

```
{"registrations":8,"discoverable":3,"formats":["none"],"algorithms":[-7],
 "keyTypes":[2],"curves":[1],"attStmtEntries":[0],"extensionDataFlag":false,
 "aaguidAllZero":false,"comparedAgainstBrowser":8,"refusedWrongAlg":"cose_alg",
 "refusedNoAttestedCredential":"no_attested_credential",
 "refusedTruncated":"cbor_truncated","assertionAuthDataBytes":37,
 "refusedAssertion":"no_attested_credential",
 "rs256":"authenticator declined to create one"}
```

Read out of it, in the order it matters:

- Eight real registration responses, all `fmt: none` with an empty `attStmt`,
  all ES256 on P-256. The parser produced the same 65 bytes as the independent
  decode **and** as the browser's own SPKI decoding, 8 of 8.
- Four refusals fired on real bytes: `alg` changed from −7 to −8 → `cose_alg`;
  the AT flag cleared → `no_attested_credential`; the response truncated →
  `cbor_truncated`; and a **real assertion** from the same credential posted to
  the registration path → `no_attested_credential`.
- **`rs256: "authenticator declined to create one"`.** Chrome's virtual
  authenticator will not make an RS256 credential, so the run could not prove
  the parser refuses one from a real browser. The unit suite covers it with a
  built response, and the spec reports the gap rather than implying it was
  closed.
- **`extensionDataFlag: false`.** No response set the ED flag, so the branch
  that ignores an extension tail was not exercised this run. Same treatment:
  reported, not implied.

**Two instrument limits, measured rather than assumed:**

- **Chrome's virtual authenticator stores exactly three discoverable
  credentials.** A fourth `create` with `residentKey: 'required'` fails with
  `NotAllowedError` before the authenticator is consulted. The first version of
  the spec asked for eight and got three successes and five refusals. The sample
  is therefore three discoverable — the case `passkey.ts` actually runs — plus
  five non-discoverable for volume.
- A user gesture does not lift it. Playwright-driven clicks between calls made
  no difference, which is what identifies it as a storage cap rather than a
  Chrome activation throttle.

#### UNRUN at M1: no auth route has run against a real database

`registerPasskey` and `loginWithPasskey` are proved against fakes, and the
parser is proved against a real browser. **The Drizzle binding in `stores.ts`
has been executed by nothing.** This is the same hole §7.5.2 already records for
`neon-http` and it is the same reason: `apps/web` reaches Postgres over Neon's
HTTP protocol, and the local Postgres this repository runs for `@limen/db`'s
suite cannot speak it.

What is done about it is what `session.ts` already prescribes — the untestable
part is kept as small as it can be. `stores.ts` is one statement per method, no
conditionals, no query built from a variable, and everything above it is behind
`UserStore` and `SessionStore`. What would settle it is the same ten minutes
against a real Neon instance that §7.5.2 is still waiting on, and it is recorded
here rather than quietly treated as covered.

### M2 — Custody

`packages/custody`. Server-side keygen, envelope encryption (per-agent data key,
KMS-wrapped master), the signer service, single-use decision tokens. The signer
**rebuilds the transaction from the token's arguments** — there is no "sign this
XDR" entrypoint, per demo-signer fence 3.

- `SERVER_SIGNERS` registry and its CI fence (**B3**), two-sided like the
  existing sentinel check.
- **The `LIMEN_MASTER_KEY` bundle grep**, deferred here from M1 deliberately.
  The client-bundle fences in CI are two-sided by rule — the sentinel must be
  found in the server bundle before its absence from the client bundle means
  anything — and at M1 nothing in `apps/web` imports `@limen/custody`, so the
  positive half would find nothing and the negative half would pass by not
  looking. The source-level half is live already:
  `packages/custody/test/single-construction-site.test.ts` asserts the variable
  is read in exactly one module, which is two-sided today. The bundle grep lands
  in the milestone where the web app can actually reach the provider.
- Schema test: no plaintext-secret column exists under any name.
- Shared redactor applied to every server egress, not only error reports.
- Server-side twin of the `S…` bundle grep: no plaintext seed reaches any log
  sink, proved against a canary.

**Done when:** an agent key can sign, and every fence that would catch it leaking
is live and proven non-vacuous.

#### M2, part one — keygen, the signer, and the seed in `agent_keys`. RUN.

Dated 2026-08-22. What landed, what it cost, and what of M2 is still open.

**Built.** `packages/custody/src/agent-key.ts` — `generateAgentKey` and
`withAgentKey`. Envelope encryption in the two layers §7.5.3's interface was
shaped for: a per-agent data key seals the seed, `EnvMasterKeyProvider` wraps the
data key, and `kms_key_id` records which provider did on every row.
`packages/custody/src/aes-gcm.ts` holds the one AES-256-GCM implementation both
layers use — `env-master-key.ts` was refactored onto it and its wire format,
`nonce ‖ ciphertext ‖ tag`, is unchanged and is a compatibility surface now.

`withAgentKey` is a callback rather than a getter, so a decrypted seed exists for
one turn and cannot be held past it. The open key satisfies `@limen/chain`'s
`Ed25519Signer` structurally, with no adapter — the same property `sign.ts`
claimed for the browser's local key, working a second time for a key that lives
somewhere entirely different.

**The seed is bound to its agent id as associated data.** This is new and is the
one genuinely load-bearing addition: without it a sealed seed is portable between
`agent_keys` rows, and anyone able to write that table could move an agent's key
onto an agent whose boundary is wider. It does not widen what a key may do — the
account still enforces that — it prevents a key being used under a rule never
installed for it.

**Wired.** `/api/agents/[id]/deploy` generates the key server-side and returns
only the `G…`; the browser funds that account, installs the boundary naming it,
and never holds it. The owner key is untouched and still never reaches a server,
so `NO OWNER CUSTODY` stays true as written. `/api/agents/[id]/deployed` gained a
fourth verification — the installed rule must bound *the key Limen holds* —
because a client naming any other key would install a valid boundary around a key
Limen cannot sign with, and the deployment would verify, record, and read as
`ACTIVE` while being permanently unable to act. That is the most expensive thing
this route can let through, because it looks like success.

**Schema.** Migration `0003` adds `agent_keys.agent_public_key`. It is the one
column in that table that is not ciphertext, and the closed set in
`schema.test.ts` was changed by hand to admit it. The alternative was deriving
the address by opening the sealed seed, which would decrypt key material to
answer a question about a public value.

**B4's tripwire fired, and resolving it took a scan change rather than a label.**
The generation scan in `local-key-label.test.ts` required `LOCAL_KEY_LABEL` on
any file matching `Keypair.random()`. `agent-key.ts` matches it and is not a
browser key, so the fence as written could only be satisfied by stating that a
server-held key is in the reader's browser — the failure `status-labels.ts`
calls the fence producing the lie. The scan is now location-aware:
`packages/custody/src` owes `AGENT_KEY_LABEL`, everywhere else owes
`LOCAL_KEY_LABEL`, and neither satisfies the other. The M1 assertion that
*nothing* carries the agent label was inverted into a positive one naming
`agent-key.ts`, which is exactly the hand edit its own comment asked for.

**A hole was found by mutation, not by reasoning, and is now closed.** With the
location-aware scan in place, `agent-key.ts` was deliberately mutated to
`import { LOCAL_KEY_LABEL as AGENT_KEY_LABEL }`. **The whole file passed.** The
detector matches the identifier, so an alias satisfies it while every use renders
the wrong label — the precise failure the partition exists to prevent, reached
through the one construct a regex over source cannot see. Aliasing onto any of
the three label names is now refused outright, and the mutation was re-run
afterwards to confirm the fence fires. It does.

**The M2 bundle grep landed, and the plan's stated precondition is why it could.**
`apps/web` now imports `@limen/custody`, so the positive half has something to
find. It greps `AGENT_KEY_ALGORITHM`'s value rather than an invented sentinel:
that string is compared against every row `withAgentKey` opens, so a bundler
cannot drop it while the check exists, where a grep-only sentinel could be
tree-shaken and the fence would then pass by not looking.

Writing it surfaced a real obstacle. `deployments/testnet.json` recorded a run
note that spelled `LIMEN_MASTER_KEY`, and that file ships to the browser inside
`evidence.json` — so the variable's name was in the client bundle, and the fence
the plan specifies would have failed on a documentation string. The note now
describes the variable instead of spelling it, and says why. No key or value was
involved; the fence is a plain grep with no exception list, which is the only
kind worth having.

**Counts.** 949 → 969. `@limen/custody` 20 → 36, `apps/web` 675 → 679. Run with
`TEST_DATABASE_URL` against a local Postgres 16 and `REDIS_URL` against the
managed instance, so `append-only.test.ts` ran rather than skipped: `@limen/db`
34 passed, 0 skipped. `evidence:check` reports up to date.

**Still open in M2, and not claimed:** single-use decision tokens and the signer
service that rebuilds a transaction from a token's arguments; the
`SERVER_SIGNERS` registry and its B3 CI fence; the shared redactor applied to
every server egress; and the server-side twin of the `S…` bundle grep proving no
plaintext seed reaches a log sink, against a canary. Keygen and the signer are
done; the surface that decides *what* the signer may be asked to sign is not, and
until it is, the runtime calls `withAgentKey` directly.

### M3 — Agent lifecycle, and the revocation guarantee

Create → configure → deploy → active → pause → revoke. Both security modes
(brief §17). Deployment reuses `deployAccount` and `installBoundary` unchanged.

- **B9.1** — passkey-owner gate at agent-deploy time, per account, with the
  message rather than a disabled button.
- **B9.3** — origin check before the flow offers anything, client and server.
- **B9** requirement 2 — Limen-sponsored fee for owner revocation.
- **B9** requirement 3 — mandatory short `valid_until`.
- **B9** requirement 4 — the three revocation paths, including the documented
  `stellar` CLI invocation.

**Done when:** a recorded testnet run is in `deployments/testnet.json`, **and**
an account has been revoked with the runtime process stopped, with that hash
recorded. Revocation-without-Limen is not a P1 item and does not slip; without
it the §3 custody answer is not true and M3 is not done.

#### PART-DELIVERED, 2026-08-22 — the described mode, on branch `m2-agent-builder`

The **described** half of brief §17, as `/app/agents/new`. Create → configure is
built; deploy → active is the same branch and is recorded below it when it
lands. Pause, revoke and the B9 requirements are **not** in this work and M3
stays open.

The one design decision worth carrying forward, because the rest of M3 inherits
it: **the row is written when the information for it exists, and not before.**
`agents` gets a `DRAFT` row the moment a description is drafted, because a name
and a description are all a draft is. `policies` gets nothing at that point —
the model is structurally unable to propose a token contract id (there is no
field for one in the output schema), so nothing compiles to a `PolicyProposal`
until a person pastes one. A `policies` row with a null `proposal_json` would
mean *"we had not finished asking"*, which is what `DRAFT` on the agent already
says in the column built to say it. The policy lands at `CONFIGURED`.

**No schema change was needed, and that was checked against the database rather
than against `schema.ts`.** All 14 tables present, all three migrations applied,
`agent_status` and `policy_source` carrying exactly the members the file
declares. The described mode's asset and cap live inside
`policies.proposal_json` — `PolicyProposal.policies[0]` is
`{ kind, asset, limit, windowLedgers }` — which is what makes the absence of
dedicated columns for them correct rather than a gap. `observed_tx_hash` stays
null, and the null is the record that nothing was observed.

**Run record — the agent store against live Neon, 2026-08-22.** `stores.ts` is
the file `session.ts` calls *"the part no test here can reach"*, so the new
`drizzleAgentStore` was exercised against the real instance once and the result
recorded here rather than left to the first person to use the screen:

```
createDraft            → row written, status DRAFT by column default
findForUser(id, owner) → found
findForUser(id, other) → undefined          ← the scoping, which is the security property
updateDraft(id, owner) → renamed
updateDraft(id, other) → undefined, and the row was NOT modified
delete                 → gone; agents table back to 0 rows
```

The two negative cases are the ones worth having run. `agents.id` is a UUID in a
URL, and an unscoped lookup would let any signed-in user configure and deploy
another user's agent by pasting one. The scoping is in the `where` clause rather
than in a check the caller performs, for the reason `session.ts` gives about
expiry: a row returned and then discarded by the caller is one `if` away from
not being discarded.

**What is not covered by any test, stated rather than implied.** The
`/api/agents*` routes are exercised by unit tests only above the store
interface. Their end-to-end behaviour — cookie to row — has been run by hand and
is not in CI, for the reason §7.5.2 already gives: CI has no Neon, and
`neon-http` cannot be exercised by a local container.

**Run record — `CONFIGURED` against live Neon and live testnet RPC, 2026-08-22.**
The configure path derives against a real ledger, so it was run against one:

```
latest testnet ledger        4,269,900   (read through SOROBAN_RPC_URL)
derived rule                 limen-0, CallContract, valid_until 4,788,300
                             spending_limit 500000000, window 17,280
stored policies row          source=described  status=proposed
                             observed_tx_hash=NULL   ← nothing was observed
                             observed_ledger=4269900  valid_until=4788300
                             headroom_bps=10000       window_ledgers=17280
                             enforced_offchain_json={recipients:[G…], perTransactionCap:"100000000"}
reconfigure twice            still exactly one policies row  ← replaces, not accumulates
configure as another user    rejected, AgentNotFound, nothing written
delete agent                 policies row cascaded away
```

`headroom_bps=10000` is the described mode's whole arithmetic claim on one line:
the cap stored is the cap typed, with nothing added.

**Finding — `jsonb` does not preserve key order, and one plausible future bug
depends on knowing that.** The first run of this probe asserted the stored
proposal matched the derived one under `JSON.stringify` and **failed**. The
values are identical and the key order is not: Postgres `jsonb` stores a
decomposed representation and returns keys in its own order. Deep equality
passes; string equality does not, and the probe now asserts *both* — equal by
value, unequal by string — so the finding is measured rather than remembered.

Nothing today is affected, because `lower` and `installFunctions` read fields by
name. What would be affected is **anybody who hashes `proposal_json` read back
from Postgres and compares it to a hash of the in-memory proposal** — an
obvious-looking way to prove "what was reviewed is what was installed", and one
that would fail for a reason nothing about the data would explain. The
comparison has to be structural. This is recorded in the configure route's
header as well as here, because that is where someone would go to write it.

It also corrects a sentence this work had already written: the claim is *every
field, every value*, and **not** "byte for byte". The stronger phrasing was in
the route header for about twenty minutes and was false the whole time.

### Deploy, and the verification that stands between a browser and a row

The deploy path reuses `deployAccount`, `fundSmartAccount` and `installBoundary`
from `lib/chain-actions.ts` **unchanged** — the four writes `/app/try` already
makes, in the same order, through the same functions. The plan is not held in
memory across the step: `POST /api/agents/[id]/deploy` reads it back out of
`policies.install_plan_json` and hands it to the client, so the rule that
reaches `add_context_rule` is the rule the review step wrote down, by
construction rather than by two copies agreeing.

**`POST /api/agents/[id]/deployed` does not believe the browser.** Every field a
client reports is a claim, and `agent_accounts` is the only table in this flow
that stores facts about a chain. So before the row is written the server re-reads
the account's context rules over RPC — `readAllContextRules` and
`readSpendingLimit`, the same functions `/api/account/[id]` has used since V4,
needing no fee and no signature — and checks four things against the stored plan:
the rule exists at that id, its contract is the token that was reviewed, its cap
equals the reviewed cap, and its window and expiry match. Any disagreement is a
422 and **nothing is written**.

This does not make `status = 'ACTIVE'` a claim about the chain *now*, and
`agents.ts` is explicit that it never is. It makes the row a record of a
deployment that demonstrably happened, as the ledger described it at the moment
it was written.

#### Run record — the routes over HTTP against live Neon and live testnet, 2026-08-22

Driven against `next start` with a session row inserted directly, since the
passkey ceremony needs a browser. Deleted afterwards; the one session left in the
table predates this work and belongs to another user.

```
GET  /api/auth/session          no cookie   → {"user":null}
POST /api/agents                no cookie   → 401                    ← the auth gate
POST /api/agents                cookie      → DRAFT row, id d2c61b33…
POST /api/agents/…/generate     no API key  → generated:false, empty draft carrying
                                              the description, degraded sentence   ← CI's path
POST /api/agents/…/configure    no asset    → 422 invalid_config, problem on
                                              assetContractId, "will not guess one"
POST /api/agents/…/deploy       while DRAFT → 409 wrong_status
POST /api/agents/…/configure    valid       → 200, agent CONFIGURED
                                              derived at ledger 4,270,084
                                              cap 500000000 = 50 XLM at 7 decimals
                                              plan → one rule, limen-0, valid_until 4,788,484
POST /api/agents/…/deploy                   → DEPLOYING, returns the stored plan
POST /api/agents/…/deploy       again       → 409 wrong_status        ← no second account
POST /api/agents/…/deployed     short hash  → 400
POST /api/agents/…/deployed     real account CBNPFNPW…, real rule 5
                                            → 422 unverified: "Context rule 5 expires at
                                              4035836, and the reviewed boundary expires
                                              at 4788484. Nothing was recorded."
     after that refusal          agent_accounts 0 rows, policy still `proposed`
                                 with install_tx_hash and context_rule_id null
POST /api/agents/…/deployed     {ok:false}  → agent ERROR, still nothing else written
```

The 422 is the one worth reading twice. It is the verification refusing a rule
that **genuinely exists on testnet** — rule 5 of the recorded walkthrough
account — because its expiry is not the expiry that was reviewed. The check is
reading real chain state and comparing it to the stored plan, not pattern-matching
a shape.

**Separately, the verification was pointed at the recorded walkthrough run** and
agreed with `deployments/testnet.json` on every field it checks: rule 5 on
`CBNPFNPW…` authorizes `CDLZFC3S…`, and its spending limit reads back
`limit=1000000`, `periodLedgers=17280`, exactly as recorded. That is the positive
half — the checks pass when they should — and without it the 422 above would only
prove the code can refuse.

#### RUN — the browser half of deploy, end to end

*This section replaced the "NOT RUN" entry that stood here. What it said: no
smart account had been created by this screen, and the seam where a browser
drives the four chain writes and reports back had been executed by neither a
person nor a test. One has now been created by it.*

`apps/web/e2e/agent-builder.spec.ts` — the shape `e2e/passkey-registration.spec.ts`
established: a real Chromium with a CDP virtual authenticator, a production
`next start`, live Neon, live Upstash, live testnet. `page.route` appears
nowhere in the file. A passkey the browser created, a session that is a row, a
sentence typed into the form, a boundary derived server-side, and five
submissions that closed on ledgers 4,273,973–4,273,978.

**The run, 2026-08-22.** Recorded in full in `deployments/testnet.json` under
`agentBuilderRun`.

| | |
|---|---|
| smart account | `CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM` |
| context rule id | `1` |
| owner signer | `GCLDQBMWF4YARB5USS6SROQIZOK3YH2KX5NMQMWUFYT7TNG2NDE6GQST` |
| agent signer | `GASX3ZQJUE4SSAJFSAK2FZ55Q6XKXCYQF5HUAMF7ITUVDGNDL6VTH3EJ` |
| deploy | `0ce46f619bcec7408635935563e8184c92c3ecc57a654fc92bc72f4cb5a8ae1e` |
| seed | `c72786df9a98450b128c2f47ad1247f46ae0da03ee135d520e15b66f8a274789` |
| install | `d121671fe43b0253c653a9de0dd41c6a88bd5da325f8406eefadcd1872559c6b` |
| cap installed | `1000000` (0.1 XLM at 7 dp), period `17280`, valid until `4394931` |

The cap is the arithmetic claim, so it is stated as one: `headroom_bps = 10000`
means the cap stored is the cap typed, and `1000000` is asserted against that
constant rather than re-derived — a re-derivation would be this repository
agreeing with itself.

**What was verified, and by what.** Three reads, none of them the screen.
`/api/agents/[id]/deployed` re-read the account's context rules over RPC, and
the numbers matched the cap and window typed into the form. The `agents`,
`agent_accounts` and `policies` rows were then read back out of Postgres by the
test process over raw SQL rather than through `stores.ts`. All five hashes were
afterwards confirmed `SUCCESS` against `soroban-testnet.stellar.org`. The
deploy is not proved by the presence of a transaction id anywhere in this.

**Without a model, deliberately.** `ANTHROPIC_API_KEY` was unset, so
`/api/agents/generate` degraded to an empty draft carrying the description, and
that is asserted as a working path — `generated: false`, the degraded sentence
on screen, every draft field empty — rather than skipped. A run where a model
answered would fail here rather than pass quietly, because the subject of this
spec is the form a person fills in.

**It is out of CI**, for the reason `account-lifecycle.spec.ts` and
`passkey-owner.spec.ts` are: it spends five testnet fees and needs credentials a
runner does not have. Untagged, so `playwright.ci.config.ts`'s `grep: /@ci/`
cannot reach it by construction. On demand, from `apps/web`, and on `localhost`
rather than `127.0.0.1` because an RP ID must be a registrable domain:

    npx playwright test e2e/agent-builder.spec.ts

**Three runs, and what the two failures were.** Both were defects in the spec,
neither in the product, and both are worth keeping written down because each
was a check that would have passed while proving nothing:

1. `page.locator('section').filter({ has: h3 }).first()` also matches step 2's
   own `<section>`, which wraps *both* halves of the partition. So "the
   per-payment ceiling is not rendered under *Enforced by the network*" —
   B8.2's structural requirement, and the one misrepresentation this project
   cannot make — was reading the whole step and asserting something true of
   either half. The form was right the whole time. `group()` now takes the
   nearest `<section>` ancestor of the heading.
2. One locator matches both friendbot panels, and `not.toContainText` is a
   single-element assertion, so it died of strict mode with both fundings
   already on a ledger. Each is settled on its own result now.

The first run also surfaced that the WIP commit had landed a literal NUL byte
inside a string literal, which made the file `data` rather than text — `grep`
matched nothing in it, silently — and turned the degraded-reason assertion into
a check for a NUL.

**M3's "done when" is met.** The two agent rows left behind by the two failed
runs were deleted; `agents`, `agent_accounts` and `policies` hold exactly the
one run above.

### M4 — Runtime and tools

`packages/agent`, `packages/tools`, `packages/policy`. Read tools first, then
`send_payment`. Web chat first — Telegram is a channel, not a prerequisite.

- The recipient allowlist lands here, **server-side in `packages/policy`**
  (**B8.1**), with the component-import ban pinned by test.
- The four-outcome error vocabulary (§4.4), with *refused by Limen* structurally
  unable to borrow *refused by the network*'s badge.
- Dependency-direction test: `agent` imports neither `core` nor `custody`.

**Done when:** a tool call reaches a ledger, and a gate refusal is recorded with
its provenance rather than as a generic failure.

**Run record — migrations 0003 and 0004 applied to live Neon, 2026-08-23.** The
turn store's table did not exist on the deployed instance. Applied via
`npm run migrate -w @limen/db` against `DATABASE_URL_UNPOOLED` (the direct
endpoint; the script refuses a `-pooler` host, §7.5.2).

**Two pending, not one.** `0003_agent_key_public_half` was also unapplied — the
Neon journal stood at three rows while the repository's `_journal.json` carried
five entries. The migrator applies every pending file, so the run landed 0003
and 0004 together and the journal went to **five**, not four:

```
before → drizzle.__drizzle_migrations = 3 rows (0000, 0001, 0002)
         agent_keys.agent_public_key   absent
         to_regclass('public.turns')   null
after  → drizzle.__drizzle_migrations = 5 rows
         agent_keys.agent_public_key   present, NOT NULL
         turns / turn_status           present
         GRANT on turns   → SELECT, INSERT, UPDATE, DELETE to limen_app
         GRANT on audit_events → SELECT, INSERT only, unchanged
```

`0003` adds a `NOT NULL` column with no default, which is only safe on an empty
table. It was checked before the run rather than after: `agent_keys` held 0 rows
on the instance, matching the claim the migration's own comment makes. The
`audit_events` grant was re-read afterwards because 0004 is the first migration
to add a table-level grant since 0001, and the property worth confirming is that
adding one did not disturb the table that must not have UPDATE or DELETE.

**Run record — the full suite, green, 2026-08-23.** With `0004` applied, M4's
code was run as a whole for the first time. `0877948` was committed as WIP, but
the WIP was the unapplied migration and not the code: nothing in
`apps/runtime/src` carries a TODO or a stub, and the suite needed no repair.

```
@limen/core        3 files    53 tests
@limen/chain       9 files   108 tests
@limen/db          3 files    34 tests
@limen/custody     3 files    36 tests
@limen/kv          2 files    37 tests
apps/runtime       9 files    89 tests
apps/web          24 files   679 tests
                            ----------
                            1036 tests, 0 skipped, exit 0
```

**Zero skipped is the part worth recording.** `append-only.test.ts`,
`portability.test.ts`, the `packages/kv` contract suite and the runtime's queue
suite all skip with a printed notice when their service is absent, and only
*fail* when `CI` is set. A local run that skipped them would report the same
green and prove considerably less. Both services were up — Postgres on 5432 with
all five migrations applied, Redis on 6379 — and `TEST_DATABASE_URL` and
`REDIS_URL` were exported explicitly rather than sourced from `.env.m1`, which
would have pointed the KV suite at Upstash and measured a different thing.

**On the apparent gap in the migration sequence.** There is no missing `0003`.
The gap is in `meta/`, which holds snapshots for 0000, 0002, 0003 and 0004 and
none for 0001 — because `0001_audit_events_append_only` is hand-written, and a
hand-written migration writes no snapshot. `0001` says so itself, and notes why
it is harmless here: the file creates no schema object, so there is nothing for
a later `drizzle-kit generate` diff to miss. `0000` and `0001` were committed
together in `34abb90`, one millisecond apart in the journal's `when` values.

**A fresh rebuild from migrations alone does work**, and CI is where that is
proved rather than asserted: the *Apply migrations to a fresh database* step
runs `npm run migrate -w @limen/db` against an empty `postgres:17-alpine`
service on every push, before the suite that reads the schema. Nothing in the
sequence depends on state a snapshot carries — the migrator reads `_journal.json`
and the `.sql` files, and never reads `meta/`. The one external prerequisite is
the `limen_app` role, and `0001` creates it under `IF NOT EXISTS` rather than
assuming a deployment made it.

**Run record — the web chat, built and green, 2026-08-23.** M4's chat landed in
four commits: `chat.ts` (a sentence to a tool call), `runtime-client.ts` (the
call to the runtime), the two routes a browser talks to, and the screen.

```
npm run lint            clean
npx tsc --noEmit        clean for every new file
npm test                1076 tests, 27 web files, 0 skipped, exit 0
npm run build           compiled; /api/agents/[id]/chat, /api/turns/[id],
                        /app/agents/[id]/chat all present as ƒ routes
```

**The runtime was started against the real services rather than assumed.** Neon
on the direct endpoint, Redis on 6379:

```
GET /health → {"ok":true,"queue":{"waiting":0,"processing":0},
               "tools":["get_balance","send_payment"]}
POST /agents/:id/turns with no credential → 401
```

**Run record — the local pair, 2026-08-23.** The web app reaches the runtime
through one variable and one credential, and neither of them is a shared
secret.

`apps/runtime/src/auth.ts` names no environment variable at all. It reads
`Authorization: Bearer <token>`, hashes it SHA-256, and requires a live
`sessions` row — it authenticates a **person**, not a service.
`apps/web/src/lib/runtime-client.ts` sends exactly that token, the one the
browser's `limen_session` cookie carries. The cookie is `SameSite=lax`, so the
browser will not post it cross-site itself; the web app, which already
authenticated the person, forwards it on their behalf. Nothing new is trusted
in the hop. The only variable the pair needs is `LIMEN_RUNTIME_URL`, read by
the web side, with no default and no localhost fallback.

A service secret was considered and not added. It would be a second credential
guarding a route that is already per-user, and its only effect would be to let
a caller who holds it reach the route without a session — which is the property
`auth.ts` exists to deny.

Against the real Neon and the real Redis, with the runtime on `:8787`:

```
POST /agents/:id/turns  no Authorization header    → 401 {"error":"unauthenticated"}
POST /agents/:id/turns  Bearer not-a-real-token    → 401 {"error":"unauthenticated"}
POST /agents/:id/turns  Bearer <live session>      → 404 {"error":"not_found"}
```

The third is the credential being **accepted**. `postTurn` reaches the
ownership query only after `authenticate` has returned a `Caller`, so a 404
there is authentication having succeeded and the agent lookup having failed.
It failed for the reason the NOT RUN section below states: `agentForTurn` inner
joins `agent_keys`, `agent_keys` holds no row for the one existing agent, and
that agent predates `0003`. A 202 needs an agent with a server-held key, which
is what M5 produces.

**One model call, not an agent loop, and the reason is §4.4 rather than cost.**
The model chooses a tool and stops. It is never told what the tool returned, so
it cannot apologise for a refusal, explain one away, or report a payment that
did not settle. The `ToolResult` union is rendered by `TurnResult.tsx` from its
own arms — which is where *row two never borrows row three's badge* stops being
a convention and becomes a shape: the parsed `refused_by_limen` arm has no
field a hash could occupy, and the test feeds it a refusal carrying a stray
`evidence` object to watch the hash be dropped rather than drawn.

`infra_error` and `agent_error` get no verdict badge at all. Nothing decided
anything in either case, and `Verdict` keeps the four states
`design-system.test.ts` pins — a fifth for *nothing happened* would be a
category error wearing a colour.

**Run record — the four outcomes, on live testnet, 2026-08-23.** *This section
replaced the "NOT RUN: the demo itself" entry that stood here. What it said: the
demo was blocked on an agent rather than on the chat, because `agent_keys` held
0 rows, no agent anywhere had a server-held signer, and the one existing
`agents` row predates `0003`.*

**That blocker is closed.** `e2e/agent-chat.spec.ts` deployed two fresh agents
through the browser — passkey, virtual authenticator, real `next start`, real
Neon, live testnet — and both reached `ACTIVE` with an `agent_keys` row sealed
under `env-master-v1`:

```
agent 9430baa3-0ab9-4c22-bb76-d807e417fbd2   ACTIVE
  smart account   CDZT2SUQJZLMYLNRSR3CPVL6LZDAQF44O4JTLRJUHZJFB6GUOYHN2YDY
  deploy          a903159eabc33f4d3c3f1a194ba6d175a72db698836974475ca258bde965786d
  install         1fb01588023aa727d0dd1fd4f2cfa1a0093a566ebe77e0016419bc5108de35ca
  context rule 1, cap 500000000 stroops / 17280 ledgers
  agent key       ed25519-seed:aes-256-gcm/aes-256-gcm-envelope-v1, kms env-master-v1
```

**Then the agent was asked to do four things, and answered four different ways.**
Driven over HTTP at `apps/runtime` with a live session token — the same two
routes the web chat polls, the same worker, the same gate:

```
1  get_balance                        succeeded          1000000000 stroops @ ledger 4298597
2  send_payment 20 XLM  → approved    succeeded          5097d0c0722b58942dc4b306ae7b4ec2b89d6634339bcf5ae210703a312b9e35
                                                         SUCCESS, invokeHostFunctionSuccess, ledger 4298601
3  send_payment 200 XLM → approved    refused_by_network 8d856874605a579f5face766b771b06f16051111c428ee96a464b6c0b86f9a8e
                                                         FAILED, invokeHostFunctionTrapped
                                                         SpendingLimitExceeded#3221, boundaryRefusal true
4  send_payment 1 XLM   → unapproved  refused_by_limen   recipient_not_allowed, ledgerWould permit,
                                                         reachedLedger false, NO evidence field
5  get_balance                        succeeded          800000000 stroops @ ledger 4298608
```

**Rows 3 and 4 are the whole argument, and they are two different refusals.**

Row 3 is the **network's**. `gate.ts` refuses only what the network cannot see,
and it argues the case in its own header: a gate that pre-empted the cap would
turn this demonstration into Limen's opinion, and *a refusal that never reached
a ledger is evidence of nothing* would then describe Limen's own behaviour. So
the over-cap call was **submitted**, `__check_auth` consulted the spending-limit
policy, and the refusal came back **on a ledger with a hash anyone can look
up**. `payment.ts`'s borrowed-footprint path is what got it there — the
enforcing simulation produces no transaction, and this is the code that spends a
fee to be told no.

Row 4 is **Limen's**. No audited on-chain primitive expresses a recipient
allowlist, so the refusal was computed locally, nothing was sent, and there is
no hash — with `ledgerWould: "permit"` saying out loud that the ledger would
have allowed it. The `refused_by_limen` arm carries **no `evidence` field at
all**, which is §4.4's *row two never borrows row three's badge* as a shape
rather than a convention.

**The balance is what proves the payment, not the hash.** 1000000000 → 800000000
stroops, a fall of exactly 200000000 — the 20 XLM of row 2, and nothing from
rows 3 or 4. Both refusals moved nothing, measured rather than assumed.

**Still NOT RUN: the sentence.** Everything above enters at the tool call. What
has *not* been executed is the one step above it — `chat.ts` asking Opus which
tool a sentence wants, so that *"pay 20 XLM to G…"* becomes `send_payment` with
a stroop count the model converted. `e2e/agent-chat.spec.ts` drives exactly that
path and stops there: `ANTHROPIC_API_KEY` in `.env.m1` is a 26-character
placeholder, and `api.anthropic.com` returns `401 authentication_error` for it
directly as well as through the route. The spec fails at message one with
`{"kind":"agent_error","detail":"401 … API key is invalid."}`, which is the chat
route behaving correctly — `decideChatTurn` degraded, no tool was chosen, and
`turns` stayed empty.

That failure is worth being precise about, because it is *not* evidence about
the agent. It is the model call, one layer above the boundary, and every layer
below it is recorded above with hashes. The spec is written, typechecked and
committed; it needs one valid key and no code changes.

**Two ceilings, and why they are not the same instrument.** Closing the run
above exposed a promise the product was not keeping. The builder collects a
per-payment ceiling, validates it, writes it to `policies.enforced_offchain_json`
and renders it on screen under **"Enforced by Limen"** — and `gate.ts` never
read it. Nothing enforced it. It is now a `per_transaction_cap` constraint, and
the distinction it forces is worth stating once, plainly, because the two limits
look alike on a form and behave nothing alike:

| | the **cap** | the **per-payment ceiling** |
|---|---|---|
| what it bounds | everything spent in a rolling window | one payment |
| who holds it | the `spending_limit` policy contract, on the account | Limen, in `enforced_offchain_json` |
| who enforces it | the network, inside `__check_auth` | `gate.ts` |
| a refusal by it | `refused_by_network`, **with a hash** | `refused_by_limen`, **with none** |
| if Limen is bypassed | still refused | not refused |

A payment can be refused by either, for different reasons. The rule the gate
follows is unchanged and this does not bend it: **Limen refuses only what the
network cannot**. The cap is still left to the network, because the network
enforces the cap. The ceiling is enforced here because a per-payment limit is
not expressible in the audited primitive the account installs — which is exactly
the test for what belongs in the gate at all.

The ordering matters and is tested: a payment over the *cap* but inside the
*ceiling* is still permitted by the gate, so it reaches a ledger and comes back
refused with a hash. A ceiling that intercepted it would quietly downgrade the
central demonstration from evidence to opinion. `e2e/agent-chat.spec.ts` leaves
the ceiling unset for exactly this reason and says so in the file.

**Also still NOT RUN: revoke, and the same call failing differently afterwards.**
§51's third and fourth steps. Rows 1–4 are permitted and the two refusals; the
revoke half has a recorded precedent in `deployments/testnet.json` under
`v4ChainRun` but has not been driven from the chat.

**Run record — the agents list, 2026-08-23.** `/app/agents`, scoped by
`user_id` through `listForUser`, with every cap read from the ledger on load.

The design decision worth recording is the one that costs something: there is no
cap column and the list does not add one. `schema.ts` rule 2 forbids a cached
chain claim, and a list view is where that rule is most expensive and most
load-bearing — N agents cost 2N RPC reads, and the alternative is a screen that
renders an agent revoked on another device as still bounded. `LIST_READ_LIMIT`
bounds the fan-out rather than the list; agents past it are returned as **not
read**, which the screen is careful to distinguish from **no boundary**.

Checked against the live services rather than asserted:

```
GET /app/agents                        200, renders the `unknown` identity state
GET /api/agents  (no cookie)           401 {"error":"unauthenticated"}
GET /api/agents  (live session)        200, one agent — this user's, not the other two
  cap    500000000 per 17280 ledgers, valid until 4419429
  spent  200000000 in this window
  read at ledger 4298918
```

The `spentInWindow` is the 20 XLM payment from the run above, read back off the
policy contract by a different code path than the one that made it. Nothing in
that block came from a table.

**NOT RUN — Freighter's signature envelope, 2026-08-24.** Piece 4 (wallet
sign-in) turns on one fact that cannot be read out of this repository: whether a
server holding only a `G…` can verify what Freighter signed, and over which
bytes. `@stellar/freighter-api` is a relay — no ed25519, no SHA-256, no
`Keypair`, and its own unit test mocks the signature as the string `"foo"` — so
the envelope belongs to the extension, and the extension is not here. The
console approach does not work either: Freighter exposes no callable global, it
talks over `postMessage`, and the npm client is the only door.

So the question is measured rather than assumed. `/app/dev/freighter` calls
`isConnected`, `requestAccess`, `getNetwork` and
`signMessage('limen-test-123')` with the testnet passphrase, renders
`signerAddress`, the **type** of `signedMessage` and its value, and posts both
to `/api/dev/freighter-verify`. The verdict is computed there, not in the page,
because a browser agreeing with itself about a signature it just produced is
worth nothing — the claim under test is about a *server*.

The route tries four envelopes and reports which one verified, rather than
checking SEP-53 alone and answering a bare no:

| candidate | what is signed |
|---|---|
| `sep53` | `SHA-256("Stellar Signed Message:\n" ‖ message)`, via `Keypair.verifyMessage` |
| `sep53-manual` | the same bytes, assembled by hand and checked with raw `verify` |
| `raw-utf8` | the message's UTF-8 bytes, directly |
| `sha256-message` | `SHA-256(message)`, no prefix |

A `false` across all four is a **finding**, not a failure: it means the envelope
is none of these and the next move is to ask Freighter's authors, not to invent
one. `sep53` and `sep53-manual` must agree, and their agreement is what makes a
`true` evidence about the extension rather than about the SDK.

Both halves fail closed. `probesEnabled` returns false for any environment it
cannot prove is non-production — the page 404s rather than rendering a refusal
that would confirm the route exists, and the route 404s because it does
cryptography with an address and a signature from an untrusted caller. The
probe is deliberately absent from `SiteHeader`'s `SECTIONS`: it is not a section
of the product, it is an experiment with a URL, and it is deleted once the
question has an answer.

What is checked so far, and what is not:

```
vitest test/freighter-probe.test.ts     10 passed — every envelope named correctly,
                                        including the "none of these" case,
                                        the wrong-key case, hex, a 32-byte
                                        signature, and the production 404
eslint (four new files)                 clean
tsc --noEmit                            no error in any probe file
                                        (one pre-existing error in
                                        test/rate-limit.test.ts, untouched)
GET  /app/dev/freighter                 200 against the running dev server
POST /api/dev/freighter-verify          200, verified: true, verifiedBy
                                        [sep53, sep53-manual] — for a signature
                                        made HERE by Keypair.signMessage
```

That last line is the measure of the instrument, not the answer. It proves the
route names the right envelope for a signature whose envelope is already known.
**The signature that matters has not been produced.** It requires Freighter in
a real browser and a human clicking the button, and until that happens piece 4
has no premise. Step B — connect → server challenge from the existing Upstash
challenge store → wallet signs → server verifies → the same session cookie the
passkey path issues — is written but not begun, and it stays unbegun rather
than being built against a guess.

**MEASURED — does a spending_limit bind a Soroswap swap? 2026-08-24.** C0, the
fact Milestone 3 rests on. Run against live testnet against the account
`CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM` from the agent-builder
run, which carries a `spending_limit` of `1000000` (0.1 XLM at 7dp) on
`CDLZFC3S…` — and Soroswap's testnet XLM is that same contract, so the input
token of an XLM→USDC swap is exactly the token the rule covers.

**(d) The addresses, read from source and confirmed live.** Soroswap's router on
testnet is `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` and the
factory is `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY`, agreeing
between `soroswap/core`'s `public/testnet.contracts.json` and their own live
`GET /api/testnet/router`. Testnet USDC is
`CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F` and testnet XLM is
`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, from
`soroswap/core`'s `public/tokens.json`. All four exist on testnet — probed by
`getLedgerEntries` on the contract instance, not assumed. The Route API is
`https://api.soroswap.finance`, `POST /quote` and `POST /quote/build`, with
`?network=testnet|mainnet`, read from their OpenAPI document at `/api-json`.
**`POST /quote` answers `403 Forbidden` without a registered API key**, which is
an account on a third-party service and therefore a decision rather than a step.

**(a) Yes — the input token leaves by `token.transfer` from the smart account.**
From their router source: `to.require_auth()` and then
`TokenClient::new(&e, &path.get(0).unwrap()).transfer(&to, &pair, &amounts.get(0).unwrap())`,
where `to` is the caller. Confirmed on chain rather than from the source alone —
a recording simulation of `swap_exact_tokens_for_tokens` returns one auth entry
whose credentials name the smart account, with this invocation tree:

```
CCJUD55A… :: swap_exact_tokens_for_tokens
  └─ CDLZFC3S… :: transfer
```

**(b) Yes — `__check_auth` sees that sub-invocation.** Proved by the diagnostic
event from an enforcing simulation, which prints the arguments `__check_auth`
was actually called with:

```
fn_call CBFLENP2… __check_auth
  { context_rule_ids: [0, 1], signers: {…} }
  [ [Contract, { contract: CCJUD55A…, fn_name: swap_exact_tokens_for_tokens }]
  , [Contract, { contract: CDLZFC3S…, fn_name: transfer,
                 args: [CBFLENP2…, CDVAIOYH…(the pair), 500000] }] ]
```

Two contexts, the transfer among them, with the smart account as `from`. So the
premise of the milestone is sound as far as it goes.

**(c) An over-cap swap does not trap with `SpendingLimitExceeded`, and does not
succeed unbounded. No swap executes at all.** The agent cannot authorize one at
any amount. `AuthPayload` carries one `context_rule_id` per context, and the
agent has exactly one rule — `CallContract(CDLZFC3S…)`, the token. Every
assignment was tried, agent-signed, against live testnet:

```
ids [1,1]   its own rule for both contexts     UnvalidatedContext#3002
ids [0,1]   borrow the Default rule for router UnvalidatedContext#3002
ids [0,0]   Default for both                   UnvalidatedContext#3002
ids [1]     one id for two contexts            ContextRuleIdsLengthMismatch#3014
```

The first is the finding: a `CallContract(token)` rule cannot validate a
`CallContract(router)` context, so the router leg has no rule the agent may use.
The second and third fail because the agent is not a signer on the `Default`
rule — rule 0's signer is the owner's key, so borrowing it fails the threshold
check. The fourth confirms the shape: `__check_auth` requires exactly one rule id
per context, so a swap needs two.

**The control, which is what makes the above readable.** A bare over-cap
`transfer` — the exact call the spending limit exists to bound — was run with the
same forged signature and reached the External verifier just as the swap did.
That proves the policy is evaluated **after** signature verification, so
"execution reached the verifier" says nothing about whether a cap would have
trapped. Without it, the swap results would have read as "the policy passed",
which is not a thing this run measured. Context validation *is* before
signatures, which is why the `#3002` results above are real.

**What this means for C1, stated as a decision rather than a plan.** The cap does
not bind a swap today because no swap can happen. Making one possible needs a
second context rule for the router contract — and `lower.ts` refuses to install
one by name (`unconstrained_contract`): a context rule with no policy authorizes
*every* function on its contract, and no audited primitive constrains a router
call. That refusal is correct and should not be relaxed quietly.

There is a narrower shape worth measuring next, and it is **not** measured here:
install `CallContract(router)` for the agent *alongside* the existing
`CallContract(token)` rule. A swap's two contexts would then be `[router, token]`
and the token context can only match the token rule — a router rule cannot
validate a `CallContract(token)` context, by the same argument that produced
`#3002` above — so the spending limit would still be the thing that sees the
transfer amount. The cost is that the router rule itself bounds nothing: the
agent could call any router function, constrained only where that function moves
the capped token back out through `transfer`. Whether that trade is acceptable is
§B8's question in a new place, and it is the owner's to answer before any of C1
is built.

**RUN — the cap traps an over-cap swap, on a ledger, 2026-08-24.** The question
left open above, closed by deploying a fresh account whose ed25519 signer keys
the run holds, installing **both** rules, and swapping for real.

```
smart account CB5RIOQKCQ2J7EUNPZCEAJEW34CP2T2XO74PYGJUA3XFFKOCQX3N2KWK
rule 1        CallContract(CDLZFC3S…)  spending_limit 10000000 (1 XLM/day)
rule 2        CallContract(CCJUD55A…)  no policies — the venue rule
```

| attempt | amount vs cap | outcome |
|---|---|---|
| under cap | 0.3 XLM of 1 XLM | **succeeded**, `3b6e6a1bfcdebeb89b79541837f4859b03aa468f0e2c0782940d8ffde78f846b` |
| over cap | 5 XLM of 1 XLM | **`SpendingLimitExceeded#3221`**, `f50d843159121842d8084be0d0827b4021fef4a1455f3a15900c81d0a09fe995` |

Both are real Soroswap swaps on testnet, signed by the agent's key alone with
`context_rule_ids = [venue, token]`. The first moved XLM into the pair and
returned USDC. The second was refused by the account before anything moved.

**The refusal is on a ledger and carries a hash, which is the whole point.** A
refusal at simulation costs no fee and produces nothing anybody can check — it is
Limen reporting what the network would have said. So the over-cap attempt was
forced onto a ledger using the under-cap swap's footprint, exactly as
`testnet.mjs` does for the transfer axis, and the code was decoded from the
transaction's own diagnostic events rather than from the simulation. `status:
FAILED`, `SpendingLimitExceeded#3221`, on chain, from the audited policy contract.

So the answer to C0(c), which the earlier run could not reach: **the cap binds a
swap.** Not by a Limen-side amount check — none was written and none is proposed
— but by the spending limit seeing the `token.transfer` sub-invocation the router
raises, exactly as the venue argument predicted.

**What the venue rule costs, restated now that it is real.** Rule 2 constrains
nothing. The agent may call any function on the Soroswap router. What stops that
mattering is that the money still leaves through a capped transfer, and rule 2
cannot validate a `CallContract(token)` context — so the token leg has nowhere to
go but rule 1. `lower.ts` carries the argument in full, including why the same
unconstrained rule on a **token** contract stays refused: a transfer *is* the
value movement, and there is no second context behind it to catch the amount.

**NOT RUN.** Anything about routing. The path is hard-coded to the direct
XLM/USDC pair; choosing a path is the Route API's job and `POST /quote` needs a
registered API key. No Limen code calls the Route API yet.

### M5 — End-to-end on testnet

The brief §51 demo, driven from the web chat: permitted, refused, revoked, and
the same call failing differently afterwards. Hashes recorded. **This is the
smallest working MVP** (§X) and the point at which the product exists.

### M6 — Telegram

Adapter, pairing token, `initData` HMAC, webhook secret, commands,
notifications. The scheduler ("every Friday") lands with it. Isolation test:
the adapter imports no policy, custody or chain module.

### M7 — Dashboard

Lifecycle state, balances, the boundary **read from the chain at a stated
sequence number**, the activity feed with its four outcomes distinguished,
transaction previews.

- **B8.2** — the partitioned policy panel: five network rows each with a refusal
  hash, one Limen row with no hash and the reason in the row.
- Design-suite assertions that the off-chain row carries no `ExplorerLink`, no
  hash column, and `COMPUTED LOCALLY` — enforced the way the four verdict states
  already are.

### M8 — Security suite, then the landing

All nineteen attacks from brief §55, each producing a hash or stating plainly why
there is none.

- **B8.3** — the unauthorized-recipient case asserts `refused_by_limen`, **not**
  `refused_by_network`, and asserts the absent hash as its result.
- Its companion: the gate bypassed, the payment **succeeding on-ledger with a
  hash**, recorded as evidence of the limit and published on `/docs/custody`.
- The full set re-run against `HostileModelProvider`, with identical outcomes
  (brief §28).

Then the landing rewrite (§35/§36) **last**, because the page states measured
numbers and the measurements have to exist first — including the duration claim,
which does not appear at all until `evidence.mjs` generates one (§7.2).

**P2, explicitly deferred:** SDK, marketplace, multi-agent, DeFi tools, mainnet,
agentic payments, Rust codegen, `batch_add_signer` owner upgrades.

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
10. All nineteen §55 attacks are run and recorded — including the
    unauthorized-recipient case, which asserts `refused_by_limen` and records its
    **absent** hash as the result, and its bypassed-gate companion, which records
    a **present** one.
11. The policy panel is partitioned, five rows carry refusal hashes, one carries
    `COMPUTED LOCALLY` and no link, and no off-chain row anywhere borrows a
    hash-backed row's visual language.
12. No agent has been deployed from an IP-reached origin, and the flow refuses
    one by name.
13. `caveats.test.ts` exists again, pins every caveat in both directions, and
    fails rather than falls silent if the thing it pins is deleted.
14. The full suite is green, and the count on the page matches the count in the
    run.

---

## The two open decisions, taken

Both were put to the owner and both are resolved. Recorded here rather than only
in their sections, because a plan that reads as though its hardest questions are
still open invites them to be reopened at the moment they are inconvenient.

**1. B8 — recipient allowlists: off-chain, under three conditions.** The check
lives server-side in the tool layer, never in React (B8.1). The policy panel is
partitioned into five network-enforced rows carrying refusal hashes and one
Limen-enforced row carrying none, with allowed-contract staying in the top group
because it genuinely is network-enforced (B8.2). The §55 test asserts *where* the
refusal came from, and the absent hash is the finding rather than a gap (B8.3).
Going on-chain remains a different plan that starts with an audit budget.

**2. B9 — passkey owner: mandatory, not default.** Revocation that depends on
Limen's cooperation is not revocation, and it is the one failure the §3 custody
answer cannot survive. Expiry is a mitigation and never a substitute — a
seven-day `valid_until` is seven days of an agent nobody can stop (B9.2). The
owner signer is fixed at creation, so the rule is a per-account gate at
agent-deploy time with a message naming the reason, not a global switch and not a
disabled button (B9.1). And it inherits V7's measured registrable-domain finding:
no agent deployment from an IP-reached origin (B9.3).

**And one that was not a decision, only a repair.** B0 — the README cites a test
that does not exist. It is M0, it lands before any V8 subsystem, and the suite is
restored rather than the sentences struck.

Everything else in this document follows from the §3 answer, and the §3 answer
follows from one sentence: an agent that answers a message signs while nobody's
browser is open.

---

**RUN — the stored trigger lands, and the ratchet is proved against Postgres,
2026-08-27.** C1's remaining gap closed: an agent had no stored rule for *when*
to trade, so `RunAgent` asked a person for one on every press and two cycles of
the same agent could run two different strategies.

```
migration    0008_agent_trigger  ALTER TABLE agents ADD COLUMN trigger_json jsonb
applied to   Neon (direct endpoint), 9 migrations recorded, column jsonb NULL-able
existing     0 agents carry a trigger — every pre-existing row reads as "no trigger"
```

The trigger is `{ kind, referencePrice, referenceLedger, dropBps, amount }` on
`agents`, **not** in `policies.enforced_offchain_json`. Everything in that column
refuses something; a trigger starts something, and filing it there would render
it under "Enforced by Limen" where a rule that begins a trade reads as one that
stops it.

`readPrice` moved to `@limen/chain`'s `quote.ts`, because the configure route now
reads the venue to stamp `referencePrice` and two copies of a quote could
disagree about the probe amount a reference is denominated in. A venue that
cannot be quoted refuses the whole configure rather than storing a rule that can
never be evaluated.

**The re-stamp, and the option taken.** A reference frozen at configure time
makes a one-shot: after the trigger fires the price is below it, so the agent
either fires every cycle forever or never again. Option 2 of four was chosen —
re-stamp on `succeeded` only, from the price the cycle traded at, downward only,
with the audit row carrying both halves. Upward movement is take profit, a
different trigger kind, and is not this one's unwritten half.

The downward-only property is refused twice, and the second refusal is the one
that survives a future caller:

```
restampReference   pure; refuses !succeeded, refuses price >= reference
UPDATE ... WHERE   (trigger_json->>'referencePrice')::numeric > $new::numeric
```

**A real Postgres caught what a fake would not have.** The first version passed
the *old* reference to the guard, so the comparison was `stored > stored` — false
for every write, and the three refusal tests all passed vacuously beside it. The
two downward tests failed against a throwaway `postgres:16`, which is the whole
argument `store-postgres.test.ts` makes for existing.

```
apps/runtime   130 passed, 0 skipped   (TEST_DATABASE_URL + REDIS_URL set)
packages/db     34 passed, 0 skipped
apps/web       812 passed, 0 failed
```

Two web failures were logged here first as *pre-existing*, and they were not.
`design-system.test.ts` had caught the swallowed-space defect twice on
`OffChainSummary.tsx:144` — a line this milestone rewrote, so `<em>payment</em>`
would have rendered as `paymentthis agent`. Both rules were pointing at new
work, and reading them as somebody else's is the exact failure the rules exist to
prevent: the defect is invisible in a diff and survives every type check. Fixed
with the `{' '}` the rule asks for.

The cycle request now carries nothing: `{ kind: 'cycle' }`, no config, and the
runtime derives the pair from `allowedPairs[0]` and the trigger from the column.
A stored trigger that fails its schema is reported as `trigger_unreadable` —
distinct from "no trigger configured", because telling somebody their agent has
no rule when it has one Limen could not read is a lie about which of the two is
wrong.

---

**RUN — the scheduler, and the two things that must not be silent, 2026-08-29.**
An agent has had a trigger since 0008 and still waited for a button. This is the
loop that asks it, and the two failure modes that would otherwise make the loop
worse than no loop at all.

```
migration    0009_scheduler
applied to   throwaway postgres:16, 10 migrations recorded
verified     CHECK scheduled_tasks_cron_xor_interval live
             UNIQUE turns_scheduled_slot_key WHERE scheduled_task_id IS NOT NULL live
```

`cron` becomes nullable beside `interval_seconds`, one of the two required by a
CHECK. A trading agent wants "every fifteen minutes"; reading a cron expression
means a parser, a timezone and a DST rule, each of which fails invisibly until
the clocks change.

**The claim, and why `dueAt` from the candidate row is sound rather than lucky.**
`claimDueTasks` reads candidates joined to `agents` so `status = 'ACTIVE'` lives
in the query, then takes each with a conditional UPDATE that repeats the check
with an `EXISTS` — a person can pause an agent between the two statements, and
the claim is the statement that has to be right. `next_run_at` only ever advances
strictly into the future, so a schedule another tick already claimed fails
`next_run_at <= now` and matches nothing; the only way the UPDATE matches is that
nobody moved the row.

It advances to the next slot **on the original grid**, not to `now + interval`
and not to the slot after the one that was missed. No catch-up. A scheduler that
caught up would re-run windows it was down through, and a turn that may have
submitted must never be re-run.

**Open item 1 — the staleness bound is ten minutes, and what fires is not a
retry.** The unresolvable turn is the one this exists for: a worker that died
between `sendTransaction` and recording leaves a turn `running` with a
`submitting` marker, and `turn.ts` already refuses to re-run it because "died
before submitting" and "died after submitting" are indistinguishable. Left alone
it holds its agent's schedule shut forever while every screen still says ACTIVE.

Ten minutes is more than an order of magnitude above the 15–45s an honest turn
takes, so no real turn is ever cut short; and it is short enough that an agent
misses one slot rather than a day of them. The tick is 30s, so the true worst
case is ten and a half minutes. `queued` is measured from `created_at`,
`running` from `started_at`.

What gets recorded when it fires, in four places and never a retry:

```
turns          status done, outcome infra_error, result.stage 'expired',
               mayHaveSubmitted read from the marker, previous kept
audit_events   schedule.turn_expired, actor system,
               result may_have_submitted | nothing_signed, metadata.retried false
notifier       turn_expired event, carrying mayHaveSubmitted
breaker        counted as `turn_expired` when the turn carried a slot
```

That last line is the one that is easy to leave out. Nothing ever calls
`finishTurn` for a stranded turn, so without it a worker dying every cycle fails
**silently forever**: the schedule keeps claiming slots it cannot run and nothing
counts.

**Open item 2 — the breaker leaves three facts, not one.** Three consecutive
cycles ending as anything other than `succeeded`, and the schedule stops:

```
1. row          enabled false, disabled_at, disabled_reason
2. audit        schedule.disabled, actor system, consecutiveFailures,
                agentStatusUnchanged true
3. notifier     schedule_disabled -> ScheduleNotifier (log today, Telegram later)
```

A no-trade cycle is `succeeded` — it ran and it reported — so a patient agent
cannot trip its own breaker by being patient. A refusal counts: an over-cap
refusal reaches a ledger, so retrying it every slot pays a fee every slot.

The count and the disable are **one statement**, comparing the threshold against
the value being written rather than one read a moment earlier. Two cycles
finishing at once would otherwise both write three and both believe they tripped
it, which is two notifications for one event, or none.

`agents.status` is deliberately untouched. The agent is still deployed, its
boundary is still installed, and it can still be run by hand, so `ERROR` would be
false about all three. What makes the stop visible instead is
`ScheduleControls`, which renders the agent's status and the schedule's state as
two separate lines and never infers one from the other — the failure mode being
designed against is a stopped schedule that looks exactly like a running one, and
is discovered a week later.

The notification seam is an argument, not an import. `ScheduleNotifier` is passed
in; `apps/telegram` plugs in without this file changing. A notifier that throws
is caught and dropped, because a reporting channel with the power to stop a
schedule would be a reporting path that breaks the thing it reports on.

**Pause** is `ACTIVE <-> PAUSED` on the agent, because the due query already
filters on status — one status change stops every schedule, in the statement that
makes the claim. It stops the *next* claim only; a turn already in flight is left
alone, and the response says so rather than letting it be assumed.

```
packages/core     53 passed      packages/chain   114 passed
packages/db       34 passed      packages/custody  36 passed
packages/kv       37 passed      apps/runtime     143 passed
apps/web         814 passed      eslint           clean
```

Six new Postgres cases carry the claim, the single winner among four concurrent
ticks, the invisibility of a paused agent and a disabled schedule, the unique
index refusing a bypassed second turn for a slot (asserted on the constraint's
own name and SQLSTATE 23505, not on a message), the staleness bound with its
marker, and the breaker's three-and-reset. Seven more drive the tick itself.

Not built, and deliberately: catch-up, and deployment. Deployment stays its own
milestone — nothing here has run anywhere but a laptop and a throwaway
`postgres:16`.

One correction to the entry above this one. `apps/web`'s two failures were
recorded there as pre-existing and were not: `design-system.test.ts` had caught
the swallowed-space defect on a line that milestone rewrote. Reading a rule's
finding as somebody else's work is exactly the failure that rule exists to
prevent, since the defect is invisible in a diff and survives every type check.
