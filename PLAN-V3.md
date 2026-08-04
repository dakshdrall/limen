# PLAN-V3 — from demo to instrument

Status: **steps 1–12 built and verified on testnet.** The sequence is complete.

---

## Decisions taken

Settled before building, and binding on everything below.

1. **The multi-contract gap is accepted.** No Limen-authored function-allowlist
   policy will be written. Composition-only is the strongest claim in the
   submission and is not traded for one flow shape. V3's on-chain path is
   scoped to single-token transfer flows; multi-contract flows stay in the
   simulator, labelled locally evaluated and not installable, with the reason
   stated on screen — no audited primitive exists for it yet. It becomes the
   roadmap trigger for future codegen.
2. **Both signer paths, keypair by default.** ed25519 is the path a reviewer
   lands on; passkey is offered where it works. A reviewer must never hit a wall
   they cannot get past.
3. **Blueprint direction.** Deep blue-black, thin rules on a visible grid,
   technical-drawing feel. IBM Plex Sans + IBM Plex Mono.
4. **`REFUSED AT SIMULATION` stays a distinct status**, never blurred into
   DENIED to make a table look complete.
5. **`validFromLedger` stays local provenance**, labelled, never rendered inside
   the on-chain rule block.

### One consequence of decision 2, flagged rather than assumed

"A reviewer never hits a wall" cannot mean `Delegated(G…)` through the wallet
kit — that walls anyone without Freighter installed. It means an ed25519 keypair
**generated in the browser**, used as `External(ed25519_verifier, pubkey)`.
That key lives in `localStorage`.

Design rule 3 currently forbids a user secret key reaching "the server, an
environment variable, or browser storage." It is narrowed to what it actually
protects — **no user key reaches the server or an environment variable** — with
the local key labelled `TESTNET ONLY · LOCAL KEY` and disposable by
construction. Wallet-kit `Delegated` drops out of v3 scope.

---

## What is built, and what it proved

Every hash below is on Stellar testnet and checkable in an explorer. The full
record is `packages/chain/deployments/testnet.json`.

| | |
|---|---|
| Smart account deployed | [`d9e735f3…`](https://stellar.expert/explorer/testnet/tx/d9e735f3ac9d58f17c405d0cee2b21042592e947fe349651d8d5d76c6e76dc8a) → `CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V` |
| Policy installed | [`173bcdef…`](https://stellar.expert/explorer/testnet/tx/173bcdef575913366e7e2d52cdefdba29d238084916f965f31caa383f21c6702) |
| Permitted transaction | [`59cfaf37…`](https://stellar.expert/explorer/testnet/tx/59cfaf3718fbe19887b9efb19a2284de4d6f85090506a132aff26d29a37841e9) |
| Network-rejected transaction | [`c4fff69b…`](https://stellar.expert/explorer/testnet/tx/c4fff69b5aedfc89d696e99cb90fdc435ae4c7a8e0eda817f49ab681826f004b) — `SpendingLimitExceeded#3221` |

**All six deny axes are refused by the network, and all six reached a ledger.**
The `REFUSED AT SIMULATION` state was designed for axes that could only fail in
simulation; measured, there are none. It stays in the design anyway, because a
normal client stops at simulation and will legitimately show it.

| Axis | Refused by | On-ledger |
|---|---|---|
| `amount` | `SpendingLimitExceeded#3221` | [`ac477549…`](https://stellar.expert/explorer/testnet/tx/ac4775493a581f2ddc8b72c54bebf1e8ba9e09ba33be5aa4e48e9f7fb0117a77) |
| `function` | `NotAllowed#3223` | [`45a0eb20…`](https://stellar.expert/explorer/testnet/tx/45a0eb2002ac8002d4abe3206979887ba189614794748cb30d2365b0b8c21f58) |
| `asset` | `UnvalidatedContext#3002` | [`1312be89…`](https://stellar.expert/explorer/testnet/tx/1312be89cf3b659e825071253be2972ce1aa9167afb65eca5d0d8f785ec64880) |
| `contract` | `UnvalidatedContext#3002` | [`6b7f4ded…`](https://stellar.expert/explorer/testnet/tx/6b7f4dedfd0e563da16e9510b09cfe2a035e2f340ed8f238c428561ace1c9389) |
| `invocation` | `ContextRuleIdsLengthMismatch#3014` | [`e365e681…`](https://stellar.expert/explorer/testnet/tx/e365e6819908a8567cec5afba2a203274df8591f895e34ea21405af202867149) |
| `expiry` | `UnvalidatedContext#3002` (simulation) | [`f5ebce51…`](https://stellar.expert/explorer/testnet/tx/f5ebce5170494ddd40eb73096cceaa32de4b287ec9b08bb9d1e53b7e1a848405) — failed on-ledger, but this run's diagnostic scan did not recover the contract code, so only the simulation error is attributed |

### The trap that nearly became a false claim

The first over-limit submission came back `FAILED` and was very nearly recorded
as proof. It was not a refusal — it was `invokeHostFunctionResourceLimitExceeded`.

Recording-mode simulation never executes `__check_auth`, so its footprint omits
the verifier and policy contracts and its budget omits their work. A transaction
assembled from it dies on resources *before the boundary is ever consulted*, and
reports the same operation result a genuine refusal does.

Two things came out of that, both now permanent:

- Every submission is simulated a **second** time with the signed auth entry
  attached, which is the only way to get a footprint and budget covering
  `__check_auth`.
- No failure is called a refusal until its **contract error code** is decoded
  out of the diagnostic events. `isBoundaryRefusal` in
  `packages/chain/src/errors.ts` is that check, and the error tables it reads
  are transcribed from the pinned OpenZeppelin sources.

---

## Original plan follows

The brief asked me to establish, before anything else, whether steps 1 and 2 —
deploy an OpenZeppelin smart account to testnet, install a policy on it, and
have the **network** refuse an over-limit call — are possible with the tooling
that exists today. The answer is the first section, because everything else is
contingent on it.

---

## 1. Verdict: steps 1 and 2 are possible. Not blocked.

I read the OpenZeppelin `stellar-contracts` sources at tag `v0.7.2` rather than
the prose documentation, because the docs describe the architecture and not the
signatures. What follows is from the code.

The relevant surface:

| Thing | Where | Shape |
|---|---|---|
| Smart account trait | `packages/accounts/src/smart_account/mod.rs` | `add_context_rule`, `add_policy`, `remove_policy`, `remove_context_rule`, `update_context_rule_valid_until` |
| Context rule | `smart_account/storage.rs:155` | `{ id, context_type, name, signers, signer_ids, policies, policy_ids, valid_until }` |
| Context type | `smart_account/storage.rs:143` | `Default` \| `CallContract(Address)` \| `CreateContract(BytesN<32>)` |
| Spending limit policy | `packages/accounts/src/policies/spending_limit.rs` | install params `{ spending_limit: i128, period_ledgers: u32 }` |
| Signer | `smart_account/storage.rs:96` | `Delegated(Address)` \| `External(verifier_address, pubkey_bytes)` |
| Deployable example | `examples/multisig-smart-account/` | account + ed25519 verifier + webauthn verifier + spending-limit policy, with a testnet deployment walkthrough |

There is a working, documented path to a deployed smart account on testnet with
a spending limit installed. The example's README walks it end to end with
`stellar contract deploy`. That is step 1 and most of step 2.

### The finding that matters most

I expected to have to write a Rust policy contract to get network-enforced
refusal on more than the amount axis. I do not. **All six deny axes are
refused by the network using only the audited OpenZeppelin primitives**, and
the reason is a detail of `spending_limit::enforce` that is not in the prose
docs.

`spending_limit::enforce` (`spending_limit.rs:222`) matches on the auth context
and `panic_with_error!(NotAllowed)` for **any** `fn_name` other than
`transfer`. It is not only an amount check — it is an amount check *and* a
single-function gate, because it refuses to be enforced against anything else.
And `install` (`spending_limit.rs:367`) refuses any context type other than
`CallContract`, so the policy is always pinned to exactly one token contract.

Combined with `get_validated_context_by_id` (`storage.rs:272`), which rejects a
context whose contract does not match the rule's `CallContract` address and
rejects a rule whose `valid_until` is below the current ledger, the mapping is:

| Deny axis | What the agent attempts | Refused by | Error |
|---|---|---|---|
| `amount` | transfer above the cap | `spending_limit::enforce` | `SpendingLimitExceeded` |
| `asset` | transfer of a different token | `get_validated_context_by_id` | `UnvalidatedContext` |
| `function` | any non-`transfer` call on the token | `spending_limit::enforce` | `NotAllowed` |
| `contract` | a call to a different contract | `get_validated_context_by_id` | `UnvalidatedContext` |
| `invocation` | an appended second call | context/rule-id length check, then one of the above | `ContextRuleIdsLengthMismatch` or `UnvalidatedContext` |
| `expiry` | the same call after `valid_until` | `get_validated_context_by_id` | `UnvalidatedContext` |

Six axes, six on-chain refusals, zero lines of Limen Rust. Design rule 2 —
composition of audited primitives only — survives v3 intact. That was not
guaranteed going in and it is the single best piece of news in this document.

### What I could not confirm, and where the remaining risk sits

Three things are unproven until a script runs them, and they are the first
three commits of this plan, in this order:

1. **Building the WASM.** This machine has no Rust toolchain and no `stellar`
   CLI. Docker is available and testnet RPC answers (`getLatestLedger` returned
   ledger 3,935,377, protocol 27). Building `stellar-contracts` requires
   `wasm32v1-none` and a recent `stellar` CLI. Expected to be routine; not yet
   done.
2. **Signing `__check_auth` from JavaScript.** The smart account expects a
   custom signature shape — `AuthPayload { signers: Map<Signer, Bytes>,
   context_rule_ids: Vec<u32> }` — and signers sign `sha256(signature_payload
   || context_rule_ids.to_xdr())`, not the host payload directly. The SDK
   supports this: `authorizeEntry`'s signing callback accepts a
   `{ signatureScVal }` return that is written verbatim into the credentials
   (`@stellar/stellar-sdk@16.2.0`, `lib/esm/base/auth.d.ts:24-33`). So the
   shape is expressible. What is unproven is the XDR encoding of the `Signer`
   enum and the `Map<Signer, Bytes>` key ordering, which the host will reject
   if wrong. This is the highest-risk hour of the project and it is bounded:
   it either round-trips or it does not, and a script tells you within one
   testnet submission.
3. **Getting a failed transaction *hash*, not just a failed simulation.** See
   §4 — this is subtle and it changes what the refusal screen can claim.

If any of the three fails I will stop and say so rather than build UI over it.

---

## 2. Three places where Limen's model and OpenZeppelin's model do not line up

These are not blockers. They are places where the current `PolicyProposal` says
something the chain cannot be made to say, and where v3 must either lower it
faithfully or refuse to install and name the reason. The repo already has the
right instinct for this — "accurate or absent, never quietly narrowed" — and
the chain layer should inherit it exactly.

### 2.1 `allowedContracts` is a list; a context rule holds one contract

`ContextRuleType::CallContract(Address)` takes a single address. A proposal
with two contracts lowers to **two context rules**, not one. That is fine and
faithful. But it changes the meaning of a "policy" in the UI: what the user
installs is a *set* of context rules, and revoking is removing that set.

Consequence for the data model: the installed artifact is
`{ smartAccountId, contextRuleIds: number[], policyIds: number[] }`, not a
single id. Every screen that says "the policy" must mean that set, and the
detail screen should show the rules individually with their on-chain ids,
because those ids are what an explorer and a support conversation will use.

### 2.2 `function_allowlist` has no counterpart, except by subsumption

OpenZeppelin ships three policies — `simple_threshold`, `weighted_threshold`,
`spending_limit`. There is no function-allowlist policy. As established above,
`spending_limit` *is* a `transfer`-only gate as a side effect of its
implementation.

So the lowering rule is precise and checkable:

> A `function_allowlist` policy on contract `C` is enforceable **iff** its
> function set is exactly `['transfer']` **and** the same proposal carries a
> `spending_limit` whose asset is `C`. Any other function set is not
> expressible with audited primitives, and lowering throws
> `not_enforceable` naming the functions it could not enforce.

This must be an explicit assertion in the lowering code, not a comment. If a
future OZ release changes `enforce` to permit other function names, that
assertion is what fails, loudly, instead of Limen silently claiming an
allowlist it no longer has.

The practical effect: **v3's on-chain path covers single-token transfer flows.**
The `swap-two-calls` fixture — a router call plus a token transfer — lowers to
a refusal, because the router's context rule would carry no policy and would
therefore permit every function on the router, which is broader than what
`synthesize` derived. That is a real narrowing against what the brief implies,
and it should be stated on the install screen in those words rather than
discovered by a reviewer.

### 2.3 `validFromLedger` does not exist on-chain

`ContextRule` has `valid_until: Option<u32>` and no lower bound. Limen's
`ContextRule.validFromLedger` has no on-chain counterpart.

It is not a licence to drop it silently. `validFromLedger` is currently
`observed.ledger` — the ledger the policy was derived from — which is genuinely
useful provenance. Handling: keep it in the domain model, persist it, render it
under a `COMPUTED LOCALLY` label, and never render it inside the on-chain rule
block. The install summary must show exactly the fields that went to the chain
and nothing else.

### 2.4 A smaller mismatch worth writing down

`MAX_POLICIES = 5` appears in both models but counts different things.
`@limen/core` counts policies across the whole proposal; OpenZeppelin counts
policies **per context rule**. A proposal at Limen's limit can lower to
several rules each well under OZ's. The lowering must check OZ's limit per
rule independently rather than assume core's check covered it.

---

## 3. `packages/chain`

New workspace. Everything that touches the network lives here. `packages/core`
does not change in this plan — not one line — and the synthesizer remains the
only thing that produces policy.

```
packages/chain/
  src/
    lower.ts        PolicyProposal -> InstallPlan.  Pure. No network. No SDK.
    plan.ts         InstallPlan types + NotEnforceableError
    deploy.ts       upload wasm / deploy smart account instance
    install.ts      InstallPlan -> unsigned transactions
    revoke.ts       remove_policy / remove_context_rule
    events.ts       Soroban event reads -> Activity
    signers/
      passkey.ts    WebAuthn -> External(webauthn_verifier, pubkey)
      delegated.ts  wallet-kit G-address -> Delegated(address)
      agent.ts      raw ed25519 -> External(ed25519_verifier, pubkey)
    authpayload.ts  AuthPayload ScVal encoding + auth-digest derivation
    wasm/
      manifest.json contract name -> { wasmHash, sourceRev, buildCommand }
  test/
```

Two rules for this package, both load-bearing:

**`lower.ts` is pure and independently testable.** It imports nothing from the
Stellar SDK. It takes a `PolicyProposal` and returns an `InstallPlan` — a plain
description of context rules and policy installs — or throws
`NotEnforceableError` with the constraint named. It is the direct analogue of
`synthesize`, and like `synthesize` it refuses rather than approximates. This is
what lets the deny-case harness run against the *lowered* plan with no network.

**The lowering is verified against the deny table, in the existing harness.**
For every case `generateDenyCases` produces, a test asserts which OZ error the
lowered plan would produce, from a table written by hand against the sources
cited in §1. That table is a claim about someone else's contract, so it is
verified a second time by the live script in step 2 of the sequence, and the
two must agree. A unit test alone would only prove Limen is self-consistent —
the same trap design rule 4 already guards against in `evaluate`.

### The Rust artifact

Limen writes no Rust. It still needs four WASM binaries: the account, the
ed25519 verifier, the WebAuthn verifier, and the spending-limit policy — all
from `OpenZeppelin/stellar-contracts` at a pinned tag.

Proposal: **build once, upload once, never at runtime.**

- A documented one-time build (`scripts/build-contracts.sh`, docker-based so it
  does not require a Rust toolchain on a contributor's machine) produces the
  four `.wasm` files from the pinned OZ tag.
- Each is uploaded to testnet once. `wasm/manifest.json` records, per contract:
  the wasm hash, the OZ tag and commit, the build command, and the testnet
  upload transaction hash.
- The app deploys **instances** from the recorded wasm hash. No Rust toolchain
  in CI, none in the app, none needed to run the project.
- The verifiers and the policy contract are stateless-or-shared and deployed
  **once**, not per user. Only the account instance is per user.

The `.wasm` files are not committed. The manifest is, and it is enough for
anyone to rebuild and compare hashes. I will not claim the build is
byte-reproducible unless I have reproduced it; the honest statement is "built
from this tag with this command, hash recorded, rebuild to check."

---

## 4. Real refusal — and the part that is harder than it looks

The brief says: *show the failed transaction hashes next to the permitted one.*
There is a trap here worth naming before any UI is drawn.

`__check_auth` runs during **simulation**, not only during execution. So an
over-limit transfer fails at `simulateTransaction` and a normal client never
submits it — there is no hash, because nothing reached a ledger. A screen that
showed a hash there would be showing a hash of something that never happened.

To get a genuine on-ledger failure you must submit a transaction whose
simulation failed, which means supplying a footprint and resource fee that
simulation did not give you.

- **The `amount` axis works.** The over-limit transfer touches exactly the same
  ledger entries as the permitted one, so the permitted call's footprint and
  resource fee can be reused verbatim. Submit it and it fails in a ledger with
  a real hash and `SpendingLimitExceeded` in the diagnostic events. This is the
  headline row of the deny table and it is achievable as specified.
- **The other five axes need a per-axis check.** Some will submit fine with a
  constructed footprint; some may not. This is measured in step 2, not guessed.

Where an axis can only be refused at simulation, the row says so — *"refused at
simulation; never reached a ledger"* — with the RPC error and the contract error
code, and no hash. That is a weaker claim than a hash and it must look weaker
on screen. It is still a network refusal: the refusal came from the contract,
executed by the host, not from `evaluate`.

This distinction gets its own status label alongside `ON-CHAIN` /
`COMPUTED LOCALLY`: **`REFUSED AT SIMULATION`**. Extending the existing
provenance discipline is exactly what the brief asked for.

---

## 5. Signing, and who holds which key

Three distinct actors. Keeping them straight is most of the security argument.

| Actor | Signer type | Key held where | Purpose |
|---|---|---|---|
| Owner (passkey) | `External(webauthn_verifier, pubkey)` | platform authenticator; never leaves it | deploy, install, revoke |
| Owner (fallback) | `Delegated(G…)` | Freighter / xBull, via wallet kit | same, where passkeys are unavailable |
| Agent | `External(ed25519_verifier, pubkey)` | the agent's own process | operate inside the boundary |

The owner's key never reaches the server, an environment variable, or browser
storage — design rule 3 is unchanged and unrelaxed. The **agent's** key is a
different thing: it is the agent's own, it is bounded by the installed policy,
and it can be revoked. That is the entire product thesis, and it is worth
stating on the docs page in those terms.

Two notes on the mechanics:

- **Passkeys are the primary path**, per the brief. WebAuthn signatures go into
  `AuthPayload.signers` directly and need no wallet and no extension. Passkeys
  are bound to an origin, so a credential created on `localhost` will not work
  on the deployed host and vice versa — the UI must state which origin an
  account's passkey belongs to, or a reviewer will hit an unexplained failure.
- **`Delegated` costs more work than `External`.** `authenticate` resolves it
  as `addr.require_auth_for_args((auth_digest,))` (`storage.rs:353`), which
  raises a nested auth requirement that simulation in recording mode will not
  discover, because recording mode does not execute `__check_auth`. That entry
  has to be constructed by hand. The passkey path has no such problem. If the
  delegated path proves expensive, ship passkey-only for v3 and say so — the
  brief allows "keypair fallback where the tooling doesn't support it", and
  this is a tooling gap in exactly that sense.

---

## 6. Persistence

Wallet-address-keyed, no accounts, no passwords, no email — as specified.

The honest constraint: an address is a public identifier, not a credential.
Anything stored server-side under a bare address is readable by anyone who
knows the address. So the split is:

- **The chain is the source of truth** for what is installed. Context rules,
  policies, and their ids are read back from the smart account, not from a
  database. A reload does not restore a stored answer; it re-reads the chain.
  This is the same discipline the `/demo` reload test already enforces.
- **Local storage holds pointers only** — the set of smart account addresses
  this browser knows about, and the derivation provenance for each installed
  policy (the observed transaction hash, the synthesis options). Enough to
  reconstruct the screen; never a claim about chain state.
- **"Survives a new browser"** therefore means: paste or connect the wallet
  address, and everything installed is read from the chain. Nothing important
  lives only in a browser. A new browser with a fresh passkey will not be able
  to *sign* for an existing account — correctly so — and the empty state must
  explain that rather than looking broken.

No shared backing store is introduced. The existing `TODO(roadmap)` for the
waitlist and rate limits stands unchanged.

---

## 7. Activity from chain events

`getEvents` against the smart account and the policy contract. The events exist
and are typed in the sources:

- From the account: `context_rule_added`, `policy_added`, `policy_removed`,
  `context_rule_removed`, `signer_added`, `signer_removed`
- From the policy: `spending_limit_installed`, `spending_limit_enforced`,
  `spending_limit_uninstalled`, `spending_limit_changed`

`spending_limit_enforced` carries `{ smart_account, context, context_rule_id,
amount, total_spent_in_period }` — which is a permitted spend with its running
total, exactly what the activity table needs, straight from the chain.

Rejected attempts are the asymmetry: **a failed transaction emits no contract
events.** Events are only emitted on success. So the activity feed reads
permitted calls from events and refused ones from transaction results — a
different source, a different confidence, and the table must label which is
which rather than blending them into one list. A refusal that never left the
browser (simulation-only) is not chain history at all and belongs in a
separate, clearly local section, if it is shown at all.

Also: Soroban RPC retains events for a limited window (roughly a day on
testnet). Activity older than the retention window is *gone*, not empty. The
empty state must distinguish "nothing happened" from "beyond the RPC retention
window" — the second is not the account's history, it is the RPC's memory.

---

## 8. Screens

Order is the brief's order, and no screen is built before the chain call it
displays works from a script.

```
/                     marketing — spec strip, mechanism, deny axes, numbers, code
/app/accounts         list; empty state is a real screen
/app/accounts/new     deploy: passkey → deploy → wasm hash, contract id, tx hash
/app/accounts/[id]    detail: rules, policies, signers, all read from chain
/app/policies/new     import tx → review derived boundary → lower → install
/app/policies/[id]    detail, activity, revoke
/app/activity         everything, across accounts
/app/simulator        the current demo page, demoted to one tool
/docs                 pointing an agent at an installed policy
```

Built as of step 10, except `/app/accounts/new`: deploying is a write, and the
missing browser signer blocks it for the same reason install and revoke are
blocked. It is absent from the nav rather than present and broken.

The **refusal screen** — permitted transaction next to refused attempts, each
with its hash or its stated absence — is the product. It is the policy detail
screen's primary content, not a tab.

Three states every async screen needs designed rather than defaulted, per the
brief: empty (a real instruction), pending (what specifically it is waiting
for — "simulating", "awaiting passkey", "submitted, waiting for ledger 3935412"),
and refused (which is a result, not an error — the existing `RefusalSection`
already gets this right and should set the pattern).

---

## 9. Design system

The current build is not undesigned — `globals.css` already has a four-step
contrast ramp, tabular numerals, a sans/mono split for prose-versus-chain-data,
and PERMIT/DENY that carry glyph and border so they read in greyscale. Those
are the right ideas and they stay. What reads as generated is narrower than the
brief's framing suggests, and it is three specific things:

1. **Geist.** It is the Next.js default typeface loaded from the Next.js
   default helper. Whatever its merits, it is *the* tell.
2. **`ui-sans-serif, system-ui, sans-serif` fallbacks**, which the brief
   forbids outright.
3. **The scroll-pinned landing.** One sentence per viewport with a button. The
   brief's diagnosis — substance, not spacing — is correct.

Proposed replacement, as decisions rather than directions:

**Typeface.** IBM Plex Sans (variable) + IBM Plex Mono, self-hosted via
`next/font/local`, no fallback stack beyond a metric-matched local face. Plex
was drawn for technical documentation, has genuine range across weights, and
its mono is a true companion rather than a separate design — which is what
makes "mono is reserved for on-chain values" read as a system rather than a
mix. `font-variant-numeric: tabular-nums` set globally on `body`, not per
component, so a new table cannot forget it. If a single-family answer is
preferred, Atkinson Hyperlegible Next + Atkinson Hyperlegible Mono is the
alternative worth considering — it satisfies the accessibility constraint by
construction rather than by audit.

**Grid.** A shared column token set, used by every table in the app:

| Token | Width | Contents |
|---|---|---|
| `col-addr` | 22ch | truncated `C…`/`G…` address, full value on hover and copy |
| `col-hash` | 18ch | transaction hash |
| `col-amount` | 14ch | right-aligned, tabular |
| `col-ledger` | 9ch | right-aligned, tabular |
| `col-verdict` | 11ch | PERMIT / DENY / REFUSED |
| `col-label` | 10ch | status labels |

A contract address is the same width on every screen because it is the same
token on every screen, not because someone matched it by eye.

**Colour.** The existing near-monochrome base stays. One accent
(`--accent: #6cb6ff`) for active state only. PERMIT and DENY keep hue plus
glyph plus border. The one addition is a third verdict state for
`REFUSED AT SIMULATION`, which must be visually distinct from DENY without
being a fourth hue — border style and glyph, no new colour.

**Status labels.** `OPEN SOURCE` · `MIT` · `TESTNET ONLY` · `IN DEVELOPMENT` ·
`NOT AUDITED` · `COMPOSITION ONLY` · `NO CUSTODY`, as a single `<StatusLabel>`
component with a closed union of values, so no screen can invent one. Two
placements are mandatory: the spec strip on the landing page, and
**`NOT AUDITED` inside the install confirmation**, above the button, where a
person sees it before they sign.

**Chrome.** Persistent top bar, `MECHANISM · INTERFACE · ACTIVITY · SIMULATOR ·
DOCS · GITHUB`, wordmark left, `TESTNET` indicator right, current section
`aria-current="page"` and visibly active. The network indicator reads from the
same constant the chain layer uses to pick its RPC, so it cannot disagree with
what the app is actually talking to.

**Numbers section.** Generated, not typed. A build step writes `evidence.json`
— tests passing, deny axes covered, testnet hashes recorded, policies installed
— from the test run and the recorded transactions. A hand-typed count is a
number that rots, and a rotted number on a page about honesty is worse than no
number.

The design pass runs **last**, once screens are stable, per the brief's
sequence. The one exception is the type and grid tokens, which land before the
first new screen so the screens are not built twice.

---

## 10. Sequence

Each step ends with something demonstrable. Steps 1–3 are the risk and they are
gated: if a gate fails, work stops and I report rather than build around it.

| # | Step | Done when | Status |
|---|---|---|---|
| 1 | Build the four WASMs from OZ `v0.7.2`, upload to testnet, record hashes in `wasm/manifest.json` | four upload tx hashes, explorer links | **done** |
| 2 | Deploy a smart account instance from a script | contract id + deploy tx hash, explorer link | **done** |
| **G1** | **Gate** | if 1 or 2 fail: stop, report | **passed** |
| 3 | Sign `__check_auth` from JS — a plain transfer through the smart account | permitted tx hash | **done** |
| **G2** | **Gate** | the `AuthPayload` encoding round-trips, or stop and report | **passed** |
| 4 | Install a spending limit; submit an over-limit transfer; record the failure | permitted hash + rejected hash, both in README | **done** |
| 5 | Per-axis refusal survey: which of the six produce an on-ledger hash and which are simulation-only | a table, recorded, feeding §4's labels | **done — all six on-ledger** |
| 6 | `lower.ts` + the lowering harness; wire the synthesizer's output into step 4's path | deny-case harness green against lowered plans; live agreement with step 5 | **done — 26 tests** |
| 7 | Persistence and the account/policy data model | chain re-read on reload, verified | **done** |
| 8 | Type and grid tokens | before any new screen | **done** |
| 9 | Screens: accounts → new policy → policy detail (the refusal screen) → activity | each demonstrable | **done — reads only; install still needs a signer** |
| 10 | Simulator (demoted demo) and docs | | **done** |
| 11 | Design system pass across everything | | **done** |
| 12 | Landing rebuild: spec strip, mechanism with a worked example, deny table, numbers from `evidence.json`, code snippet | all five present, and the page reads every one of them from a file | **done** |

Steps 1–5 produce no UI at all. That is deliberate.

### What step 6 actually landed

`packages/chain`, wired into `npm test` and CI:

- `src/lower.ts` — pure `PolicyProposal → InstallPlan`, throwing
  `NotEnforceableError` with the constraint named. This is where
  composition-only is enforced: a router call with no audited policy to
  constrain it refuses rather than installing a rule that would permit every
  function on that router.
- `src/plan.ts` — the plan types and the on-chain limits they must respect
  (`MAX_NAME_SIZE` 20 bytes, `MAX_POLICIES` 5 **per rule**, which is a different
  denominator from `@limen/core`'s 5 per proposal).
- `src/authpayload.ts` — the `AuthPayload` encoding and the auth digest, both
  now confirmed by a live host rather than only by their own tests.
- `src/errors.ts` — the contract error tables and `isBoundaryRefusal`.
- `scripts/testnet.mjs walkthrough` — reproduces install → rejected → permitted
  end to end. Secrets come from the environment; none is committed.
- `deployments/testnet.json` — every hash above.

`packages/core` is unchanged: `git diff --stat packages/core` is empty.

### What step 8 landed

The blueprint token layer, in `globals.css`, `layout.tsx`, and three components.
IBM Plex Sans + Plex Mono self-hosted by `next/font`; deep blue-black ground
with a two-pitch grid; one accent; tabular numerals set once on `body`; column
widths as `--col-*` tokens so an address is the same width everywhere.
`Verdict` gains `refused-at-simulation`, drawn in the neutral ramp with a
dashed border rather than a fourth hue. `TopBar` is on every screen with a
`TESTNET` indicator reading the same constant transaction-building reads, and
renders unbuilt sections as unavailable rather than linking to 404s.

`test/design-system.test.ts` pins the rules that can rot silently: no
system-font fallback stack, tabular numerals on `body`, every column width a
token, three verdict states each with a glyph, one accent, no gradient fills or
shadow depth, focus visible, reduced motion respected.

Three bugs came from looking at the rendered page rather than from the tests:
translucent cards let the grid show through and stopped reading as surfaces; the
top bar was 95% opaque with no blur, so content bled through the chrome; and the
deny table's reason column pushed 56-character addresses past the viewport.
Verified in full greyscale — PERMIT and DENY stay distinguishable with every hue
removed.

### What step 9 landed

Four screens, in the brief's order, each driven in a browser against the live
testnet account rather than only against fixtures.

`/app/accounts` lists what this browser has been shown and reads every fact
*about* those accounts from the chain; `/app/accounts/[id]` shows the installed
boundary — rules, signers, policies, caps, spend — at a stated ledger.
`/app/policies/new` observes a transaction, derives a boundary, and then lowers
it, which is the step `/` does not have: what `synthesize` produces and what an
OpenZeppelin account can hold are different languages, and the translation
either succeeds or is refused with the constraint named.
`/app/policies/[id]` is the refusal screen. `/app/activity` reads contract
events.

**The install step does not complete, and the screen says so in place of a
button.** Writing a context rule needs an owner signature, and no browser signer
exists yet: the passkey path is unbuilt and so is the local ed25519 keypair that
would stand in for it. A disabled button would claim the feature exists and is
temporarily broken; neither is true. Deploy and revoke are absent for the same
reason. Everything else on these screens is live.

`packages/chain/src/events.ts` is new. Three things it found that the plan had
wrong or did not know:

- The account emits `context_rule_added`, `policy_registered`, and
  `signer_registered` — not the `*_added` spellings §7 inferred from the
  sources.
- **A single `getEvents` call scans roughly 10,000 ledgers and then returns a
  cursor, not an error.** Asking for the full retention window in one call
  returns an empty page while real events sit 100,000 ledgers further on.
  Reading that as "nothing happened" is the exact failure §7 warned about,
  arrived at from the opposite direction. The scan pages through the cursor and
  reports `truncated` when its budget runs out first.
- Retention on this endpoint is ~120,960 ledgers (~7 days), not the ~1 day §7
  assumed. It is read from `getHealth` rather than assumed at all now, and the
  screen prints the range it actually scanned.

`policy_registered` and `signer_registered` carry a policy id and a signer id in
their second topic — separate counters from context rule ids. Filing either
under the rule that shares its number would be a wrong answer that looks
entirely plausible, so the decoder reports `contextRuleId: null` for them and a
test pins it.

Two bugs came from looking at the rendered page. Both were the same class, and
both were in tokens step 8 shipped but no table had exercised: under
`table-layout: fixed`, a column narrower than its contents does not shrink or
scroll them, it overlaps the next column. The verdict badge sat on top of the
adjacent cell's text and a 9-character ledger number ran into the row beside it.
The tokens stated content width and ignored the 0.75rem of cell padding either
side; `--col-pad` is now added by the column classes, and a test pins it.

### What step 10 landed

`/demo` is now `/app/simulator`, and `/demo` 308s to it — the old path is in
this repository's own history and in whatever a reviewer bookmarked while the
demo was the front door.

**The demotion is stated on the screen, not just enacted by the routing table.**
A page that quietly stopped being linked from the landing page would still read,
to anyone who arrived on it, as the thing the product does. It now says what it
is for — the reasoning engine with the chain taken away — and links to
`/app/policies/new` as the same derivation against a real account.

What earns the demotion is a sixth beat: **could this be installed?** The
simulator lowers what it derived and reports the answer. That is where decision
1 finally has a home on screen: `swap-two-calls` refuses with
`function_allowlist_not_expressible` and the constraint named, and the screen
says that is *why the flow lives here* rather than omitting it. Lowering is one
`useLowering` hook shared with `/app/policies/new`, and `NotEnforceable` is one
component shared with it, because two copies would drift — and the direction is
predictable: the screen with no install button is the one where an unenforceable
boundary costs nothing to render as fine.

Three things came out of building it that the plan had not accounted for:

- **The preset path was a dead end.** Skipping an unconfigured beat 1 advanced
  to beat 2 with no hash, which rendered "beat 1 has not produced a transaction
  yet" and nothing to click. Every reviewer running this repository without
  `LIMEN_DEMO_SECRET` — most of them — hit a wall on the second step of the
  page that existed so nobody would hit a wall. Presets are now a first-class
  choice at step 1, always offered, not a fallback.
- **A shipped fixture was about to be rendered as a transaction.** Fixture
  hashes are 64 hex characters and their addresses are real StrKey, on purpose,
  so they look like production data — which meant beat 1's explorer link and its
  `on-chain` badge would both have been claims about a transaction that never
  existed. `Beat` gained a third kind, `shipped fixture`, drawn dashed like the
  third verdict state; the explorer link is replaced by a sentence saying no
  explorer will find this hash and why. The source is derived from the shipped
  preset list rather than persisted, so `DemoState` did not have to grow a
  field — only its accepted beat range widened, which is backward compatible,
  so a reviewer mid-run does not get reset.
- **One caveat had outlived its reason.** Beat 5 said the payload could not be
  submitted because "this MVP does not deploy a smart account". It deploys one;
  the hashes are in `deployments/testnet.json`. A caveat that is *too*
  pessimistic is still inaccurate, and it stops being load-bearing the moment
  someone notices. It now gives the reason that is true: no account to write to
  and no signature to authorize the write.

`/docs` is the other half. It states the thesis in §5's terms — the claim is not
that the agent holds no key, it is that the key it holds cannot exceed the
boundary and can be revoked — then walks the three keys, the install, the
`AuthPayload` the agent signs, the simulate-twice rule, and what the network
does when the agent tries to go further. **Every address, hash, cap and error
code on it is read from `deployments/testnet.json` and `@limen/chain`'s own
error tables**; none is typed into the page. Documentation that restates a
contract address in prose is documentation with a stale address in it one script
run later, and a page whose whole argument is "check this yourself" cannot
afford one number a reviewer checks and finds wrong.

Two things came from looking at the rendered page rather than the tests. The
outcome table had hand-rolled `permitted` / `refused` as two coloured words
instead of using `Verdict`, which is precisely where the glyph-plus-border rule
quietly stops holding; and the cap was formatted with `toLocaleString()` beside
the app's own `decimalise` and `ledgersToDuration` everywhere else. Both now use
the shared components. Verified in full greyscale, and at 390px, where neither
new screen scrolls the body horizontally.

`design-system.test.ts` could no longer assert that some nav section carries
`built: false` — every section is built now, and that assertion would only be
satisfiable by leaving a screen unfinished. It asserts the *branch* survives
instead, and gained the other half it was missing: every `built: true` href must
resolve to a page file, which is the typo that produces the exact 404 the flag
exists to prevent.

**The end-to-end suite was re-run against live testnet on the moved route**,
twice, each invocation its own `next start` and its own clean browser profile —
so the second run is cold: empty rate-limit window, empty transaction cache.
It now drives all six beats, including the new one.

| Run | Transaction | Ledger |
|---|---|---|
| 1 | [`63cd81c8…`](https://stellar.expert/explorer/testnet/tx/63cd81c8287c312741f122b5be0583ddc472a04ce1acdc4d4a3e3556ccf32eb9) | 3,958,594 |
| 2 (cold) | [`6d76fb40…`](https://stellar.expert/explorer/testnet/tx/6d76fb4019ffc1659e42e817c6c1f3cc30bb66fc0c9ea04eda491c07a12b377b) | 3,958,602 |

Both were confirmed against public Horizon afterwards rather than only by the
suite that produced them. A test asserting its own transaction succeeded is a
test agreeing with itself; the check that matters is the one made from outside
the process, with no credentials, against an endpoint this repository does not
configure. This closes the §11 item asking for two completions from a clean
browser with the second cold.

### What step 11 landed

Step 8 tokenised the *boxes* — column widths, type, verdicts — and left what
goes in them to each screen. Ten steps later seven screens had each decided,
separately, how much of a transaction hash to show, how to draw a link out to an
explorer, and what a control looks like. None of those decisions is wrong on its
own. What is wrong is that they disagree, and disagreement at that scale is
precisely what makes an interface read as assembled rather than designed: the
eye registers that two screens differ about a measurement long before anyone can
say which one.

So this step is not a restyle. Nothing about the blueprint direction changed.
What changed is where each decision lives.

Five things were stated once instead of five to seven times:

- **`ScreenHeader`** — the block every screen opens with. The lede was capped at
  76ch on two screens and 78ch on three, for no reason either of them recorded.
  `labels` is required rather than optional, because a screen that *can* omit
  its `TESTNET ONLY` is a screen that will omit it on the day someone is
  in a hurry.
- **`.screen`** — one shell. Seven pages had chosen three maximum widths and
  four section gaps. Navigating between two screens must not feel like the
  application resized itself.
- **`ExplorerLink` and `TxHash`** — the link out to a block explorer had three
  treatments and the hash inside it had four truncations, all rendering into
  `--col-hash`, which is one token precisely so a hash is the same width
  everywhere. The token fixed the box and left the contents to drift.
- **`.btn` gains a register, not a fourth variant.** The app screens' controls
  speak in the mono label voice — `SCAN AGAIN`, `FORGET` — beside `.col-head`
  and `.status-label`. Five existed inline; two were byte-identical, a third
  differed only in hover hue, and they disagreed about size, radius and what
  disabled looks like. Variants say how much weight a control carries; the
  register says which voice it speaks in. Folding the voice into the variants
  would have produced `label-secondary` and `label-quiet`, and a closed set
  stops being closed the moment it has to multiply.
- **`chainTxUrl`** — three screens had `https://stellar.expert/explorer/testnet`
  typed into them, which is the second place for the network to be wrong that
  `lib/network.ts` warns about in as many words. `NETWORK` is a union with one
  member today; when mainnet is added the segment map fails to typecheck until
  it is supplied, and the screens follow instead of continuing to link testnet
  with total confidence.

**The same layout bug appeared for the third and fourth time**, and only the
first two were the kind step 9 fixed. Under `table-layout: fixed` a cell that
cannot fit its contents does not shrink them and does not scroll them — it
paints them across the next column, which looks like a spacing problem and is
not one. Step 9 hit it with a verdict badge and a ledger number, both solved by
adding the cell padding to the column tokens. These two could not be:

- `ContextRuleIdsLengthMismatch#3014` is a single unbreakable 33-character
  token, and at the refusal table's minimum width it overlapped the transaction
  hash beside it by 67 pixels. It now has `--col-error`, sized to the longest
  code the pinned OpenZeppelin sources define, so it stays on one line at every
  width.
- The rules table's signers column holds a status label beside an address, and
  *both halves correctly refuse to wrap* — a truncated address broken over two
  lines reads as two values. No wrapping rule could have saved it; it needed
  `--col-signer`. That table had given three of its seven columns a token and
  left four to fend for themselves, and the one holding the widest unbreakable
  content is the one that lost.

`overflow-wrap: anywhere` on `.tbl` cells is the general backstop for the class,
and `anywhere` rather than `break-word` because only `anywhere` also reduces the
min-content width a fixed layout actually distributes.

Both were found by measuring the rendered page rather than by reading it —
column gaps computed in the browser across four viewport widths and every
screen. The first was visible in a screenshot once pointed at; the second was
not obvious at all until the numbers came back negative.

One regression came from this step's own refactor and is worth recording,
because it is the kind that survives review. `ScreenHeader` wrapped the lede in
a flex column, and a flex column makes a block out of every child it is given —
so the activity screen's one sentence about what a boundary *permitted* rendered
as three stacked fragments with the emphasised word alone on the middle line.
Every word was present and in the right order. It is `space-y` now, which spaces
sibling elements and leaves text and inline markup alone, so both shapes the
prop accepts render the way they read in the source.

`design-system.test.ts` gained eight assertions, all of the same form: a fact is
stated in one place, and here is the place. Each scans every `.tsx` under `src/`
and names the offending file, so what they catch is the *next* screen restating
a decision rather than the drift that already happened. All eight were confirmed
to fail against the code they replaced before being kept. 276 tests pass; lint,
build, and the greyscale check are clean, and no screen scrolls the body
sideways at 1280, 1024, 768, or 390px.

### What step 12 landed

The old landing was six sentences, one per viewport, pinned so that scrolling
replaced one with the next. §9 named it as one of the three things that read as
generated, and the diagnosis there — substance, not spacing — was right but
incomplete. By the time this replaced it, **two of those six sentences had also
gone stale**: the roadmap entry still said "No smart account is deployed yet:
refusal is proven by this repository's evaluator, not by an on-chain policy
contract", months after the hashes at the top of this file reached a ledger. A
page with six sentences on it has nowhere for a fact to be checked against, and
so nothing catches one going out of date.

That is the actual argument for the rebuild, and it is why every claim on the
new page is *read from a file* rather than written into the page:

- **The mechanism, worked.** Three steps, then the same three steps with
  hashes: the live-ingested transaction, the cap derived from it, and the rule
  installed on chain. The first of those was recorded only in this README's
  prose, so it moved into `deployments/testnet.json` as `liveDerivation` and
  the page reads it. **The seam is stated on the page**: those are two runs,
  not one pass — ingest-to-install in a single pass needs a browser signer,
  which does not exist. Laid out as steps 01–03 they read as a pipeline unless
  the page says otherwise, and "derived from a live transaction and installed
  on chain" is exactly the sentence a reviewer would be right to check. The
  disclaimer lives in the deployments file beside the hash it qualifies, not in
  the JSX, so deleting it is not a one-line edit with nothing else to notice.
- **The deny table is now the network's.** Six axes, six hashes, the expiry row
  still saying that only its simulation error is attributable. This is the
  change with a consequence elsewhere: the README caveat naming `/` and
  `/app/simulator` as locally adjudicated was **true when written and is now
  false about half of what it names**, so it was rescoped — and a second
  assertion was added for the other direction, because a caveat that keeps
  naming a screen which no longer needs it errs modestly, which is how it
  survives review.
- **Numbers, generated.** `scripts/evidence.mjs` runs the three suites and
  derives every chain figure from the deployments file; `npm run evidence:check`
  is a CI step that regenerates and fails on drift. `onLedger` and
  `errorDecodedOnLedger` are separate fields rather than one headline, because
  "the network refused it" and "the network refused it with this code" are
  different claims and the expiry axis is the difference. The file carries no
  timestamp: one would change every run, `--check` would fail on a clean tree,
  and the fix would be committing a regenerated file on every push — which
  trains everyone to regenerate without reading.

**The freshness check is not the same thing as a correctness check**, and
conflating them was a real trap here. `--check` compares the generator against
itself, so a wrong definition of "transactions recorded" would pass forever.
`evidence.test.ts` re-derives every chain figure by a deliberately different
route — a text match a reviewer can reproduce with `grep`, a hand-listed set of
install keys — and asserts the two agree. It caught the first one immediately:
`/installTx$/` is case-sensitive, it missed `liveRuleInstallTx` and
`shortRuleInstallTx`, and it reported two installs instead of four **with no
sign it had missed any**. A derived number that is confidently wrong is worse
than a typed one, because nobody re-checks a number that has a generator.

The landing also stopped being exempt from the design system. It had its own
type scale (`.entry-h` at up to 52px, `.entry-p`, `.pin-stack`, a fixed
sequence counter), its own width, and an explicit exemption in
`design-system.test.ts`. All of it is gone: the page is `.screen`, `Section`,
`.measure`, the column tokens and `RefusedTable` — the same components the
screens it links to use — and the exemption was deleted rather than narrowed.
Two classes survive, `.wordmark` and one heading a step above the app's 26px
`h1`, because the landing does legitimately open louder. `.eyebrow-lead` moved
the other way, out of the landing block into the app's type scale, since
`ScreenHeader` has used it on every screen since step 11; it lost its viewport
clamp on the way, because app chrome does not scale with the viewport and the
status labels beside it never did.

Deleting the landing left `PolicyReview`, `DerivedSection` and `InstallSection`
with no callers — the landing had kept a second copy of the demo that step 10
moved to `/app/simulator` — so they went too. The page is a server component
now with one client island for the waitlist button; the previous one shipped
every word of itself to the browser as JavaScript because one button in its
header owned some state.

Two defects found by looking at the rendered page rather than the source, both
invisible in review. An `Address` is a button carrying its own hover padding,
so a comma set directly after one lands a space away from the value and reads
as a floating comma — em dashes, which want the space anyway, do not. And
`.col-head` sets `white-space: nowrap`, which is correct for a column head and
wrong for a stat tile's label: nothing there is in a column, and `DENY AXES
REFUSED ON-LEDGER` has to be allowed two lines in a narrow tile.

292 tests pass (up from 276; the suites the landing needed account for the
difference). Lint, build, and the audit gate are clean, the deny table still
reads correctly in full greyscale, and no page scrolls the body sideways at
1280, 1024, 768, or 390px — measured across `/`, `/docs` and `/app/simulator`,
with elements inside a scroll container excluded so the check does not pass by
counting a table that is supposed to scroll.

### What step 7 landed

The rule the whole layer is built on: **the chain is the source of truth for
what is installed, and the browser stores only what the chain does not know.**

`packages/chain/src/read.ts` reads context rules, their signers and policies,
and the spending limit each policy currently holds — all by simulation, so a
read costs no fee and needs no signature and account state can be shown to
someone who cannot sign for it. `spentInWindow` is the policy contract's own
running total rather than a number re-derived here from event history;
re-deriving it would mean reimplementing the contract's eviction rule in
TypeScript and quietly disagreeing with it at the edges.

`apps/web/src/lib/store.ts` holds two things and refuses to hold a third:
which smart accounts this browser has seen, and the derivation provenance for
each installed policy — the observed transaction, the synthesis options, and
`validFromLedger`, which has no on-chain counterpart and exists nowhere else.
It stores nothing about caps, spend, or liveness, and a test asserts the
serialized form contains none of those words. A corrupt or future-versioned
record is discarded rather than migrated, and a failed write returns `false`
rather than presenting itself as saved.

Reading the live account found a decoding bug the unit tests could not have:
`ContextRuleType::Default` arrives as a one-element vec, not a bare string, so
the account's own Default rule was being labelled `CreateContract`. The decoder
now matches variants exhaustively and throws on an unknown one rather than
reporting whichever branch happened to be last.

Verified against the deployed account at ledger 3,936,227 — six rules, with
rule 3 correctly reported expired and rules 1 and 5 correctly reporting their
caps fully spent by the walkthrough runs.

---

## 11. Verification

Everything the brief lists, plus what this plan adds:

- Existing 130 tests (53 core + 77 web) still pass. Lint, build, audit gate,
  and the two-sided bundle-fence grep stay green. `packages/chain` adds its
  own suite; the bundle fence extends to assert no agent key material and no
  chain secret reaches the client bundle.
- Four testnet hashes in the README: deployed smart account, installed policy,
  permitted transaction, network-rejected transaction. Each with an explorer
  link, each human-verified rather than only produced by a suite — matching how
  the current README treats its worked example.
- The per-axis refusal survey from step 5, published as a table, including the
  axes that are simulation-only. An axis that cannot produce a hash is listed
  as such, not omitted.
- The full flow completes twice from a clean browser, the second run cold.
- Nothing claims to be on-chain that is computed locally. The new
  `REFUSED AT SIMULATION` label exists precisely so the refusal screen does not
  have to blur this to look complete.
- `packages/core` is unchanged. `git diff --stat packages/core` is empty at the
  end of this plan; if it is not, the synthesizer stopped being the only thing
  that produces policy.

---

## 12. What v3 will still not do

Written now, so the README's "Not done yet" section can be updated from it
rather than rediscovered.

- **Mainnet.** Not in scope, and the testnet throw in the signer stays.
- **Multi-contract flows.** Router-plus-token proposals lower to a refusal
  (§2.2). Only single-token transfer flows install. This is the largest gap
  between this plan and the brief's implied scope.
- **Function allowlists beyond `transfer`.** No audited primitive exists. Would
  require Limen-authored Rust, which is out of scope by rule.
- **`validFromLedger` on-chain.** No counterpart exists; it stays local
  provenance (§2.3).
- **Rust policy codegen, MCP server, multi-user, team features.** Unchanged.
- **Reproducible contract builds.** Hashes are recorded and rebuildable;
  byte-reproducibility is not claimed.
- **Activity beyond the RPC event retention window.** Not recoverable, and
  labelled as such rather than shown as empty.
- **The 23 low-severity `elliptic` advisories.** Unchanged; still unfixable at
  the dependency level. If the delegated-signer path is dropped in favour of
  passkey-only, dropping `@creit.tech/stellar-wallets-kit` would clear all 23 —
  worth noting as a side benefit, not as a reason to decide.

---

## Open questions for you

Three, and only the first changes what I build first.

1. **Multi-contract flows lower to a refusal (§2.2).** I think that is the
   right call — it is the "accurate or absent" rule applied to installation,
   and refusing loudly is more valuable than installing something broader than
   what was derived. But it narrows the demo to single-token transfers. Accept,
   or do you want the swap case handled some other way?

2. **Passkey-only, or passkey plus delegated fallback (§5).** Delegated is
   meaningfully more work for a path most reviewers will not use, and dropping
   the wallet kit would clear every outstanding audit advisory. My inclination
   is passkey-first, delegated only if step 3 makes it cheap.

3. **IBM Plex, or the Atkinson Hyperlegible pairing (§9).** Both satisfy the
   brief. Plex reads more like an instrument; Atkinson satisfies the
   accessibility constraint by construction. I lean Plex.
