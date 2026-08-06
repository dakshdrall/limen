# Limen

[![CI](https://github.com/dakshdrall/limen/actions/workflows/ci.yml/badge.svg)](https://github.com/dakshdrall/limen/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**The permission layer for agentic money on Stellar.**

A user performs a transaction once. Limen derives the minimum OpenZeppelin
smart-account context rule and policy set that permits exactly that flow — and
refuses everything adjacent to it. The user reviews it in plain English and
installs it on their smart account. An agent then operates inside that boundary
and never holds a key.

---

## The thing this proves

`/app/simulator` shows a transaction that was performed, the policy Limen
derived from it, and **a table of adjacent transactions the policy now
refuses** — a larger amount, a different asset, an extra function call, a
different contract, an appended invocation, an expired window.

That deny table is the product. Each row changes exactly one dimension of the
observed transaction, so a `PERMIT` anywhere in the table names the single
over-permissive dimension of the derived policy. The rows are produced by
`generateDenyCases` and adjudicated by `evaluate` — the same functions the test
suite runs, executing in the browser.

The same six axes, adjudicated by the network instead, are the landing page and
`/app/policies/[id]`. Those rows carry transaction hashes; the ones above do
not, and the difference between the two is the subject of half the caveats in
this file.

### The boundary is now enforced by the network, not only by our evaluator

A smart account is deployed on testnet, a derived boundary is installed on it,
and an agent holding its own key operates inside it. Four hashes, all checkable
in an explorer:

| | |
|---|---|
| Smart account deployed | [`d9e735f3…`](https://stellar.expert/explorer/testnet/tx/d9e735f3ac9d58f17c405d0cee2b21042592e947fe349651d8d5d76c6e76dc8a) → [`CBNPFNPW…`](https://stellar.expert/explorer/testnet/contract/CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V) |
| Policy installed | [`173bcdef…`](https://stellar.expert/explorer/testnet/tx/173bcdef575913366e7e2d52cdefdba29d238084916f965f31caa383f21c6702) |
| Permitted transaction | [`59cfaf37…`](https://stellar.expert/explorer/testnet/tx/59cfaf3718fbe19887b9efb19a2284de4d6f85090506a132aff26d29a37841e9) |
| **Network-rejected transaction** | [`c4fff69b…`](https://stellar.expert/explorer/testnet/tx/c4fff69b5aedfc89d696e99cb90fdc435ae4c7a8e0eda817f49ab681826f004b) — `SpendingLimitExceeded#3221` |

The rejection is the OpenZeppelin `spending_limit` policy refusing inside
`__check_auth`, in a ledger, with fees burned. Not our evaluator's verdict.

**All six deny axes are refused on-chain**, each with its own failed transaction:

| Axis | The attempt | Contract error |
|---|---|---|
| `amount` | transfer above the cap | [`SpendingLimitExceeded#3221`](https://stellar.expert/explorer/testnet/tx/ac4775493a581f2ddc8b72c54bebf1e8ba9e09ba33be5aa4e48e9f7fb0117a77) |
| `function` | `approve` on the permitted token | [`NotAllowed#3223`](https://stellar.expert/explorer/testnet/tx/45a0eb2002ac8002d4abe3206979887ba189614794748cb30d2365b0b8c21f58) |
| `asset` | transfer of a different token | [`UnvalidatedContext#3002`](https://stellar.expert/explorer/testnet/tx/1312be89cf3b659e825071253be2972ce1aa9167afb65eca5d0d8f785ec64880) |
| `contract` | a call to a different contract | [`UnvalidatedContext#3002`](https://stellar.expert/explorer/testnet/tx/6b7f4dedfd0e563da16e9510b09cfe2a035e2f340ed8f238c428561ace1c9389) |
| `invocation` | an appended second invocation | [`ContextRuleIdsLengthMismatch#3014`](https://stellar.expert/explorer/testnet/tx/e365e6819908a8567cec5afba2a203274df8591f895e34ea21405af202867149) |
| `expiry` | the same call after `valid_until` | [`UnvalidatedContext#3002`](https://stellar.expert/explorer/testnet/tx/f5ebce5170494ddd40eb73096cceaa32de4b287ec9b08bb9d1e53b7e1a848405) — see note below |

One honest caveat on the last row: that transaction failed on-ledger, but the
survey run did not recover a contract error code from its diagnostic events, so
only the simulation error is attributed to it. It is recorded as it happened
rather than filled in from the simulation.

**A failure is not a refusal until its error code says so.** The first
over-limit submission returned `FAILED` and was nearly recorded as proof; it was
`resourceLimitExceeded`, because the footprint came from a recording-mode
simulation that never runs `__check_auth` and therefore never reaches the
policy. Every submission is now simulated a second time with the signed auth
entry attached, and every failure is decoded to a contract error code before it
is called a refusal — see `isBoundaryRefusal` in `packages/chain/src/errors.ts`.

Full record, including the WASM hashes and the OpenZeppelin tag they were built
from: [`packages/chain/deployments/testnet.json`](./packages/chain/deployments/testnet.json).

### Deriving from a live transaction

The derivation pipeline runs against live testnet too, not only against shipped
fixtures. A worked example, checkable in an explorer rather than taken on trust:
[`525d5cf0…fb97a35e`](https://stellar.expert/explorer/testnet/tx/525d5cf00e92097dddc2706514371acd1f305c4f4f803689fc477289fb97a35e)
is a real Soroban SAC `transfer` of 1000000 stroops, performed by step 1 of the
simulator in ledger 3929381, read back through RPC, and turned into a policy
whose derived spending cap is that same 1000000 — the boundary is exactly the
observed flow, which is the claim.

That run was **driven by hand through the UI, by a person, not by the test
suite**: every step completed in one pass in a real browser. An automated suite
covers the same walkthrough on demand (see [the end-to-end
suite](#the-end-to-end-suite)), but this hash is the human-verified one. It was
performed at `/demo`, which is now `/app/simulator`; the path redirects.

---

## Running it

```bash
npm ci
npm run build      # builds @limen/core, then the web app
npm test           # the deny-case harness, then extraction and route tests
npm run dev        # http://localhost:3000
```

No credentials are required. The app ships JSON fixtures and loads one by
default, so the whole pipeline — ingest → synthesize → deny table → install
payload — runs with no RPC access and no API key.

### The screens

- **`/`** — the argument, with the hashes that back it: the mechanism worked
  through one live-ingested transaction and the rule installed from it, the six
  refusals the network produced against that boundary, and counts generated
  from the test run rather than typed. Static, and it holds no interactive demo
  — that moved to `/app/simulator` in step 10, and step 12 stopped the landing
  keeping a second copy of it.
- **`/app/accounts`** — smart accounts this browser has been shown, and for each
  one the boundary currently installed on it, read from the chain at a stated
  ledger. Not restored from browser storage.
- **`/app/policies/new`** — observe a transaction, review the boundary derived
  from it, and see it lowered onto OpenZeppelin primitives or refused with the
  constraint named. It stops short of installing, and says why in place of a
  button.
- **`/app/policies/[id]`** — the refusal screen: a permitted transaction beside
  the attempts the network refused, each with its hash. This is the product.
- **`/app/activity`** — contract events across accounts, with the ledger range
  actually scanned printed beside them.
- **`/app/simulator`** — the guided walkthrough, six steps, formerly `/demo`
  (the old path redirects). Performs a real testnet transaction for you or
  starts from a shipped flow, derives the boundary, tries to exceed it, and then
  asks whether an OpenZeppelin account could hold it at all. Each step states
  whether what happened was **on-chain**, a **shipped fixture**, or **computed
  locally**; the three are never blurred.
- **`/docs`** — how to point an agent at an installed policy: who holds which
  key, what the owner installs, what the agent signs, and what the network does
  when it tries to exceed the boundary.

### Optional configuration

| Variable | Effect when unset |
|---|---|
| `SOROBAN_RPC_URL` | Live testnet ingest is unavailable and the hash input is disabled with the reason on screen; fixtures still work. It never silently substitutes a fixture for the transaction you asked for. Server-side only — never exposed to the browser. |
| `LIMEN_DEMO_SECRET` | Step 1 of the simulator cannot submit, and the walkthrough starts from a shipped flow instead — which it can also do at any time with the account configured. Testnet seed for the disposable demo account. Server-side only. |
| `LIMEN_DEMO_DESTINATION` | As above. The fixed account the demo transfer is sent to. |
| `ANTHROPIC_API_KEY` | The plain-English explanation is skipped and the raw structured rationale is shown instead. The deny table is unaffected. |
| `NEXT_PUBLIC_SMART_ACCOUNT_ID` | Install renders the exact payload that would be submitted, with signing disabled. |
| `WAITLIST_STORE_PATH` | Waitlist entries are written to a JSON file in the system temp directory, which a serverless host erases when the instance recycles. Set it to somewhere durable. `TODO(roadmap)`: a real backend. |
| `NEXT_PUBLIC_SITE_URL` | OG and Twitter card URLs resolve against Vercel's production hostname, or `http://localhost:3000` outside it. |

### The numbers on the landing page

```bash
npm run evidence         # regenerate apps/web/src/generated/evidence.json
npm run evidence:check   # fail if the committed copy has drifted
```

The landing page states counts — tests passing, testnet transactions recorded,
deny axes refused on-ledger, context rules installed, Rust files in this
repository. None of them is typed. `scripts/evidence.mjs` runs the three suites
and reads `packages/chain/deployments/testnet.json`, and `evidence:check` is a
CI step that regenerates and compares, so adding a test without regenerating is
a red build rather than a page that quietly understates itself.

That check proves freshness and nothing else — a generator with a wrong
definition of "transactions recorded" would agree with itself forever. So
`apps/web/test/evidence.test.ts` re-derives each chain figure independently,
deliberately by a different route than the generator uses, and asserts the two
agree. The same argument that keeps `evaluate` separate from `synthesize`.

The file carries no timestamp, on purpose: one would change on every run, so
`evidence:check` would fail on a clean tree and the only way to stay green
would be committing a regenerated file on every push — which trains everyone to
regenerate without reading, which is exactly how a wrong number gets through.

### The end-to-end suite

```bash
npm run build
npm run e2e -w @limen/web
```

Drives `/app/simulator` in a real Chromium against live testnet: performs a transaction,
observes it back through RPC, derives the boundary, tries to exceed it, reads
the payload — then reloads the tab and asserts the walkthrough resumes by
recomputing from the stored hash rather than restoring a stored answer. It
starts its own `next start` on every invocation, so a second run is a cold
process with empty rate-limit windows and an empty transaction cache.

It needs `SOROBAN_RPC_URL`, `LIMEN_DEMO_SECRET`, and `LIMEN_DEMO_DESTINATION`,
and it is deliberately **not** part of `npm test` or the CI job. Every run
submits a real transaction, and `/api/demo/perform` allows one per address per
five minutes — a per-push gate would spend testnet funds on every commit and go
red on the second push of the hour. A gate that flakes is a gate people learn
to ignore. CI does still type-check the suite, since it sits inside the web
app's `tsconfig` include, so it cannot rot silently.

---

## Design rules

These are constraints on the implementation, not aspirations. Each one is
load-bearing.

**1. The synthesizer is deterministic.** The same transaction produces a
byte-identical proposal every time — no clock, no randomness, no locale-
dependent sorting, no model. Claude has exactly two jobs: asking the user a
clarifying question about intent, and explaining the finished proposal in plain
English. Its answers become *arguments* to the synthesizer, never its output.
There is no LLM anywhere in the path that produces authorization logic.

**2. Composition only.** Every policy emitted is a configuration of an existing
audited OpenZeppelin primitive. No Rust is generated, and none is written by
hand either. If a constraint cannot be expressed by composing those,
`synthesize` throws with the constraint named rather than guessing. Future
codegen is gated behind a `compositionOnly: false` flag that is never set.

This rule now has teeth at install time as well as at derivation time.
`lower` refuses a proposal it cannot install using only audited primitives, and
`lower` refuses outright to lower anything with `compositionOnly: false`. The
temptation this resists is concrete: a ~80-line Rust function-allowlist policy
would close the multi-contract gap tomorrow. It would also be unaudited code in
the authorization path, which is the one place this project has said it will not
put any.

**3. Limen custodies nothing of yours.** No *user's* secret key reaches a Limen
server, an environment variable, or a log line. Signing is client-side only.

This rule was narrowed in v4, and the narrowing is stated rather than absorbed.
It used to forbid a user secret reaching browser storage at all. It no longer
can: creating and using an account from the browser means a key in the browser.
So — a disposable testnet ed25519 keypair is generated in the page and kept in
browser storage, labelled `TESTNET ONLY · LOCAL KEY` wherever it is created or
used. It is not a wallet, it never leaves the browser, and clearing site data
destroys it — along with the account it owns, which is stated at creation rather
than discovered later.

There is no export, no backup, and no import field, and there will not be one.
Offering a backup would create the exact thing this rule exists to prevent — a
user secret in transit through a form — in exchange for protecting an account
holding testnet dust that friendbot replaces for free. `apps/web/test/local-key-label.test.ts`
fails the build if any file that generates, stores, or imports a key stops
carrying the label, and CI greps the built client bundle for a 56-character
`S…` StrKey so that a pasted or serialized secret is caught without anyone
needing to know its value.

Two kinds of key can therefore move funds here, and **neither of them is
Limen's to hold**:

- **Yours**, the local key above. It can move the testnet funds in the account
  it owns, because that is what it is for. It is generated in your browser and
  exists nowhere else.
- **This project's own**, `apps/web/src/lib/demo-signer.ts`, which signs the
  guided demo's first step with a disposable testnet account we own. It is
  fenced four ways — see [The demo account](#the-demo-account) — and it can
  never touch a user's key, because it only ever holds its own.

There is no code path in this repository that gives Limen custody of a user's
key, and no server-side signer for a user's account.

**4. `evaluate` is an independent implementation of `synthesize`.** The two
share no code path and no helper — the outflow summation is deliberately written
twice. A synthesizer that is confidently wrong must not be able to agree with
itself in the tests. `evaluate.ts` carries a header comment saying so, because
deduplicating it would look like a cleanup and would silently delete the
guarantee.

**5. Integer math only.** All amounts are stringified integers in the asset's
smallest unit, handled as `bigint`. No `number`, no float, no rounded cap.
Headroom is expressed in integer basis points rather than as a multiplier for
exactly this reason; the cap is computed as
`outflow * BigInt(headroomBps) / 10_000n`, and integer truncation rounds it
*down*.

**6. Bias toward less permission, always.** Two functions observed means two
functions permitted. Default headroom is exactly `1.0` — the cap equals the
observed outflow, not a rounded-up guess. Widening is opt-in and requires an
explicit user selection; nothing Claude proposes is ever applied silently.

### Two decisions worth calling out

**The cap is gross outflow, never netted against inflows.** A transaction that
sends 1000 USDC out and receives 1000 USDC back has spent 1000, not 0. Netting
would let a round trip hide spend — the pair would consume none of the cap and
could repeat without bound. This is covered by a dedicated test that fails
loudly if anyone ever "optimizes" the summation into a balance delta.

**A spending window may not exceed the context rule's lifetime.** Otherwise the
rule expires before the window rolls, and the "rolling" cap is really a one-shot
lifetime allowance wearing a costume. `synthesize` throws instead.

**Ingest is accurate or absent, never quietly narrowed.** If a transaction
contains a token transfer the extractor cannot fully read, ingest fails and
names the field it could not read. It does not record the transfers it managed
to parse and drop the one it did not — that would under-derive the cap, which
*sounds* conservative and is actually worse: every number on the page would then
describe a flow that never happened. A wrong `ObservedTransaction` produces a
wrong policy, so the only acceptable outcomes are correct or refused.

**Movements are attributed only as far as the chain says.** Soroban contract
events name the token contract that emitted them, not the invocation that caused
them. With one invocation, attribution is exact. With more, `ObservedTransaction`
carries `attribution: 'transaction-level'` and the UI says the metadata does not
say which call caused what, rather than drawing every movement under the first
call. No derived value depends on this either way — `synthesize` sums outflow
across the whole transaction — which is precisely why representing the
uncertainty costs nothing and asserting a guess would have cost the truth.

**Refusal is a rendered result, not an error.** When synthesis exceeds the
five-policy limit, or a constraint cannot be composed from audited primitives,
the page shows what was attempted, why Limen refused, and what it specifically
did *not* do — approximate, drop a constraint, or widen a cap to fit. The
`over-limit` preset exists to demonstrate this on demand. A system that can only
be seen succeeding gives you no evidence about when it declines.

### Why there is no wallet button

Connecting Freighter or xBull as the owner of a smart account was planned, and
was dropped on a measurement rather than on effort. The finding is recorded here
because "we did not get to it" and "we tried it and the platform does not
support it" are different statements, and only one of them is true.

A wallet cannot be an `External` signer: `External` verification hands raw bytes
to a verifier contract, and wallets sign envelopes and auth entries, not
arbitrary 32-byte digests. So a wallet can only be `Delegated`, which resolves
inside `__check_auth` as:

```rust
// packages/accounts/src/smart_account/storage.rs:353
Signer::Delegated(addr) => {
    let args = (auth_digest.clone(),).into_val(e);
    addr.require_auth_for_args(args)
}
```

That raises a **nested** authorization requirement from inside `__check_auth`.
Recording-mode simulation never runs `__check_auth`, so the requirement never
appears in `simulateTransaction`'s `result.auth`. The remaining hope was the
second, *enforcing* simulation, which does run it — and that was the experiment,
run against a throwaway `Delegated`-owned account on testnet
(`node packages/chain/scripts/acceptance.mjs f4`):

```
escalating error to VM trap from failed host function call: require_auth_for_args
["Unauthorized function call for address", GBWSU5Z62RFSMLWHQYJPIB5XDHBN66FFH4TIOQZLWFP535GVA2EH2WOQ]
HostError: Error(Auth, InvalidAction)   — no contract error code
```

`require_auth_for_args` is reached and the host refuses it for want of a
matching entry. The simulation **fails** rather than reporting what it wanted:
no `result.auth` comes back, and a failed simulation hands a wallet nothing to
sign. Discovery-by-simulation is unavailable on *both* simulations.

The script keeps a control case alongside it, because the first version of the
experiment asked the wrong question and got a confident answer to it. A payload
with an empty `signers` map fails `UnvalidatedContext#3002` — inside
`__check_auth`, but *before* the `Delegated` branch runs. That looks identical
at a glance to "nested auth cannot be discovered" and is nothing of the kind.
It is kept so the real result cannot be misread the same way twice.

What remains is hand-constructing the entry. It is not impossible — the failure
names exactly what is missing, and `auth_digest` is already computed
client-side. It is unverifiable: there is no simulation to check the invocation
tree against, so a mistake is discovered only by spending a submission.

The fallback — connect a wallet for identity and fees while the browser key
stays the actual owner — was also declined. Someone who connects a wallet has
told you what they believe is about to happen, and a caption correcting them is
worse than never offering the button. So the owner is this browser's disposable
key, the screen says which key owns the account at the moment it is created, and
there is no wallet button to misread.

The full finding, including what it costs, is in [`PLAN-V4.md`](./PLAN-V4.md)
under F4.

---

## The demo account

Step 1 of the simulator submits a real transaction to Stellar testnet so a reviewer
with no wallet can still complete the walkthrough. That account is **disposable
and holds trivial funds; its compromise is uninteresting by design.**

The signer is fenced four ways, and the fourth is the only one that is proof
rather than intent:

1. **`import 'server-only'`** — importing it from a Client Component is a build
   error, not a runtime one.
2. **A hard `throw` on any non-testnet network passphrase.** Not a config flag,
   not a default, not a warning. No value of any environment variable produces a
   mainnet signer from that module.
3. **It signs only a transaction it built itself**, from a fixed template.
   `performDemoTransfer()` takes no arguments, so nothing a request contains can
   influence the destination, the asset, or the amount. There is no
   "sign this XDR" entry point.
4. **CI greps the built client bundle** and fails if the signer's sentinel or
   the name of its secret appears there. The check is two-sided: it first
   asserts the sentinel *is* present in the server bundle, because a grep that
   can never match would pass forever while proving nothing.

The account is rate-limited per address and under a global ceiling, and
submissions are serialized so concurrent reviewers cannot collide on its
sequence number.

The transfer is a Stellar Asset Contract invocation rather than a classic
payment, because a classic payment emits no contract invocations — the extractor
would correctly refuse it, and step 2 would fail on step 1's own output.

---

## Layout

```
packages/core/      @limen/core — dependency-free, no network IO, no DOM
  types.ts          domain model
  synthesize.ts     deterministic derivation
  evaluate.ts       independent adjudication
  denycases.ts      single-axis mutations
packages/chain/     @limen/chain — everything that touches the network
  lower.ts          PolicyProposal -> InstallPlan; refuses what it cannot enforce
  plan.ts           plan types and the OpenZeppelin limits they respect
  authpayload.ts    the AuthPayload __check_auth expects, and the auth digest
  errors.ts         contract error tables; is this a refusal or a resource failure
  wasm/manifest.json  the OZ tag, build command, and four WASM hashes
  deployments/      recorded testnet addresses and transaction hashes
  scripts/          the testnet scripts behind those hashes
apps/web/           Next.js 16, App Router, TypeScript, Tailwind
  src/app/api/ingest/          tx hash -> ObservedTransaction (nodejs runtime)
  src/app/api/explain/         Claude: structured rationale -> plain English
  src/app/api/install-preview/ proposal -> Soroban ScVal XDR
  src/app/api/demo/perform/    submits the guided demo's testnet transaction
  src/app/page.tsx             the landing: mechanism, refusals, numbers
  src/app/app/simulator/       the six-step guided walkthrough
  src/app/docs/page.tsx        pointing an agent at an installed policy
  src/generated/evidence.json  the landing's counts; written by scripts/evidence.mjs
  src/lib/extract.ts           XDR -> domain model; accurate or absent
  src/lib/demo-signer.ts       the only signer in the repo; testnet-fenced
  src/fixtures/                shipped JSON transactions
  test/                        extraction, ingest refusals, the signer fence
```

`packages/core` is free of Next.js and browser globals so a future MCP server
can import it directly. It has no dependency on `packages/chain`, and the
dependency never runs the other way: the synthesizer is the only thing that
produces policy, and lowering it onto someone else's primitives must never be
able to reach back and change what was derived.

`lower.ts` is pure — no SDK, no network, no clock — for the same reason
`synthesize` is: it can then be tested exhaustively without either.

### Reproducing the chain layer

The four contract WASMs come from
[`OpenZeppelin/stellar-contracts`](https://github.com/OpenZeppelin/stellar-contracts)
at the tag pinned in `packages/chain/src/wasm/manifest.json`. Limen writes no
Rust; the build is a one-time step whose output is recorded by hash, not
committed:

```bash
git clone --depth 1 --branch v0.7.2 https://github.com/OpenZeppelin/stellar-contracts
cd stellar-contracts
stellar contract build --package multisig-account-example
stellar contract build --package multisig-ed25519-verifier-example
stellar contract build --package multisig-webauthn-verifier-example
stellar contract build --package multisig-spending-limit-policy-example
```

Byte-for-byte reproducibility across toolchains is **not** claimed and has not
been tested. The manifest records the `stellar` CLI and `rustc` versions the
recorded hashes were produced with; rebuild and compare if it matters to you.

To re-run the walkthrough against testnet:

```bash
npm run build:chain
LIMEN_DEPLOYER_SECRET=S... LIMEN_OWNER_SECRET=S... LIMEN_AGENT_SECRET=S... \
  node packages/chain/scripts/testnet.mjs walkthrough
```

It installs a fresh context rule, submits an over-limit transfer, and then
submits the permitted one, printing all three hashes. Like the e2e suite, it is
deliberately not in CI: every run spends testnet funds.

The agent's secret is a **separate key from the owner's**, and that separation
is the claim. Limen does not assert that an agent holds no key — it asserts that
the key an agent holds cannot exceed the installed boundary, which is what the
rejected transaction above demonstrates.

---

## Not done yet

An honest list. None of the following is implemented, and the demo does not
pretend otherwise.

- **Your account is stranded if you clear your browser.** The owner key is
  generated in the page and stored there, and there is deliberately no export
  and no recovery — see [design rule 3](#design-rules). Clearing site data
  destroys the key and with it the ability to sign for the account it owns. The
  account and everything installed on it stay on chain and stay readable by
  anyone; nobody can act on them again. This is stated at creation rather than
  discovered later, and it is an acceptable trade only because these are
  disposable testnet accounts.

  This replaces the caveat that stood here through v3 — *"nothing in the app can
  sign, so nothing in the app can install"*. That is retired in v4: deploy,
  install, the agent's permitted and refused calls, and revoke are all built as
  browser code paths, signed client-side by a key that never leaves it. The
  retirement is pinned in both directions by `apps/web/test/caveats.test.ts`,
  because a caveat that outlives its reason understates the work and that is its
  own kind of inaccuracy. See [`PLAN-V4.md`](./PLAN-V4.md) for what is built and
  what is not.
- **The browser write path has never signed a transaction in a browser.** It is
  implemented and it is not yet demonstrated, and those are different claims.
  Every hash recorded in `packages/chain/deployments/testnet.json` was produced
  by a Node script — `scripts/testnet.mjs` or `scripts/acceptance.mjs` — which
  is exactly what the browser path exists to stop being the only thing that has
  ever done it. The acceptance test in [`PLAN-V4.md`](./PLAN-V4.md) §11 calls for
  two completions from a clean browser profile, the second cold, with every hash
  confirmed against Horizon from outside the process that produced it. **Those
  runs have not happened**: the attempt was blocked by port forwarding on the
  reviewing machine, not by anything in this repository, and it is recorded as
  unrun rather than waived. There is no `browserRun` block in the deployments
  file for the same reason — a record of a run that did not happen is the one
  thing that file must never hold. Until the runs land, read the paragraph above
  as what the code does, not as something that has been shown to work.
- **On `/app/simulator`, the deny table proves refusal as adjudicated by this
  repository's evaluator, not as enforced on-chain.** That screen runs
  `evaluate` in the browser. `evaluate` is an independent implementation of the
  same rules, which is a real check against a wrong synthesizer — it is not the
  OpenZeppelin contract. Do not read its DENY rows as network refusals; the
  ones with transaction hashes above are the network's. The refusal screen at
  `/app/policies/[id]` renders those hashes and nothing else: no locally
  adjudicated row appears on it, precisely so the two cannot be confused.

  Rescoped in v3 step 12. This named `/` as well, and correctly: the landing
  ran the same local deny table. The rebuilt landing shows the recorded testnet
  survey instead — six network refusals with six hashes — so the screen that
  used to need this caveat now carries the opposite claim, and leaving its name
  in the list would understate it. Both directions of this sentence are pinned
  by `apps/web/test/caveats.test.ts`, so neither a new screen nor a moved one
  can widen or narrow it quietly.
- **Only single-token transfer flows can be installed.** OpenZeppelin ships
  three policies — `simple_threshold`, `weighted_threshold`, `spending_limit` —
  and none of them is a function allowlist. A `['transfer']` allowlist needs no
  allowlist policy, because `spending_limit::enforce` panics `NotAllowed` for
  every other function name; that subsumption is asserted explicitly in
  `packages/chain/src/lower.ts` and confirmed on testnet. **Any other function
  set, and any contract with no spending limit to constrain it, refuses to
  install** and names the constraint. A router call beside a token transfer is
  the common case that refuses: a context rule with no policy would permit every
  function on that router, which is broader than what was derived and reviewed.
  Those flows stay in the simulator, evaluated locally, marked not installable —
  the `swap-two-calls` preset at `/app/simulator` is one, and step 6 of that
  screen names the constraint rather than omitting the flow. Closing that gap
  needs a policy contract nobody has audited, so it is the trigger for the
  codegen work rather than a reason to write Rust now.
- **`validFromLedger` is not installed.** An OpenZeppelin `ContextRule` has
  `valid_until` and no lower bound. The field stays in the domain model as
  provenance — the ledger the policy was derived from — is labelled as computed
  locally, and is never rendered inside an on-chain rule block.
- **Live RPC ingest has not met the long tail of real transactions.** The
  extraction path is implemented, and its refusal behaviour is covered by tests
  built on constructed Soroban metadata — a readable transfer, a transfer with a
  non-integer amount, a missing topic, a malformed emitting contract, a good
  transfer sitting next to a bad one. Both metadata layouts are read: Soroban
  `v3`, and Protocol 23 `v4`, which moved contract events to a per-operation
  list alongside a transaction-level one for fee charges and refunds. A metadata
  version with no reader here is refused by version number rather than read as
  "classic, no events." What it has *not* seen is the breadth of
  what testnet actually contains. Every unknown shape it meets will either
  extract correctly or refuse and name the field; neither of those is silent
  corruption, but the refusal rate on real traffic is unmeasured.
- **The cache and the rate limits are process-local.** Both live in memory, so
  they reset on a cold start and do not compose across instances. They raise the
  cost of a flood rather than bounding it. This is a deliberate choice — it
  survives a Vercel cold start with no new dependency and no provisioning — not
  an oversight. `TODO(roadmap)`: a shared backing store, alongside the waitlist.
- **Fixture transactions are illustrative.** Their addresses are real
  StrKey-valid Stellar addresses, but the transactions were not observed on a
  live network. They are marked `"network": "simulated"` for that reason.
- **Only two OpenZeppelin primitives are supported** — `spending_limit` and
  function allowlists. Anything else throws rather than approximating.
- **No Rust policy codegen, no MCP server, no mainnet, no multi-account
  management, no wallet.** Each is marked with a `TODO(roadmap)` comment at the
  point where it will attach.
- ~~**`npm audit` is not clean**~~ — it is. The 23 low-severity advisories that
  stood here all reduced to a package no source file imported, and it has been
  removed. See [Dependency advisories](#dependency-advisories) for the
  accounting, including what the count was before.

---

## Dependency advisories

`npm audit --omit=dev` on production dependencies:

| | critical | high | moderate | low | total |
|---|---|---|---|---|---|
| before overrides | 1 | 10 | 6 | 19 | **36** |
| after overrides | 0 | 0 | 0 | 23 | **23** |
| after dropping the wallet kit | 0 | 0 | 0 | 0 | **0** |

The CI gate runs at `--audit-level=low`, which is the strictest npm offers. It
sat at `moderate` for as long as the third row did not exist.

### What the overrides fix

The root `package.json` pins five transitive packages:

```json
"overrides": {
  "protobufjs": "7.6.5",
  "axios":      ">=1.18.0",
  "uuid":       ">=11.1.1",
  "postcss":    ">=8.5.18",
  "sharp":      ">=0.35.0"
}
```

This cleared every critical, high, and moderate advisory — including the critical
one, arbitrary code execution in `protobufjs` (GHSA-xq3m-2v4x-88gg), which
arrived via `@trezor/*`. All five resolve within a compatible range, so nothing
is force-upgraded across a breaking major. `npm test`, `npm run lint`, and
`npm run build` all pass with them applied, and the app was smoke-tested
end-to-end afterwards.

Three of the five still bind: `axios` (pulled up from the `1.18.0` the Stellar
SDK pins), `postcss` and `sharp` (both up from what Next declares). The other
two — `protobufjs` and `uuid` — no longer have anything to act on, because the
packages that brought them in left the tree with the wallet kit. They are kept
rather than deleted: an override on an absent package costs nothing, and each is
a floor that a future dependency cannot silently drop back through.

> **Reproducing this:** npm seeds resolution from an existing `node_modules`, so
> changing dependencies on a populated tree appears to do nothing — the old
> version stays pinned and the audit count does not move.
>
> This is a workspace, so there are **four** `node_modules` directories, not one.
> Deleting the root and `package-lock.json` is not enough: the copies under
> `apps/web/`, `packages/chain/` and `packages/core/` survive and seed the
> resolve from the layout they already had. That failure is quiet and it does not
> look like a stale tree — it looks like a broken dependency. Removing the wallet
> kit and clearing only the root produced a tree in which `@stellar/stellar-sdk`
> kept its old nested position and its own declared dependency on
> `@noble/ed25519` was never installed at all, so the chain suite failed on a
> missing package that the lockfile correctly listed.
>
> ```
> rm -rf node_modules */*/node_modules package-lock.json && npm install
> ```

### Where the last 23 went

Two sections stood here: one explaining that the 23 remaining advisories could
not be fixed, and one explaining that nothing imported the package they came
from. Both are **retired**, because the condition they described is gone rather
than merely re-argued.

All 23 were low severity and all reduced to one root cause, **`elliptic`**
(GHSA-848j-6mx2-7j84). Its advisory covers `*` — every published version — so
there was no version to pin to and no override that could reach it. It arrived
through two independent paths, both unconditional dependencies of
`@creit.tech/stellar-wallets-kit`, and it was installed whether or not the HOT
Wallet and Trezor modules were used.

That package was a declared dependency of `apps/web` that **no source file ever
imported**, and once the wallet path was struck (see [Why there is no wallet
button](#why-there-is-no-wallet-button)) none ever would. So it was removed. The
count went to zero, and the audit gate's threshold moved from `moderate` to
`low`.

The distinction the retired sections drew is worth keeping even though its
occasion is gone, because it is the thing that made removal worth doing rather
than optional. Not importing `elliptic` only ever mitigated *runtime* exposure:
it was still installed on every `npm ci`, still ran its install scripts, and
still appeared in `npm audit`, SBOMs, and any supply-chain scan. Removing the
dependency is the only move that addresses the second kind, and an unimported
dependency is the one case where it costs nothing.

---

## License

MIT — see [LICENSE](./LICENSE).
