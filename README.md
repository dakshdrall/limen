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
- **`npm audit` is not clean.** Production dependencies report 36 advisories
  (1 critical, 10 high). The critical one is arbitrary code execution in
  `protobufjs`, reached through `@trezor/*` — which the wallet kit pulls in for
  its Trezor hardware-wallet module. The install flow imports only the Freighter
  and xBull modules via subpath imports, so that code is never bundled or
  executed here, but it is still in the dependency tree and has not been
  properly triaged. On a security-adjacent repository this should not be
  mistaken for a clean bill of health.

---

## License

MIT — see [LICENSE](./LICENSE).
