# PLAN-V4 — a person can actually use it

Status: **steps 1–4, 6 and 7 built; G4 answered, wallet path dropped. §11's
browser half is UNRUN — see §11.** Written against the repository at `7ce1e7a`
and against
`OpenZeppelin/stellar-contracts` at commit `a9c42169`, the tag pinned in
`packages/chain/src/wasm/manifest.json`. Every claim below about someone else's
contract cites the line it came from, because the last time this project trusted
a summary of `__check_auth` it nearly recorded a resource failure as a refusal.

Steps 1–3 are recorded as `v4ChainRun` in `deployments/testnet.json` — eleven
transactions, F2 and F3 both measured rather than predicted. Step 4 is the local
key, the label tripwire, and the three-level mainnet gate. Step 5 is answered by
the F4 measurement below and **is not being built**; see G4.

---

## 0. Verdict: steps 1 and 3 are possible. Neither is blocked.

The brief asks for a stop-and-report if deploying from a browser-shaped code
path or revoking is blocked by the tooling. Both were checked against the
sources before anything else in this plan was written. Both are clear, and the
checking turned up four things that change what gets built.

### F1 — there is no deploy code anywhere in this repository

`scripts/testnet.mjs` has a `walkthrough` subcommand and nothing else. It never
had a `deploy` one: the recorded smart account at `CBNPFNPW…` was deployed with
the `stellar` CLI, by hand, which is why the README documents it as CLI
commands and why `deployments/testnet.json` records the result rather than the
producer. So this is not "move an existing Node path into the browser." **No JS
deploy path exists to move.** Step 1 writes one.

What it has to build is small, because the constructor does the work:

```rust
// examples/multisig-smart-account/account/src/contract.rs:32
pub fn __constructor(e: &Env, signers: Vec<Signer>, policies: Map<Address, Val>) {
    smart_account::add_context_rule(
        e, &ContextRuleType::Default, &String::from_str(e, "multisig"),
        None, &signers, &policies,
    );
}
```

`Operation.createCustomContract` with the recorded account wasm hash and two
constructor arguments — a one-element `Vec<Signer>` and an empty policy map.
**The smart account signs nothing at deploy.** The constructor runs as part of
creation, so the only signature required is the fee source's on the envelope.
That is what makes "a stranger with no wallet creates an account" reachable:
the browser key funds itself from friendbot, pays the fee, and the account
exists.

Two consequences worth stating before a screen is drawn:

- **The owner signer is fixed at creation**, on `/app/accounts/new`, not later
  at install time. (Written when there were two candidates to choose between;
  G4 leaves one, so this is now a statement about *when* the owner is decided
  rather than about a choice. It still matters: `batch_add_signer` exists and
  could add a second owner signer afterwards, authorized by the first — out of
  scope, noted so nobody plans around its absence.)
- **The constructor's Default rule is a rule like any other**, named `multisig`,
  holding the owner signer and no policy. Its id comes from the same on-chain
  counter every other rule's does. It is read back, never assumed to be `0` —
  the same discipline `contextRuleIdFrom` already applies in the walkthrough
  script.

### F2 — revoke works, and the asymmetry it demonstrates is enforced by the contract

`remove_context_rule` requires the account to authorize itself
(`packages/accounts/src/smart_account/mod.rs:341–342`,
`e.current_contract_address().require_auth()`), which routes back through
`__check_auth` with a `Contract` context naming the smart account.

The owner can sign that. The agent cannot, and not because Limen declines to
offer it a button:

```rust
// packages/accounts/src/smart_account/storage.rs:303
let context_type_matches = context_rule.context_type == ContextRuleType::Default
    || context_rule.context_type == required_type;
```

The owner's Default rule matches any context, so it validates a call to the
account itself. The agent's rule is `CallContract(token)`, which does not. An
agent that tries to revoke its own boundary — or to install a wider one — is
refused by the network with `UnvalidatedContext#3002`.

That is a seventh refusal the brief did not ask for, it costs one more
submission, and it is the direct answer to *"the agent holds a key, so what
stops it?"* It is in scope at step 3.

### F3 — after revoke, the failure is `ContextRuleNotFound#3000`, which this repository does not currently call a refusal

`remove_context_rule` deletes the storage entry
(`storage.rs:845–850`); a later `get_context_rule` for that id panics
`ContextRuleNotFound`. And `3000` is deliberately **not** in
`BOUNDARY_REFUSAL_CODES` (`packages/chain/src/errors.ts:64`).

This is a decision, not an oversight to patch. *"The boundary refused you"* and
*"the boundary is gone"* are different claims, and widening the set so a revoked
rule renders identically to a spending-limit refusal would blur exactly the
distinction the deny table exists to keep sharp. The plan:

1. Measure the real code on testnet at step 3, rather than predicting it here.
2. Add a **separate** predicate — `isRevokedRule(codes)` — and a distinct
   presentation, on the `REFUSED AT SIMULATION` precedent: a third thing that is
   neither PERMIT nor a boundary DENY, distinguished by treatment rather than by
   a new hue.

If the measured code turns out to be something else, the measurement wins and
this paragraph gets rewritten.

### F4 — the wallet owner path is the one genuinely uncertain piece, and it is uncertain for a reason worth writing down

A wallet cannot be an `External` signer. `External` verification hands raw bytes
to a verifier contract (`storage.rs:343–352`); wallets sign envelopes and auth
entries, not arbitrary 32-byte digests. So a connected wallet can only be
`Delegated`, and `Delegated` resolves like this:

```rust
// packages/accounts/src/smart_account/storage.rs:353
Signer::Delegated(addr) => {
    let args = (auth_digest.clone(),).into_val(e);
    addr.require_auth_for_args(args)
}
```

That raises a **nested** authorization requirement from inside `__check_auth`.
Recording-mode simulation never executes `__check_auth`, so the nested entry
never appears in `simulateTransaction`'s `result.auth` and cannot be discovered
the usual way.

There is a cheap experiment that decides it, and it is the first thing step 5
does: the *enforcing* simulation — the second one, with the outer `AuthPayload`
entry already attached, which this project runs anyway for footprint reasons —
**does** execute `__check_auth`. Either it surfaces the nested requirement, in
which case the wallet path costs almost nothing, or it does not, in which case
the entry must be hand-constructed and step 5 is expensive.

#### F4, measured — 2026-08-05. The answer is no, and step 5 is the expensive branch.

Run with `node packages/chain/scripts/acceptance.mjs f4`, against a throwaway
account owned by `Delegated(G…)` on testnet. The experiment runs two payload
shapes, because the first version of it asked the wrong question and got a
confident answer to it.

**The wrong question, kept as a control.** An `AuthPayload` with an empty
`signers` map fails at `UnvalidatedContext#3002` — from inside `__check_auth`,
but *before* the `Delegated` branch runs. `check_auth` matches the rule's
signers against `signatures.signers.keys()` and, for a rule with no policies,
requires every one to be present (`storage.rs:313–319`). That failure is
indistinguishable at a glance from "nested auth cannot be discovered" and is
nothing of the kind. It is kept in the script so the real result cannot be
misread the same way twice.

**The real question.** The payload must *name* the signer;
`authenticate` ignores the mapped bytes entirely for `Signer::Delegated`
(`storage.rs:353–356`), so empty bytes are the honest value — there is no
signature, and a placeholder shaped like one would be a lie in the payload.
With `signers: { Delegated(G…): Bytes() }` the `Delegated` branch **does** run,
and the enforcing simulation fails like this:

```
escalating error to VM trap from failed host function call: require_auth_for_args
["Unauthorized function call for address", GBWSU5Z62RFSMLWHQYJPIB5XDHBN66FFH4TIOQZLWFP535GVA2EH2WOQ]
HostError: Error(Auth, InvalidAction)   — no contract error code
```

So `require_auth_for_args` is reached and the host refuses it for want of a
matching entry. The simulation **fails** rather than reporting what it wanted:
no `result.auth` entries come back, and a failed simulation hands a wallet
nothing to sign. Discovery-by-simulation is therefore unavailable on both
simulations, not just the recording one.

What that leaves is hand-construction: the failure names exactly what is
missing — an entry authorizing `require_auth_for_args((auth_digest,))` for the
wallet address — and `auth_digest` is already computed client-side by
`authDigest()`. So it is not impossible. It is unverified, it has no simulation
to check the invocation tree against, and getting it wrong is discovered only
by spending a submission. That is the definition of the expensive branch, and
**G4 is hereby answered: fall back.**

There is no third owner path.

The fallback this paragraph originally described — the wallet connecting as fee
source and identity while the owner signer stays the labelled browser key — is
**also declined**, and the reason is the sentence that followed it: shipping a
wallet button that quietly leaves the browser key in charge would be the worst
available outcome. A screen disclosing that in prose does not fix it. Someone
who connects a wallet has told you what they believe is about to happen, and a
caption underneath correcting them is worse than never offering the button.

So v4 ships **no wallet button at all**, and the screen states which key owns
the account at the moment the account is created — which was the load-bearing
half of that sentence and survives without the wallet.

What does *not* change: the owner signer is still fixed at creation (F1), and
`NO CUSTODY` is still not upgraded — it is rewritten at step 6 to the claim that
survives, which is now the only claim there is.

### One more, smaller: the browser cannot run the chain layer as written

`authpayload.ts` builds every value through `Buffer` (`:80`, `:107`), and
`read.ts:78` hex-encodes through it. There is no `Buffer` global in the client
bundle. `api/lower/route.ts:11` says outright that the route exists "purely to
keep the Stellar SDK — which `@limen/chain`'s index pulls in — out of the
browser bundle," and V4 ends that: there is no signing without the SDK in the
browser.

Both are step 1 work, and both are mechanical: `Uint8Array` throughout, and a
`./browser` subpath export from `packages/chain` so importing `lower` still does
not drag in the write path. Dynamic `import()` on the write screens keeps the
landing and the read-only screens from paying for the SDK.

---

## 1. The acceptance test, made concrete

The brief's seven steps are nine transactions. Listing them is the point: each
is a hash, the flow takes a minute or two of ledger closes, and anything that
cannot produce a hash has to say why in place of one.

| # | Transaction | Signed by | Fee paid by |
|---|---|---|---|
| 1 | Friendbot funds the owner's classic account | — | friendbot |
| 2 | Friendbot funds the agent's classic account | — | friendbot |
| 3 | Deploy the smart account (`createCustomContract`) | owner (envelope only) | owner |
| 4 | Fund the smart account — native SAC `transfer` G→C | owner (classic auth) | owner |
| 5 | **The observed transaction**: the smart account transfers, under the Default rule | owner (`__check_auth`) | owner |
| 6 | Install the derived boundary (`add_context_rule`) | owner (`__check_auth`) | owner |
| 7 | The agent's permitted transfer | **agent** (`__check_auth`) | **agent** |
| 8 | The agent's over-limit transfer — refused on-ledger | **agent** | **agent** |
| 9 | Revoke (`remove_context_rule`) | owner (`__check_auth`) | owner |
| 10 | The agent repeats step 7 — now fails | **agent** | **agent** |

Plus the optional seventh axis from F2: the agent attempts step 9 and is
refused. Ten or eleven transactions.

Two things about this shape are deliberate.

**The observed transaction is the person's own.** Step 5 is the smart account
moving its own funds, authorized by its owner — so the boundary at step 6 is
derived from a transaction the person just performed on the account they just
created, read back through the existing live-ingest path. That is the product's
sentence — *"a user performs a transaction once"* — executed rather than
illustrated. It also retires `liveDerivation.installedSeparately` in
`deployments/testnet.json`: ingest-to-install stops being two runs.

**The agent pays its own fees.** Step 7 and 8 could be paid by the owner's
account, as the recorded walkthrough does. They will not be. The agent holding
its own funded account means no owner signature is anywhere near the agent's
transactions, and the separation is visible in the fee source as well as in the
auth entry. It costs one friendbot call.

---

## 2. Decisions taken

Binding on everything below.

1. **Browser key is the only path.** Originally "the default path; wallet is
   offered, never required" — the wallet half is withdrawn on the F4
   measurement, and G4 is answered *fall back* below. No wallet button, no
   auto-connect, no wallet prompt on load, no disabled control implying a path
   that does not exist. The §1 acceptance test runs start to finish on the
   browser key, which it was always going to do.
2. **Two keys, always, enforced rather than intended.** `assertDistinctSigners`
   throws if the owner and agent public keys are ever equal, and is called on
   every install and every agent submission. A demonstration where both keys are
   the same key demonstrates nothing, and "we were careful" is not a mechanism.
3. **Mainnet is gated three ways** (§4), and the CI proof is that the mainnet
   passphrase string does not appear in the client bundle at all.
4. **A revoked rule is not a boundary refusal** (F3). Separate predicate,
   separate presentation.
5. **The local key is never exported and never pasted.** No "back up your key"
   flow, no import field. The account is disposable and the screen says so at
   creation: **clearing site data destroys the key, and with it the account**.
   Offering an export would create the one thing design rule 3 exists to
   prevent — a user secret in transit through a form — in exchange for
   protecting an account that holds testnet dust.
6. **One reference browser-signed run is recorded** in
   `deployments/testnet.json` under a new `browserRun` block. The README's
   "every install was signed by `scripts/testnet.mjs`" is not retired by
   deleting the sentence; it is retired by hashes that were not.

---

## 3. Signing

### The three actors, and where each key lives

| Actor | Signer type | Key held | Authorizes |
|---|---|---|---|
| Owner (browser key) | `External(ed25519_verifier, pubkey)` | `localStorage`, labelled `TESTNET ONLY · LOCAL KEY` | deploy, observe, install, revoke |
| Agent | `External(ed25519_verifier, pubkey)` | `localStorage`, separate key, same label | only what the installed rule permits |

Two actors, not three. The wallet row that stood here — `Delegated(G…)`, held in
Freighter or xBull, "subject to gate G4" — is struck on the F4 measurement.
There is no connected-wallet owner in v4.

`apps/web/src/lib/local-key.ts` — the path
`test/local-key-label.test.ts:48` already watches — holds both. It is the only
module in the repository that generates a key, and the tripwire written in step
V3 fires for real the moment it lands: every file that imports it must render
`LOCAL_KEY_LABEL`, and the currently-skipped assertion at
`local-key-label.test.ts:246` becomes live.

### Design rule 3, narrowed explicitly

V3 recorded this narrowing and did not take it. Taking it means editing the
rule, not the surrounding prose:

> **3. Limen custodies nothing of yours.** No user's secret key reaches a Limen
> server, an environment variable, or a log line. Signing is client-side only.
> A disposable testnet ed25519 keypair is generated in the page and kept in
> browser storage, labelled `TESTNET ONLY · LOCAL KEY` wherever it is created or
> used; it is not a wallet, it never leaves the browser, and clearing site data
> destroys it.

The final clause — *"on the connected-wallet path no key enters the page at
all"* — is dropped with the path it described. Keeping it would be the more
flattering wording and would describe nothing that ships.

`NO CUSTODY` currently reads *"No key of yours reaches a Limen server. There is
no code path here that can move your funds."* (`StatusLabel.tsx:21`). The second
sentence stops being true the moment a screen calls `createLocalKey` — that key
exists precisely so it can move testnet funds. So it is rewritten at **step 6**,
not before: it is accurate today because nothing yet imports `local-key.ts`, and
it becomes false in the same commit that first does. `caveats.test.ts` pins the
new wording in both directions, as it already does for the custody claim in the
README.

The same applies to the README's design rule 3, which additionally still names
`@creit.tech/stellar-wallets-kit` as the signing mechanism. Both are step 6.

### The UI states which key is signing, every time

Not once at the top of the flow. At each signature, in the confirmation, beside
the button: `OWNER` or `AGENT`, with the public key and the label. Steps 7, 8
and 10 carry `AGENT`; nothing else does.

---

## 4. Scope

### Must exist

- `/app/accounts/new` — create an account. Currently absent rather than broken.
- Install — the derived plan written to the person's own account, signed
  client-side, hash shown.
- Revoke — likewise, and afterwards the policy screen **re-reads from the
  chain** rather than assuming the write landed. `read.ts` already exists for
  exactly this and already refuses to render an unreadable rule as an absent one.
- An agent run — one permitted, one refused, both from the browser, both with
  hashes. `/app/policies/[id]` shows the person's own refusal when there is one,
  and falls back to the recorded survey **labelled as recorded**.

### Must not exist

Mainnet in any form. Rust codegen. Multi-contract boundaries. Any path to real
funds. Any key reaching a server, an environment variable, or a log line.

### The mainnet gate, at three levels

1. **Type.** The signer takes `passphrase: typeof NETWORK_PASSPHRASE` —
   `lib/network.ts` already defines the union with one member, so passing
   anything else does not compile.
2. **Runtime.** A hard `throw` on any other passphrase value, reachable from no
   configuration. Unit-tested by calling it with the mainnet string and asserting
   it throws — the fence has to be shown firing.
3. **CI, two-sided, on the built client bundle.** Assert the testnet passphrase
   **is** present, then assert `Public Global Stellar Network ; September 2015`
   is **absent**. A grep that can never match proves nothing; this is the same
   argument that shaped the demo-signer fence, applied to the network instead of
   to a sentinel.

   #### Level 3, measured — 2026-08-05. The absence half is unachievable, and the fence is moved rather than dropped.

   Written before the SDK was in the browser, and wrong once it is. The built
   client bundle contains:

   ```js
   var e=((l=e||{}).PUBLIC="Public Global Stellar Network ; September 2015",
                    l.TESTNET="Test SDF Network ; September 2015",…
   ```

   That is `@stellar/stellar-sdk`'s own `Networks` enum. It ships in every build
   that can sign anything, so "the mainnet passphrase does not appear in the
   client bundle" fails forever — and a check that fails forever is one that
   gets deleted rather than satisfied. Asserting it as specified would have
   bought a red build and then, predictably, no fence at all.

   So the assertion moves to where it is both true and load-bearing. **Limen's
   own source never names mainnet** — not the passphrase literal, not
   `Networks.PUBLIC` — scanned across `apps/web/src` and `packages/*/src`; and
   **no mainnet endpoint reaches the bundle**, because an endpoint is the part
   that cannot be borrowed from a library constant. A passphrase nothing
   references, with nowhere to send it, is not a path to mainnet. Levels 1 and 2
   are what make that structural; this proves neither has been routed around.

   Both halves are still shown able to fire, and the testnet-present check
   stays, for the reason it was always there.

The existing demo-signer fence is unchanged and stays. One addition: no
56-character `S…` StrKey literal may appear in the client bundle, which catches
a pasted secret without needing to know its value.

---

## 5. What `packages/chain` gains

```
packages/chain/src/
  deploy.ts     wasm hash + owner signer -> a smart account. No Node APIs.
  install.ts    InstallPlan -> add_context_rule, unsigned
  revoke.ts     remove_context_rule / remove_policy, unsigned
  submit.ts     the two-simulation dance, lifted out of scripts/testnet.mjs:159
  sign.ts       signAs(), assertDistinctSigners(), the testnet throw
  browser.ts    the subpath export the client imports
```

`submit.ts` is a lift, not a rewrite. The comment at `testnet.mjs:157` — that
the second, enforcing simulation is what produces a footprint covering
`__check_auth` — is the single most expensive thing this project has learned,
and it moves into the package with the code so the next caller inherits it
rather than rediscovering it.

`lower.ts` stays pure. `packages/core` is not touched: `git diff --stat
packages/core` is empty at the end of this plan, as it was at the end of V3.

Two new tests in the chain suite, both cheap and both about the browser:

- No `Buffer`, no `node:` import, and no `process` reference in the modules
  reachable from `browser.ts` — asserted on source, and the suite runs those
  modules with `globalThis.Buffer` deleted so the assertion has teeth.
- `assertDistinctSigners` throws on equal keys, and is called on every write
  path (asserted by source scan, in the tripwire idiom already used for the
  local-key label).

---

## 6. RPC, funding, and fees from the browser

**Two endpoint names, because they are two things.** `SOROBAN_RPC_URL` stays
server-side and unexposed — it may be a keyed endpoint, and the README promises
it never reaches the browser. The browser gets
`NEXT_PUBLIC_STELLAR_RPC_URL`, defaulting to `https://soroban-testnet.stellar.org`.
Public testnet infrastructure, addressed directly.

The alternative — proxying simulate/send through a Limen route — was considered
and rejected. It would put a Limen server in the write path, which is the one
place this project has said it will not be, and a general-purpose RPC proxy is
an open relay wearing a helpful hat.

A consequence, stated rather than discovered: **no Limen rate limit applies to
the write path**, because no Limen server is in it. Friendbot and the public RPC
apply their own. The existing per-address limits on `/api/demo/perform` and
`/api/ingest` are unaffected.

**Funding.** Friendbot at `https://friendbot.stellar.org?addr=G…`, called from
the page. If CORS blocks it, the fallback is a thin `/api/fund` route that
forwards an address and nothing else — decided by trying it at step 1, not by
guessing here.

---

## 7. Screens

In this order, because each one's output is the next one's input.

**`/app/accounts/new`** — generate, fund, deploy. No owner-path choice to make,
per G4: the screen states that the owner is this browser's key rather than
offering it as one of two. `TESTNET ONLY · LOCAL KEY` renders at the moment of
generation, `NOT AUDITED` above the deploy button, and the disposability
sentence from decision 5 beside both. Ends with a contract address and a deploy
hash.

**`/app/accounts/[id]`** — gains the funding step and the observe step. Existing
screen, existing chain reads.

**`/app/policies/new`** — the derived boundary, the lowered plan, and now an
install button. The replacement for the paragraph at
`NewPolicyScreen.tsx:206–216` is not silence: it says which key is about to
sign, and that a boundary installed here can be taken back at
`/app/policies/[id]`. The sentence *"There is no form here that accepts a secret
key, and there will not be one"* **survives verbatim** — it is still true, and
it is more load-bearing now than when nothing could sign at all.

**`/app/policies/[id]`** — the agent run and revoke. The permitted call, the
refused call with its decoded error, then revoke, then the same call failing.
Re-reads the chain after every write.

Every screen keeps stating whether what it shows is on-chain, computed locally,
or a shipped fixture.

---

## 8. Motion

Three, all readings rather than effects, all cut if they cannot be driven by
real data.

- **Ledger heartbeat** — the ruled ground's minor rule brightens one contrast
  step on each ledger close, driven by `getLatestLedger`. Stops on RPC failure
  and on a hidden tab. No fallback pulse.
- **Ledger counter** in the top bar beside `TESTNET`. Mono, tabular, no
  animation on the digits.
- **Closing window** — on an installed policy, a hairline shortening as the
  context rule approaches `validUntilLedger`. Both ends are real: the current
  ledger from RPC, the expiry from `read.ts`.

The enforceable form of *"if the network went down and the motion continued, it
was decoration"*: **each of the three is a pure function of a ledger sequence
passed in as a prop, and renders its static state when that value is `null`.**
Unit-testable without pixels — a frozen sequence produces no change, and a
`null` one produces no motion.

`globals.css` contains no `@keyframes` today. A design-system test asserts it
never does: every permitted motion here is a transition on a data change, and a
keyframe loop is by definition not one. The existing bans on gradient, glow and
shadow depth (`design-system.test.ts:249`) are unchanged, as is the global
`prefers-reduced-motion` rule at `globals.css:166`.

### Step 7, built — 2026-08-05. Four things the plan did not anticipate.

All three readings ship. One poller for the whole application — `LedgerSource`
in the root layout — because a top bar counting one sequence above a hairline
computed from another is two instruments disagreeing about the present. The
arithmetic is in `lib/ledger.ts`: no React, no clock, no network, and
`ledger-motion.test.ts` asserts §8's condition directly — a frozen sequence
produces no change, a `null` one produces no motion.

**1. `getLatestLedger` is the wrong method, by three orders of magnitude.**
Measured on `soroban-testnet.stellar.org`, not assumed:

```
getLatestLedger   186,664 bytes   (full ledger header + metadata XDR)
getHealth             205 bytes   (carries latestLedger)
```

A poll every five seconds for a seven-digit number would have cost about 2 MB a
minute per open tab. `getHealth` carries the same sequence and additionally says
whether the endpoint considers itself to be serving current data, which is a
second stop condition worth having. The obviously-named method is the expensive
one, so the reason is a comment in `use-ledger.ts` rather than a commit message.

**2. "Brightens one contrast step on each ledger close" is narrowed to parity.**
Read as a pulse — brighten, then decay — it needs a second state change the
ledger did not cause, driven by a timer, and a timer is exactly the thing that
keeps running when the network stops. Read as parity it is one contrast step of
change on every close, caused by the close and by nothing else, and it is a pure
function of the sequence — which is the enforceable form §8 actually specifies.
The narrowing is taken deliberately and written down at the function.

**3. `prefers-reduced-motion` is honoured by kind, not by blanket.** The global
rule at `globals.css:166` collapses transition durations to `0.01ms`. Applied to
a texture that changes every five seconds, that converts a slow fade into a hard
blink — reduced motion made *worse*. So the heartbeat is switched off entirely
under `reduce`; it carries no information and the honest reduced form is none of
it. The closing window is deliberately not disabled: its length is a quantity a
reader is being shown, and what should go is the easing, which the global rule
already removes.

**4. `StoredProvenance.validityLedgers` does not hold a span.** It holds
`PlannedContextRule.validUntilLedger` verbatim, which is an absolute ledger
sequence. Reading it as a duration gives a denominator around four million and a
bar that never visibly moves. The closing window takes its span from
`validUntilLedger - observedLedger` instead — both ends recorded, neither
assumed — and the misleading field now carries a comment saying so. Renaming it
is a stored-shape change and is not in this step.

The layout now wraps every page in a client provider, which is the one change
here that could have undone the dynamic-import discipline. It did not: the SDK
lives in two chunks, and **no chunk the landing loads contains either of them**.
The poller reaches RPC with `fetch` and a JSON body, and imports nothing from
`@stellar/stellar-sdk`.

---

## 9. The caveats this retires, and what replaces them

This project pins its honesty caveats by test, so retiring one is a deliberate
act with a red build attached. Both directions, as `caveats.test.ts:78` already
insists: a caveat that outlives its reason understates the work, and that is its
own kind of inaccuracy.

| Where | Retired | Replaced by |
|---|---|---|
| `README` "Not done yet" | "Nothing in the app can sign, so nothing in the app can install" | what the browser now signs, and that the owner key is disposable and unrecoverable |
| `NewPolicyScreen.tsx:208` | "Neither signer path exists in the browser yet" | which key signs, and where to revoke |
| `docs/page.tsx` | "No browser signer, so nothing installs from the interface"; "No revoke button" | how an agent is pointed at a rule that can be taken back |
| `app/page.tsx` | "Nothing installs from the browser" | the browser-signed run's hashes |
| `deployments/testnet.json` | `liveDerivation.installedSeparately` | one pass, one run, recorded as such |
| `caveats.test.ts:244` | the "does not pretend it can sign" block | a block asserting the new claims, including the survivors |

Survivors, asserted explicitly so a rewrite cannot take them out with the rest:
*"There is no form here that accepts a secret key"*; *"A failure is not a refusal
until its error code says so"*; the `/app/simulator` local-adjudication caveat;
`One contract per boundary`; `Testnet, and not audited`.

---

## 10. Sequence

Chain layer before screens. Gates stop work rather than route around it.

| # | Step | Done when |
|---|---|---|
| 1 | `deploy.ts`, de-Buffered chain layer, `browser.ts` export; deploy an account from a script that uses no Node-only API | contract id + deploy hash |
| **G1** | **Gate** — if the deploy path cannot be written without Node APIs: stop, report | |
| 2 | `install.ts` + `submit.ts`; install a derived plan signed by an in-memory ed25519 key; confirm the refusal still comes from the network | install hash, permitted hash, refused hash + decoded code |
| **G2** | **Gate** — the refusal must decode to a contract error, or it is not a refusal | |
| 3 | `revoke.ts`; revoke, then re-submit the call that worked; measure the code (F3); the agent's own attempt to revoke (F2) | revoke hash, post-revoke failure hash, measured codes |
| **G3** | **Gate** — if revoke cannot be signed or the post-revoke failure cannot reach a ledger: stop, report | |
| 4 | `lib/local-key.ts`, storage, label, `assertDistinctSigners`, the three-level mainnet gate and its CI proof | tripwire tests live and green; fences shown firing |
| ~~5~~ | ~~Wallet-kit as the second owner path~~ — **not built.** The F4 experiment ran first, as planned, and answered the question against the path | the written finding above, and this row |
| **G4** | **Gate — taken.** Fell back per F4: browser-key-only, no wallet button | |
| 6 | Screens, in order: create → observe → install → agent run → revoke | ~~the §1 acceptance test completes by hand~~ — **built, condition unmet: the test is UNRUN in a browser (§11)** |
| 7 | Motion | **built** — three readings, each `null`-safe, asserted in `ledger-motion.test.ts` |

Step 7 is the most cuttable thing in this plan and is sequenced accordingly.

---

## 11. Verification

- All existing tests pass. Lint, build, audit gate, and both bundle fences
  green, plus the new mainnet-passphrase fence.
- The §1 acceptance test completed **twice from a clean browser profile**, the
  second cold, with every hash confirmed against Horizon **from outside the
  process that produced it** — the discipline `deployments/testnet.json` already
  records for the e2e runs.
- One of those runs recorded as `browserRun` in `deployments/testnet.json`, with
  its producer named as the browser rather than a script.
- CI proves no server signer and no key material in the client bundle beyond the
  labelled local key, and proves the testnet-only throw.
- No page scrolls the body sideways at 1280, 1024, 768, 390px.
- Every screen still states on-chain vs computed locally vs shipped fixture.
- `evidence.json` regenerates and matches; `evidence.test.ts` re-derives the new
  chain figures independently, by a different route than the generator uses.
- `git diff --stat packages/core` is empty.

An opt-in Playwright spec mirrors the flow, and like the existing e2e suite it
stays out of CI: every run spends testnet funds, and a gate that flakes is a
gate people learn to ignore.

### Status — 2026-08-05. The non-browser half passes. The browser half is UNRUN.

Split, because the two halves have different standing and collapsing them into
one green tick would be the exact failure this section exists to prevent.

**Run, and passing:**

| Check | Result |
|---|---|
| `@limen/core` + `@limen/chain` suites | 103 passed |
| `@limen/web` suite | 236 passed, including step 7's `ledger-motion.test.ts` |
| Production build | clean; no SDK chunk on the landing |
| `npm run evidence:check` | up to date |
| `npm run lint` | clean |
| `npm audit --omit=dev --audit-level=low` | green — 0 advisories, threshold lowered per §12 |
| Demo-signer bundle fence | green, both sides shown firing |
| Mainnet / testnet-only bundle fence | green, both sides shown firing |
| StrKey-literal bundle fence | green, pattern shown matching a known StrKey |
| `git diff --stat packages/core` | empty |

**Not run — the two browser completions, and everything that depends on them:**

The §1 acceptance test **has never been driven in a real browser.** Not once,
let alone twice with the second cold. The attempt was set up — dev server
running, all routes serving, `/api/ingest` reading live testnet transactions
back — and was stopped by the reviewer's port forwarding failing on both the
tunnel URL and `127.0.0.1`, from a Codespace whose server answered `200` to
`curl` throughout. A tooling failure on the driving end, not a finding about
the code.

The distinction being recorded is between *unrun* and *skipped*. Nothing here
has been waived, judged unnecessary, or covered by something else. The
following are open:

- Two completions from a clean browser profile, the second cold.
- Every hash confirmed against Horizon from outside the process that produced
  it. The tooling for this half exists and is validated — it reconstructs the
  whole of `v4ChainRun` from public Horizon given only the owner key, the agent
  key and the contract address, with the fee source on each row read off the
  transaction rather than off which account's feed it arrived on. It has been
  run against a recorded run and never against a browser run, because there is
  no browser run.
- The `browserRun` block in `deployments/testnet.json`. **Deliberately not
  written.** There is nothing to put in it, and a block recording a run that did
  not happen is the one thing that file must never contain.
- The second run's hashes in this plan's own record, per open question 3.
- No page scrolls the body sideways at 1280, 1024, 768, 390px.
- Every screen still states on-chain vs computed locally vs shipped fixture.

**What therefore may not be said anywhere.** The browser write path is
*implemented*, and that is the whole of the claim. It has never signed a
transaction in a browser — the signing that produced `v4ChainRun` was
`packages/chain/scripts/acceptance.mjs`, a Node process, which is what step 6
exists to stop being the only thing that has ever done it. Until the two runs
land, no README sentence, landing figure, docs page or commit message may
describe it as verified, demonstrated, or run. Step 6's "done when" in §10 —
*the §1 acceptance test completes by hand* — is precisely the unmet condition,
and the step is marked accordingly.

Step 7 proceeds while this is parked. It is the row this plan already called
its most cuttable, it touches no signing path, and its three readings are unit
testable without a ledger — so it is not blocked on the acceptance run and does
not pretend to substitute for it.

---

## 12. What v4 will still not do

- **Mainnet.** Gated three ways rather than merely out of scope.
- **A connected wallet as owner.** Struck by the F4 measurement, not by scope.
  `Delegated` is the only shape a wallet could take, its nested auth requirement
  cannot be discovered from either simulation, and hand-constructing the entry
  is checkable only by spending a submission. The finding is the reason, and it
  is recorded in the README as well as here.
- **Passkeys.** The WebAuthn verifier is deployed and unused. `External` +
  WebAuthn is the natural second owner path — and with the wallet path struck it
  is now the *only* candidate for one — and it is not in this plan.
- **Key recovery.** A cleared browser is a stranded account. Stated at creation,
  not discovered later.
- **Multi-contract boundaries, and function allowlists beyond `transfer`.**
  Unchanged: no audited primitive exists, and writing one is still the line this
  project does not cross.
- **`validFromLedger` on-chain.** No counterpart; stays local provenance.
- **A shared backing store.** Cache and rate limits stay process-local; the
  write path now has no Limen server in it at all.
- ~~**The 23 low-severity `elliptic` advisories.**~~ **Done — 2026-08-06, in its
  own commit.** This bullet twice described a thing v4 would not do, and it is
  struck rather than edited because the thing was done.

  The route it identified was the right one: every one of the 23 reduced to
  `@creit.tech/stellar-wallets-kit`, a declared dependency of `apps/web` that no
  source file imported, and G4's decision against the wallet path meant none ever
  would. Dropping it took the audit count to zero and the gate's threshold from
  `moderate` to `low`. The README's "What cannot be fixed, and why" section is
  retired, as this bullet said it would be.

  One thing the plan did not anticipate, recorded because it cost the most time
  and would cost it again. Removing the package changes npm's **hoisting**, not
  just its advisory count: with the kit gone there was no longer a root-level
  version conflict forcing `@stellar/stellar-sdk` into per-workspace
  `node_modules`, so it hoisted to the root. Two things fell out of that.

  First, this is a workspace with four `node_modules` directories. Clearing only
  the root — which is what the README's reproduce note said to do — leaves the
  three workspace copies to seed the resolve from their old layout, and produces
  a tree where the SDK keeps its nested position and its own declared dependency
  on `@noble/ed25519` is never installed at all. The chain suite then fails on a
  missing package that the lockfile correctly lists. The note now says to clear
  all four.

  Second, `test/stubs/stellar-sdk-browser.mjs` reached the SDK's UMD bundle by
  the literal path `../../node_modules/@stellar/stellar-sdk/dist/…`, which had
  silently encoded the nested layout as an assumption. It resolves the package
  entry and walks up to its root now, which holds under either layout. A hardcoded
  path into `node_modules` is a dependency on someone else's dependency graph.

---

## Open questions

Only the second changes what gets built first.

1. **Is the seventh refusal in or out?** The agent attempting to revoke its own
   boundary (F2) is one extra submission and, I think, the single most
   persuasive row on the page. I have scoped it in at step 3.

2. ~~**If G4 fails, does the wallet path ship in the fallback form?**~~
   **Answered: no.** G4 failed as measured, and the inclination recorded here —
   that a wallet button which connects a wallet and then signs with the browser
   key is more confusing than no wallet button, even when the screen says so —
   is taken as the decision. The finding is reported, the path is dropped, and
   v4 ships browser-key-only. `NO CUSTODY` is kept honest by rewriting it at
   step 6 rather than by leaving a wallet in the sentence to soften it.

3. **`browserRun` in the recorded deployments — one run or both?** Recording
   both makes the "twice, second cold" claim self-evidencing; recording one
   keeps the file about the mechanism rather than about the testing of it. I
   lean one, with the second run's hashes in the plan's own record.
