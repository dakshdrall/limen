# Limen MVP — implementation plan

Status: **approved 2026-08-01**, with three amendments folded in below
(marked **[A1]**, **[A2]**, **[A3]**). Decisions: D1 keep `src/`; D2 `tsc` build
for core; D3 no contract ID yet, XDR-preview path; D4 `validityLedgers`
defaults to 120,960 (7 days).

---

## 0. What this plan optimizes for

The deny table is the deliverable. Everything below is sequenced so that
`packages/core` + its test suite is green and demonstrable *before* a single
line of UI exists. If the schedule slips, the cut order is: install flow →
Claude explain → ingest RPC (fixtures remain) → UI polish. The deny table and
its tests are never cut.

---

## 1. Repository restructure

Current state: a single Next.js app at the repo root (`src/app`, `package.json`,
`tsconfig.json`, committed as `d23f2af`).

Target state — npm workspaces:

```
package.json              workspace root: {"workspaces": ["packages/*", "apps/*"]}
tsconfig.base.json        shared strict compiler options, target ES2022
packages/core/            @limen/core — dependency-free, no network, no DOM
  package.json            no dependencies; devDeps: typescript, vitest
  tsconfig.json
  src/{types,synthesize,evaluate,denycases,index}.ts
  test/{synthesize,evaluate,denycases}.test.ts
apps/web/                 @limen/web — the scaffolded Next app, moved here
  package.json            deps: next, react, @limen/core, @stellar/stellar-sdk,
                          @creit.tech/stellar-wallets-kit, @anthropic-ai/sdk
  next.config.ts
  src/app/...
.github/workflows/ci.yml
```

Migration is a `git mv` of the existing scaffold into `apps/web/` plus a new
root `package.json`. `LICENSE`, `.gitignore`, `README.md` stay at the root.

**D1 (resolved): keep `src/`.** Real paths are
`apps/web/src/app/api/ingest/route.ts` and `apps/web/src/app/page.tsx`.

**D2 (resolved): `tsc` build.** `packages/core` compiles to `dist/` and its
`exports` point at `dist`, keeping it consumable by a future MCP server with no
bundler. Cost is a build-ordering step (`npm run -w packages/core build` before
the web build); CI and the root `build` script handle it.

**Blocking detail:** the scaffold's `tsconfig.json` targets **ES2017**, which
rejects `bigint` literals (`10_000n`). Rule 5 is unimplementable until this is
raised. Both tsconfigs move to `target: ES2022`, `lib: ES2022`.

---

## 2. `packages/core` — the deterministic half

Zero runtime dependencies. No `fetch`, no `process`, no `window`, no `Date.now()`.
Every function is pure: same input → byte-identical output.

### 2.1 `types.ts`

Verbatim from the spec, plus two additions:

```ts
interface SynthesisOptions {
  headroomBps: number;      // integer basis points; default 10_000 === 1.0
  windowLedgers: number;    // spending-limit rolling window; default 120_960
  validityLedgers: number;  // context rule lifetime; default 120_960 (7 days)
}

interface DenyCase {
  axis: 'amount' | 'asset' | 'function' | 'contract' | 'invocation' | 'expiry';
  label: string;            // human label for the table row
  why: string;              // why a correct policy MUST refuse this
  candidate: ObservedTransaction;
}
```

**Why `headroomBps: number` and not `headroom: 1.0`.** Rule 5 forbids floats in
the amount path. A float headroom would reintroduce one at the exact moment the
cap is computed. Basis points keep the whole computation in `bigint`:

```
cap = (outflow * BigInt(headroomBps)) / 10_000n
```

Integer division truncates, which rounds the cap *down* — biased toward less
permission, satisfying rule 6. Default `10_000` gives `cap === outflow` exactly.

### 2.2 `synthesize.ts`

`synthesize(observed, options?): PolicyProposal`

1. **Validate.** Reject `compositionOnly: false` (never set in this MVP; the
   parameter exists only as the gate for future codegen, with a
   `TODO(roadmap)` marker). Reject non-integer amount strings.

   **[A3]** Reject `windowLedgers > validityLedgers`. A spending window longer
   than the context rule's lifetime is a limit that never resets inside the
   window it governs — the cap would be a one-shot lifetime allowance wearing
   the costume of a rolling limit. Throws `InvalidWindow` naming both values.
2. **Contracts.** `allowedContracts` = unique `invocation.contractId`, sorted
   lexicographically. Sorting is what makes the output byte-identical across
   runs regardless of invocation order in the source transaction.
3. **Functions.** `allowedFunctions[contractId]` = unique `functionName` per
   contract, sorted. Two functions observed → exactly two permitted.
4. **Outflow.** Per asset, sum `movement.amount` where `movement.from ===
   observed.source`. Movements *into* the source are inflows and produce no
   spending limit — a policy that caps what arrives is not a permission
   boundary. All arithmetic in `bigint`.

   **[A2] The cap is GROSS outflow per asset, never netted against inflows of
   the same asset.** Inflows are not subtracted, not at synthesis and not at
   evaluation. Netting would let a round-trip hide spend: an agent that sends
   1000 USDC out and receives 1000 USDC back nets to zero and would consume
   none of its cap, so the same policy would permit that pair an unbounded
   number of times. Gross accounting makes each outflow cost the cap
   permanently for the window. Stated in a comment at the summation in *both*
   `synthesize.ts` and `evaluate.ts`, and covered by a dedicated round-trip
   test (§2.5.7).
5. **Policies.** One `spending_limit` per asset with outflow > 0 (assets sorted);
   one `function_allowlist` per contract (contracts sorted). If the total
   exceeds 5, throw `PolicyLimitExceeded` naming the count and the OZ context-rule
   limit — never silently merge or drop.
6. **Window.** `validFromLedger = observed.ledger`,
   `validUntilLedger = observed.ledger + options.validityLedgers`.
7. **Rationale.** One structured line per derived constraint, in a fixed order,
   e.g. `cap:USDC:50000000:headroom=10000bps`,
   `fn:CBQH…:transfer`, `window:ledger 51234→51834`. These strings are the
   *input* to Claude, never its output.

If a constraint cannot be expressed as a configuration of `spending_limit` or a
function allowlist, throw with the constraint named — no guessing, no
approximation.

### 2.3 `evaluate.ts` — independent by construction

`evaluate(proposal, candidate): Decision`

Rule 4 is the load-bearing architectural constraint here. `evaluate` imports
**nothing** from `synthesize.ts` — not a type guard, not a comparator, not an
amount parser. The per-asset outflow loop is written a second time, on purpose.
A file header comment states this and says explicitly: *do not deduplicate this;
the duplication is the test's independence.* (Notably this makes `/simplify` and
most reviewers wrong about this file by default, so the comment has to be
unambiguous.)

Checks, each producing its own `reasons[]` entry:
- ledger outside `[validFromLedger, validUntilLedger]` → deny
- any `contractId` not in `allowedContracts` → deny
- any `functionName` not in `allowedFunctions[contractId]` → deny
- any asset with gross outflow and no matching `spending_limit` → deny
- any asset whose **gross** outflow exceeds its limit → deny (reason names
  asset, observed amount, and cap). **[A2]** inflows of the same asset are
  never subtracted here either
- `function_allowlist` policies re-checked independently of the context rule,
  so a proposal that disagrees with itself fails rather than passing

`permitted` is true only when `reasons` is empty.

### 2.4 `denycases.ts`

`generateDenyCases(observed, proposal): DenyCase[]` — single-axis mutations, one
dimension each, so a failure names exactly one over-permissive dimension. Six
minimum:

| axis | mutation |
|---|---|
| `amount` | first capped asset's outflow → `cap + 1n` |
| `asset` | movement asset → a synthetic address absent from all policies |
| `function` | first in-scope contract's function → `set_admin` |
| `contract` | first `contractId` → a synthetic contract absent from the rule |
| `invocation` | original flow, unchanged, plus one appended invocation |
| `expiry` | original flow, unchanged, at `validUntilLedger + 1` |

Synthetic addresses are fixed constants (no randomness, no timestamps) so the
generated cases are byte-identical across runs.

### 2.5 Tests — `vitest`

The suite asserts, per the spec:

1. the proposal permits the flow it was derived from
2. **every generated deny case is refused** — the load-bearing test. Written as
   a `test.each` over `generateDenyCases`, so a regression fails the specific
   axis and the message reads
   `over-permissive on axis "amount": policy permitted a transaction it must refuse`
   rather than a generic array-length mismatch.
3. cap === observed outflow at default headroom (`headroomBps: 10_000`)
4. headroom widens the cap and changes nothing else — asserted by deep-equality
   on the proposal with the `limit` fields stripped, so any collateral drift
   fails
5. deriving >5 policies throws
6. determinism: `JSON.stringify(synthesize(tx))` is identical across two calls
   and across a shuffled `invocations` array
7. **[A2] round-trip does not hide spend.** A transaction moving 1000 USDC out
   and 1000 USDC back in derives a cap of 1000 (gross), not 0 (net); and a
   candidate that moves `cap + 1` out while moving the same amount back in is
   **refused**. This is the test that fails loudly if anyone ever "optimizes"
   the summation into a net balance delta.
8. **[A3]** `windowLedgers > validityLedgers` throws `InvalidWindow`

---

## 3. `apps/web` — ingest

`POST /api/ingest` → `ObservedTransaction`. `export const runtime = 'nodejs'`
(the Node runtime is Next 16's default, but the export is stated explicitly
because the Stellar SDK will not run on Edge). This is the only file in the repo
that opens a socket.

- `@stellar/stellar-sdk` v16 against Soroban RPC; RPC URL server-side only
  (`SOROBAN_RPC_URL`, never `NEXT_PUBLIC_`).
- Extracts contract invocations and token movements from transaction meta.
- **Fixtures.** JSON `ObservedTransaction` fixtures ship alongside the route
  (`apps/web/src/fixtures/*.json`) and are also imported by a core-level test.
  A hash that matches a fixture key resolves from disk with no network call, so
  the whole pipeline — ingest → synthesize → deny table → explain — is
  demoable with no RPC access and no credentials. The demo page defaults to a
  fixture.

Two fixtures: a single-invocation `transfer` (the canonical demo) and a
two-invocation flow (proves "two functions observed → two functions permitted").

---

## 4. `apps/web` — Claude

`POST /api/explain`, `runtime = 'nodejs'`, key server-side only.

One call, `claude-opus-5`, adaptive thinking, `effort: 'medium'`, doing both of
Claude's permitted jobs:

- **explain** — turns `proposal.rationale[]` (structured strings) into plain
  English. Input is the rationale, never the transaction; output is prose,
  never policy.
- **ask** — returns one clarifying question about intent ("this moved 50 USDC —
  cap at 50, or allow up to 100 per week?") plus the *discrete options* that
  answer it. Each option is `{ label, headroomBps, windowLedgers }` — arguments
  to `synthesize`, chosen from a fixed set the route validates before returning.
  Claude phrases the question; it cannot invent an argument value.

**[A1] Claude's options are proposals only.** Nothing Claude returns reaches
`synthesize()` until the user explicitly selects an option in the UI. The page
renders the proposal derived from the defaults — `headroomBps: 10_000`,
`windowLedgers: 120_960` — and keeps it until a click changes it. There is no
auto-apply, no "recommended" option pre-selected, and no code path where an
unanswered question results in a widened cap. If the explain call fails, times
out, or returns nothing, the displayed policy is exactly the default-headroom
policy. Widening is always an explicit user action (rule 6).

Structured output via `output_config.format` with a JSON schema, so the response
shape is enforced rather than parsed hopefully.

**Degradation:** with no `ANTHROPIC_API_KEY` the route returns the structured
rationale verbatim and `{ explained: false }`. The page renders and the deny
table works. Claude is never on the path that produces authorization logic, so
its absence costs prose, not correctness.

---

## 5. `apps/web` — the page

One route, four sections, in order: **Observed → Derived policy → Deny table →
Install.** Dark, dense, monospace-leaning. No marketing copy.

- **Observed** — hash, ledger, source, and each invocation with real contract
  addresses (truncated `CBQH…7X2K`, full value on hover/click) and real amounts
  in smallest units with the decimal rendering beside them.
- **Derived policy** — the context rule and each `PolicyConfig` as a table, plus
  the plain-English explanation and the clarifying question with its options.
  **[A1]** The table always shows the default-headroom policy until the user
  explicitly picks an option; picking one re-runs `synthesize` client-side (core
  is pure — it runs in the browser as happily as on the server) and the page
  updates, with the active headroom shown next to the cap. No option is
  pre-selected.
- **Deny table** — the visual centre, most vertical space. One row per deny
  case: axis, what changed, and a `PERMIT`/`DENY` cell that is unmissable
  (large, color + text, never color alone). Every row must read `DENY`; the
  observed transaction gets its own `PERMIT` row above the table so the
  contrast is visible in one glance. Rows are generated by `generateDenyCases`
  and adjudicated by `evaluate` — the page runs the same code the tests run.
- **Install** — build the transaction, hand to `stellar-wallets-kit` for
  client-side signing, submit, show the result. Testnet only.

### The honest constraint on Install

Installing requires a deployed OpenZeppelin smart account to install *onto*.
This MVP does not deploy one. The install section therefore behaves as:

- `NEXT_PUBLIC_SMART_ACCOUNT_ID` set → build the real invocation, sign via the
  wallet kit, submit to testnet, render the result.
- unset → render the exact unsigned transaction XDR that *would* be submitted,
  with the button disabled and the reason stated on screen.

No key ever reaches the server, an env var, or browser storage; signing is
entirely inside the wallet kit. There is no code path in this repo that can move
user funds, and the README says so under its own heading.

---

## 6. CI

`.github/workflows/ci.yml`, on every push and PR:

```
npm ci
npm run -w packages/core build
npm run -w packages/core test      # the deny-case suite
npm run lint
npm run -w apps/web build          # typecheck + Turbopack build
```

Node 22. Badge in the README.

---

## 7. Out of scope — `TODO(roadmap)` anchors

Rust policy codegen (anchored at the `compositionOnly` gate in `synthesize.ts`),



the MCP server (anchored at `packages/core/src/index.ts`, which is why core has
no Next.js or browser globals), mainnet (anchored at the network union in
`types.ts`), multi-account management, wallet.

---

## 8. Build order

1. Restructure to workspaces; raise `target` to ES2022; move the scaffold. Verify
   `npm run -w apps/web build` still passes before adding anything.
2. `packages/core`: `types.ts` → `synthesize.ts` → `evaluate.ts` →
   `denycases.ts`, then the suite. **Green before any UI.**
3. CI workflow — get the badge green while the surface is still small.
4. Ingest route + fixtures; core test that runs the fixtures end-to-end.
5. The page: Observed → Derived → **Deny table** → Install shell.
6. `/api/explain`, wired into Derived.
7. Install flow with the wallet kit.
8. `README.md`: what it does, how to run it, the six design rules stated as
   design rules, and an honest "not done yet" section — which will name at
   minimum: no deployed smart account, no codegen, no MCP server, no mainnet,
   fixture-first ingest, and the fact that the deny table proves the policy
   refuses adjacent transactions *as evaluated by this repo's evaluator*, not
   as enforced on-chain.

---

## 9. Resolved decisions

- **D1** — keep `src/`; paths are `apps/web/src/app/...`.
- **D2** — `tsc` build for core, `exports` → `dist/`.
- **D3** — no smart-account contract ID yet, so Install is the XDR-preview path:
  render the exact unsigned transaction, button disabled, reason on screen.
- **D4** — `validityLedgers` and `windowLedgers` both default to **120,960**
  ledgers (~7 days at ~5s/ledger).
