# Limen

[![CI](https://github.com/dakshdrall/limen/actions/workflows/ci.yml/badge.svg)](https://github.com/dakshdrall/limen/actions/workflows/ci.yml)

**The permission layer for agentic money on Stellar.**

A user performs a transaction once. Limen derives the minimum OpenZeppelin
smart-account context rule and policy set that permits exactly that flow — and
refuses everything adjacent to it. The user reviews it in plain English and
installs it on their smart account. An agent then operates inside that boundary
and never holds a key.

---

## The thing this proves

One screen shows a transaction that was performed, the policy Limen derived from
it, and **a table of adjacent transactions the policy now refuses** — a larger
amount, a different asset, an extra function call, a different contract, an
appended invocation, an expired window.

That deny table is the product. Each row changes exactly one dimension of the
observed transaction, so a `PERMIT` anywhere in the table names the single
over-permissive dimension of the derived policy. The rows are produced by
`generateDenyCases` and adjudicated by `evaluate` — the same functions the test
suite runs, executing in the browser.

---

## Running it

```bash
npm ci
npm run build      # builds @limen/core, then the web app
npm test           # the deny-case harness
npm run dev        # http://localhost:3000
```

No credentials are required. The app ships JSON fixtures and loads one by
default, so the whole pipeline — ingest → synthesize → deny table → install
payload — runs with no RPC access and no API key.

### Optional configuration

| Variable | Effect when unset |
|---|---|
| `SOROBAN_RPC_URL` | Live testnet ingest is unavailable; fixtures still work. Server-side only — never exposed to the browser. |
| `ANTHROPIC_API_KEY` | The plain-English explanation is skipped and the raw structured rationale is shown instead. The deny table is unaffected. |
| `NEXT_PUBLIC_SMART_ACCOUNT_ID` | Install renders the exact payload that would be submitted, with signing disabled. |
| `WAITLIST_STORE_PATH` | Waitlist entries are written to a JSON file in the system temp directory, which a serverless host erases when the instance recycles. Set it to somewhere durable. `TODO(roadmap)`: a real backend. |
| `NEXT_PUBLIC_SITE_URL` | OG and Twitter card URLs resolve against Vercel's production hostname, or `http://localhost:3000` outside it. |

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
audited OpenZeppelin primitive — `spending_limit` and function allowlists. No
Rust is generated. If a constraint cannot be expressed by composing those,
`synthesize` throws with the constraint named rather than guessing. Future
codegen is gated behind a `compositionOnly: false` flag that is never set.

**3. Limen custodies nothing.** No secret key reaches the server, an environment
variable, or browser storage. Signing is client-side only, via
`@creit.tech/stellar-wallets-kit`. There is no code path in this repository that
can move user funds.

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

---

## Layout

```
packages/core/      @limen/core — dependency-free, no network IO, no DOM
  types.ts          domain model
  synthesize.ts     deterministic derivation
  evaluate.ts       independent adjudication
  denycases.ts      single-axis mutations
apps/web/           Next.js 16, App Router, TypeScript, Tailwind
  src/app/api/ingest/          tx hash -> ObservedTransaction (nodejs runtime)
  src/app/api/explain/         Claude: structured rationale -> plain English
  src/app/api/install-preview/ proposal -> Soroban ScVal XDR
  src/app/page.tsx             the demo screen
  src/fixtures/                shipped JSON transactions
```

`packages/core` is free of Next.js and browser globals so a future MCP server
can import it directly.

---

## Not done yet

An honest list. None of the following is implemented, and the demo does not
pretend otherwise.

- **No smart account is deployed.** Installing requires an OpenZeppelin smart
  account to install *onto*, and this MVP does not deploy one. The Install
  section serializes the real payload — a Soroban `ScVal`, verified to
  round-trip through XDR — and disables the button. The enclosing transaction
  (entrypoint name, sequence number, fee, auth entries) depends on the deployed
  account's interface and is not assembled.
- **The deny table proves refusal as adjudicated by this repository's
  evaluator, not as enforced on-chain.** `evaluate` is an independent
  implementation of the same rules, which is a real check against a wrong
  synthesizer — but it is not the OpenZeppelin contract. Nothing here has been
  tested against a deployed policy contract.
- **Live RPC ingest is lightly exercised.** The extraction path against Soroban
  RPC is implemented but has been tested against fixtures rather than a broad
  range of live testnet transactions. Movement→invocation attribution is
  approximate: contract events carry the token contract, not the invocation that
  caused them, so all movements are attached to the first invocation. This is
  presentational only — no derived cap, allowlist, or deny case depends on it.
- **Fixture transactions are illustrative.** Their addresses are real
  StrKey-valid Stellar addresses, but the transactions were not observed on a
  live network. They are marked `"network": "simulated"` for that reason.
- **Only two OpenZeppelin primitives are supported** — `spending_limit` and
  function allowlists. Anything else throws rather than approximating.
- **No Rust policy codegen, no MCP server, no mainnet, no multi-account
  management, no wallet.** Each is marked with a `TODO(roadmap)` comment at the
  point where it will attach.
- **`npm audit` is not clean** — 23 low-severity advisories remain, all of them
  unfixable at the dependency level. See [Dependency
  advisories](#dependency-advisories) for the full accounting.

---

## Dependency advisories

`npm audit --omit=dev` on production dependencies:

| | critical | high | moderate | low | total |
|---|---|---|---|---|---|
| before overrides | 1 | 10 | 6 | 19 | **36** |
| after overrides | 0 | 0 | 0 | 23 | **23** |

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

This clears every critical, high, and moderate advisory — including the critical
one, arbitrary code execution in `protobufjs` (GHSA-xq3m-2v4x-88gg), which
arrived via `@trezor/*`. All five resolve within a compatible range, so nothing
is force-upgraded across a breaking major. `npm test`, `npm run lint`, and
`npm run build` all pass with them applied, and the app was smoke-tested
end-to-end afterwards.

> **Reproducing this:** npm seeds resolution from an existing `node_modules`, so
> adding an override to a populated tree appears to do nothing — the old version
> stays pinned and the audit count does not move. Delete both `node_modules` and
> `package-lock.json` before re-resolving, or you will conclude the overrides
> are broken. They are not.

### What cannot be fixed, and why

The 23 remaining advisories are all low severity and all reduce to a single
root cause: **`elliptic`** (GHSA-848j-6mx2-7j84, "uses a cryptographic primitive
with a risky implementation"). The advisory covers `*` — every published
version, including the current 6.6.1 — so there is no version to pin to. An
override cannot fix it; only removing the dependency can.

It arrives through two independent paths, both inside the wallet kit:

```
@creit.tech/stellar-wallets-kit
├─ @hot-wallet/sdk → @near-js/crypto → secp256k1 → elliptic
└─ @trezor/connect-plugin-stellar → @trezor/connect
     ├─ @trezor/blockchain-link → crypto-browserify → browserify-sign → elliptic
     └─ @trezor/utxo-lib → tiny-secp256k1 → elliptic
```

Both are unconditional dependencies of `@creit.tech/stellar-wallets-kit`. They
are installed whether or not the HOT Wallet and Trezor modules are used, because
npm installs a package's dependency tree regardless of which subpaths an
application imports.

### Subpath importing, and what it does not do

The install flow imports only the two modules it uses:

```ts
import('@creit.tech/stellar-wallets-kit/modules/freighter')
import('@creit.tech/stellar-wallets-kit/modules/xbull')
```

Neither pulls in `@hot-wallet/sdk` or `@trezor/*`, so `elliptic` is never
bundled into the client and never executes at runtime.

**This is a mitigation of runtime exposure, not of supply-chain exposure.** Be
precise about the distinction:

- ✅ `elliptic` is not in the shipped browser bundle and no code path reaches it.
- ❌ It is still installed on every `npm ci`, in CI and on any developer machine.
- ❌ It still runs its install scripts and still appears in `npm audit`, SBOMs,
  and any supply-chain scan.

So subpath importing is the *only* available mitigation for the `elliptic`
advisories, and it is a partial one. Removing them entirely would require the
wallet kit to move its wallet modules to optional peer dependencies, or
replacing the kit with per-wallet integrations. Neither is in scope for this
MVP, and neither is something this repository can fix on its own.

---

## License

MIT — see [LICENSE](./LICENSE).
