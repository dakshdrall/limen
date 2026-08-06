import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PLAN-V4 §1, driven in a browser.
 *
 * The plan's §11 records the browser half as UNRUN and is precise about why:
 * every hash in `packages/chain/deployments/testnet.json` was produced by
 * `packages/chain/scripts/acceptance.mjs`, a Node process, and the browser write
 * path had *never signed a transaction in a browser*. Implemented and
 * demonstrated are different claims. This file is what closes the gap.
 *
 * ## What it is, and what it is not
 *
 * It is a real Chromium, a real production `next start`, a real clean profile,
 * and eleven real testnet submissions signed by ed25519 keys generated inside
 * the page by `createLocalKeys`. Nothing here is stubbed, mocked, or replayed —
 * `page.route` appears nowhere in this file, deliberately.
 *
 * It is **not** a human clicking. §10 step 6's "done when" says *the §1
 * acceptance test completes by hand*, and a scripted driver is not a hand. What
 * it does retire is the narrower and more load-bearing sentence: that the
 * signing which produced every recorded hash was a Node process. After this
 * runs, it is not. The distinction is recorded in §11 rather than smoothed over,
 * because the whole point of that section is that it does not round *unrun* up
 * to *run*.
 *
 * ## Why it is out of CI
 *
 * Same reason as `simulator-stepper.spec.ts`, only more so: this spends eleven
 * testnet fees, calls friendbot twice, and takes several minutes of ledger
 * closes. A gate that costs money and flakes on a public RPC is a gate people
 * learn to ignore. It runs on demand:
 *
 *     npm run e2e -w @limen/web -- account-lifecycle
 *
 * ## The two things it must never do
 *
 * 1. **Never assert a refusal from an absence.** Every deny step here asserts a
 *    hash *and* a decoded contract error code. A transaction that never reached
 *    a ledger is not evidence of a boundary — it is evidence of nothing — and
 *    `WriteResult` draws that case differently precisely so a test can tell.
 * 2. **Never derive a number it should read.** The cap, the rule id, and the
 *    contract address are read off the screen, which read them off the network.
 *    A spec that recomputed them would be this repository agreeing with itself.
 *
 * The `RUN RECORD` line at the end is the machine-readable half: it is what
 * `deployments/testnet.json`'s `browserRun` block is transcribed from, and what
 * `scripts/verify-browser-run.mjs` re-checks against Horizon afterwards — from
 * outside this process, which is the only reason any of it counts.
 */

/** Eleven submissions, each waiting on a ledger close. */
const RUN_TIMEOUT = 1_500_000;

/** One submission: simulate, send, then poll until the ledger closes. */
const SUBMIT_TIMEOUT = 240_000;

const TX_HASH = /^[0-9a-f]{64}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

/** `local-key.ts`. Asserted empty on arrival — "clean profile", as a check. */
const KEY_STORAGE = 'limen.keys.v1';

type Settled =
  | { kind: 'on-ledger'; hash: string }
  | { kind: 'refused'; hash: string; codes: string }
  | { kind: 'not-submitted'; text: string };

/**
 * Wait for the one `WriteResult` inside `scope` to stop running, and say which
 * of its three states it reached.
 *
 * The three are read off the rendered eyebrow rather than off any internal
 * state, because the eyebrow is the thing a person reads and the claim under
 * test is what the screen tells them. Order matters: "on ledger — failed there"
 * contains "on ledger" as a substring, so the failure is matched first.
 */
async function settle(scope: Locator, label: string): Promise<Settled> {
  await expect
    .poll(
      async () => {
        const text = await scope.innerText();
        if (text.includes('on ledger — failed there')) return 'refused';
        if (text.includes('on ledger')) return 'on-ledger';
        if (text.includes('not submitted') || text.includes('stopped at ')) return 'not-submitted';
        return 'running';
      },
      { timeout: SUBMIT_TIMEOUT, message: `${label} never settled` },
    )
    .not.toBe('running');

  const text = await scope.innerText();

  if (text.includes('not submitted') || text.includes('stopped at ')) {
    return { kind: 'not-submitted', text };
  }

  // The full hash lives in the explorer link's `title`; the visible label is
  // truncated. `TxHash` renders no link at all when there is no hash, which is
  // the friendbot case and never the submission case.
  const link = scope.locator('a[href*="/explorer/testnet/tx/"]').last();
  await expect(link, `${label} settled on a ledger without a hash to link`).toBeVisible();
  const hash = ((await link.getAttribute('title')) ?? '').trim();
  expect(hash, `${label} produced a malformed hash`).toMatch(TX_HASH);

  if (text.includes('on ledger — failed there')) {
    const codes = (await scope.locator('dt:text-is("contract codes") + dd').innerText()).trim();
    return { kind: 'refused', hash, codes };
  }
  return { kind: 'on-ledger', hash };
}

/** A settled step that must have succeeded on a ledger. */
async function permitted(scope: Locator, label: string): Promise<string> {
  const result = await settle(scope, label);
  expect(
    result.kind,
    `${label} was expected to succeed on a ledger; got ${result.kind}${
      result.kind === 'not-submitted' ? ` — ${result.text}` : ''
    }`,
  ).toBe('on-ledger');
  return (result as { hash: string }).hash;
}

/**
 * A settled step that must have reached a ledger and failed there, with a
 * decoded contract error.
 *
 * Both halves are the assertion. A failure with no decoded code is the
 * `resourceLimitExceeded` trap `WriteResult` names on screen — it is not
 * attributable to the boundary, and a spec that accepted it would be recording
 * "we ran out of budget" as "the network refused us".
 */
async function refused(
  scope: Locator,
  label: string,
  expectedCode: RegExp,
): Promise<{ hash: string; codes: string }> {
  const result = await settle(scope, label);
  expect(
    result.kind,
    `${label} was expected to fail on a ledger; got ${result.kind}${
      result.kind === 'not-submitted' ? ` — ${result.text}` : ''
    }`,
  ).toBe('refused');
  const { hash, codes } = result as { hash: string; codes: string };
  expect(codes, `${label} reached a ledger but decoded no usable contract code`).not.toBe(
    'none decoded',
  );
  expect(codes, `${label} failed with an unexpected code`).toMatch(expectedCode);
  return { hash, codes };
}

/** The `<section>` whose `<h2>` is `heading`. */
function section(page: Page, heading: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: heading }) });
}

/** The `.panel` whose `<h3>` is `heading` — one `Step` on the policy screen. */
function step(page: Page, heading: string): Locator {
  return page
    .locator('div.panel')
    .filter({ has: page.getByRole('heading', { level: 3, name: heading }) });
}

test('a browser creates an account, installs a boundary, runs an agent inside it, and takes it back', async ({
  page,
}) => {
  test.setTimeout(RUN_TIMEOUT);

  const record: Record<string, string | number> = {};
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [browser console] ${message.text()}`);
  });

  /* --- screen 1: create ---------------------------------------------------
   *
   * §1 transactions 1, 2 and 3. The account signs nothing at deploy — the
   * constructor runs as part of contract creation — so a key generated seconds
   * ago and funded by friendbot is enough, and this screen is where that stops
   * being a claim.
   */

  await page.goto('/app/accounts/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();

  // Clean profile, asserted rather than assumed. Playwright gives each test a
  // fresh context; if that ever stopped being true, a run would silently reuse
  // an existing account and prove nothing about creating one.
  expect(
    await page.evaluate((key) => window.localStorage.getItem(key), KEY_STORAGE),
    'this browser arrived with keys already in it — not a clean profile',
  ).toBeNull();

  /* 01 · generate the two keys */

  const keys = section(page, 'Generate the two keys');
  await keys.getByRole('button', { name: 'Generate keys' }).click();

  // Read off the badges, which read them off `local-key.ts`. The `title`
  // carries the full value; the visible label is truncated.
  const ownerKey = ((await keys.locator('button[title^="G"]').first().getAttribute('title')) ?? '')
    .split('\n')[0]
    .trim();
  const agentKey = ((await keys.locator('button[title^="G"]').nth(1).getAttribute('title')) ?? '')
    .split('\n')[0]
    .trim();

  expect(ownerKey).toMatch(PUBLIC_KEY);
  expect(agentKey).toMatch(PUBLIC_KEY);
  // Decision 2: a demonstration where both keys are the same key demonstrates
  // nothing. `assertDistinctSigners` enforces it inside the write path; this
  // asserts the two the page actually generated are two.
  expect(ownerKey, 'the owner and agent keys are the same key').not.toBe(agentKey);
  record.ownerSigner = ownerKey;
  record.agentSigner = agentKey;

  await expect(keys).toContainText('OWNER');
  await expect(keys).toContainText('AGENT');
  // The disposability sentence, at the moment of creation. It is the whole of
  // what stands in for a recovery flow, so its absence would be a real defect.
  // `NOT_EXPORTABLE`, as it actually reaches the badge — the screen's lede says
  // the same thing in different words and is not what is being checked here.
  await expect(keys).toContainText('Clearing site data destroys it');

  /* 02 · friendbot funds both classic accounts — §1 transactions 1 and 2 */

  const funding = section(page, 'Fund them from friendbot');
  await funding.getByRole('button', { name: 'Fund the owner' }).click();
  await expect
    .poll(async () => (await funding.innerText()).includes('on ledger'), {
      timeout: SUBMIT_TIMEOUT,
      message: 'friendbot never funded the owner',
    })
    .toBe(true);

  await funding.getByRole('button', { name: 'Fund the agent' }).click();
  await expect
    .poll(
      async () => ((await funding.innerText()).match(/on ledger/g) ?? []).length,
      { timeout: SUBMIT_TIMEOUT, message: 'friendbot never funded the agent' },
    )
    .toBeGreaterThanOrEqual(2);

  // The agent paying its own fees is §1's second deliberate shape. If friendbot
  // refused, steps 07 and 08 would silently need an owner-paid fee, which is
  // the exact separation those steps exist to demonstrate.
  await expect(funding, 'friendbot refused one of the two accounts').not.toContainText(
    'not submitted',
  );

  /* 03 · deploy the smart account — §1 transaction 3 */

  const deploySection = section(page, 'Deploy the smart account');
  await deploySection.getByRole('button', { name: 'Deploy the account' }).click();
  record.deployTx = await permitted(deploySection, 'the deploy');

  // Read out of the creation transaction's return value by the page, not
  // derived here from the deployer and salt.
  const created = deploySection.locator('div[data-tone="permitted"]');
  await expect(created).toContainText('the account exists');
  const contractId = ((await created.locator('button[title^="C"]').first().getAttribute('title')) ?? '')
    .split('\n')[0]
    .trim();
  expect(contractId, 'the deploy did not yield a contract address').toMatch(CONTRACT);
  record.smartAccount = contractId;

  await created.getByRole('button', { name: 'Open the account' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/accounts/${contractId}$`));

  /* --- screen 2: observe --------------------------------------------------
   *
   * §1 transactions 4 and 5. The second is the one that matters: the smart
   * account moving its own funds under the constructor's Default rule, which
   * is the transaction the boundary is derived from. "A user performs a
   * transaction once" — executed rather than illustrated.
   */

  await expect(page.getByRole('heading', { level: 1, name: 'Installed boundary' })).toBeVisible();
  await expect(page.getByText('Read at ledger')).toBeVisible({ timeout: 120_000 });

  // A freshly deployed account has exactly the constructor's Default rule, and
  // the owner key in this browser is its signer. If it were not, `AccountWriteSteps`
  // would render its read-only state and there would be no buttons below.
  await expect(page.getByText('Give this account something to derive a boundary from')).toBeVisible();

  const fundAccount = page.locator('div.panel').filter({ hasText: '01 · fund the account' });
  await fundAccount.getByRole('button', { name: 'Fund the account' }).click();
  record.seedTx = await permitted(fundAccount, 'seeding the smart account');

  const observePanel = page.locator('div.panel').filter({ hasText: '02 · the observed transaction' });
  await observePanel.getByRole('button', { name: 'Make the transaction' }).click();
  record.observedTx = await permitted(observePanel, 'the observed transaction');

  await observePanel.getByRole('link', { name: 'Derive a boundary from it' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/policies/new\\?tx=${record.observedTx}&account=${contractId}$`),
  );

  /* --- screen 3: derive, review, install ----------------------------------
   *
   * §1 transaction 6. The cap is read back from the network here — the account
   * screen handed over a hash, not an amount, so what is installed is derived
   * from what the ledger recorded rather than from what the previous screen
   * believed it sent.
   */

  const observed = section(page, 'Observe a transaction');
  await expect(observed).toContainText('(observed on testnet', { timeout: 120_000 });
  await expect(
    observed,
    'the derivation fell back to a shipped fixture instead of the transaction just made',
  ).not.toContainText('shipped fixture — not observed on a live network');
  await expect(observed.locator('dd').first()).toHaveText(String(record.observedTx));

  const derived = section(page, 'Review what Limen derived');
  await expect(derived).toContainText('Context rule');
  await expect(derived, 'synthesis refused the account’s own transfer').not.toContainText(
    'refused to derive',
  );

  const lowered = section(page, 'What would be written to the chain');
  await expect(lowered, 'lowering refused a single native transfer').not.toContainText(
    'not enforceable on-chain',
  );
  await expect(lowered).toContainText('spending limit', { timeout: 120_000 });

  const installSection = section(page, 'Install');
  await expect(installSection).toContainText('signs this install');
  await expect(installSection).toContainText('bounded by it');
  // The sentence that survived from the caveat this screen retired. It is more
  // load-bearing now that something here can sign, not less.
  await expect(installSection).toContainText(
    'There is no form here that accepts a secret key, and there will not be one.',
  );

  await installSection.getByRole('button', { name: 'Install this boundary' }).click();
  record.installTx = await permitted(installSection, 'the install');

  const installed = installSection.locator('div[data-tone="permitted"]');
  await expect(installed).toContainText('installed');
  const ruleText = (await installed.innerText()).match(/Context rule\s+(\d+)/);
  expect(ruleText, 'the install did not report a context rule id').not.toBeNull();
  const ruleId = Number(ruleText![1]);
  record.contextRuleId = ruleId;

  await installed.getByRole('link', { name: 'Open the boundary' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/policies/${contractId}-${ruleId}$`));

  /* --- screen 4: the agent runs, and the owner takes it back --------------
   *
   * §1 transactions 7, 8, the optional seventh axis from F2, 9 and 10. All five
   * are signed by a key in this browser and none of the agent's three carries
   * an owner signature anywhere.
   */

  await expect(
    page.getByRole('heading', { level: 1, name: 'One boundary, and what it turned away' }),
  ).toBeVisible();
  await expect(page.getByText('Read from the ledger')).toBeVisible({ timeout: 120_000 });

  // The cap the network holds, read off the screen that read it off the chain.
  // Recorded rather than asserted against a constant: the claim is that it
  // equals the observed outflow, and `verify-browser-run.mjs` checks that from
  // Horizon rather than this spec checking it against its own arithmetic.
  const capCell = page.locator('dt:text-is("cap") + dd').first();
  if (await capCell.count()) record.cap = (await capCell.innerText()).trim();

  const exercise = section(page, 'Exercise it, then take it back');
  await expect(
    exercise,
    'this browser does not hold the keys this rule names — the run cannot continue',
  ).not.toContainText('read-only from this browser');

  /* 01 · inside the boundary — §1 transaction 7 */

  const inside = step(page, 'Inside the boundary');
  await inside.getByRole('button', { name: 'Spend inside the cap' }).click();
  record.permittedTx = await permitted(inside, 'the agent’s permitted transfer');
  await expect(inside.getByLabel('permitted')).toBeVisible();

  /* 02 · outside it — §1 transaction 8 */

  const outside = step(page, 'Outside it');
  await outside.getByRole('button', { name: 'Try to spend over the cap' }).click();
  const overLimit = await refused(
    outside,
    'the agent’s over-limit transfer',
    /SpendingLimitExceeded/,
  );
  record.refusedTx = overLimit.hash;
  record.refusedError = overLimit.codes;
  await expect(outside.getByLabel('denied')).toBeVisible();

  /* 03 · the agent tries to remove its own boundary — F2's seventh axis */

  const agentRevoke = step(page, 'The agent tries to remove its own boundary');
  await agentRevoke.getByRole('button', { name: 'Try to revoke as the agent' }).click();
  const selfRevoke = await refused(
    agentRevoke,
    'the agent’s attempt to revoke',
    /UnvalidatedContext/,
  );
  record.agentRevokeTx = selfRevoke.hash;
  record.agentRevokeError = selfRevoke.codes;
  await expect(agentRevoke.getByLabel('denied')).toBeVisible();

  /* 04 · the owner takes it back — §1 transaction 9 */

  const revoke = step(page, 'The owner takes it back');
  await revoke.getByRole('button', { name: 'Revoke the boundary' }).click();
  record.revokeTx = await permitted(revoke, 'the revoke');

  /* 05 · the same call, now — §1 transaction 10 */

  const after = step(page, 'The same call, now');
  await after.getByRole('button', { name: 'Repeat the permitted call' }).click();
  const postRevoke = await refused(
    after,
    'the repeated call after revoke',
    /ContextRuleNotFound/,
  );
  record.postRevokeTx = postRevoke.hash;
  record.postRevokeError = postRevoke.codes;

  // F3, and the reason it got its own predicate: a revoked rule is not a
  // boundary refusal. The step must render `rule-revoked`, not `denied` —
  // "the boundary refused you" and "the boundary is gone" are different claims
  // and this is where the screen is required to keep them apart.
  await expect(
    after.getByLabel('the context rule was revoked'),
    'a revoked rule rendered as a boundary refusal — F3’s distinction has collapsed',
  ).toBeVisible();
  await expect(after).toContainText('Not counted as a refusal.');

  /* --- the record --------------------------------------------------------- */

  // Every hash, on one line, so the `browserRun` block is transcribed rather
  // than retyped — and so `verify-browser-run.mjs` can be handed the run it did
  // not produce.
  for (const [key, value] of Object.entries(record)) {
    test.info().annotations.push({ type: key, description: String(value) });
  }
  console.log(`\nRUN RECORD ${JSON.stringify(record)}\n`);
});
