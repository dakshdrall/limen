import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PLAN-V2 §6.3, the client half.
 *
 * Two prior runs drove `/api/demo/perform` and `/api/ingest` with curl. That
 * evidenced the server path and left the browser untouched, which is where the
 * one interesting piece of state lives: the stepper persists `{version, beat,
 * hash}` to `sessionStorage` and, on resume, re-runs ingest from the stored
 * hash rather than restoring a stored transaction. Nothing derived is
 * persisted, and that is the invariant in §0 — so this test asserts the
 * persisted shape from inside a real browser, not only from Node.
 *
 * What this test is allowed to assume: nothing. It starts from a fresh
 * Playwright context, which is a clean profile — the assertion that
 * `sessionStorage` is empty on arrival is the first thing it does, so a run
 * that somehow inherited state fails rather than passing quietly.
 */

const STORAGE_KEY = 'limen.demo.v1';
const TX_HASH = /^[0-9a-f]{64}$/;

/** The five beats are the only `<ol>` on this page. */
function beat(page: Page, index: number): Locator {
  return page.locator('ol').first().locator('> li').nth(index - 1);
}

async function persisted(page: Page): Promise<unknown> {
  const raw = await page.evaluate((key) => window.sessionStorage.getItem(key), STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

test('completes end to end against live testnet, then resumes from session state', async ({
  page,
}) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Five steps, start to finish' })).toBeVisible();

  // A clean profile, asserted rather than assumed. The stepper writes its
  // initial state on mount, so "clean" is `INITIAL_STATE` rather than an empty
  // slot — what matters is that no hash and no completed beat came with us.
  await expect
    .poll(() => persisted(page))
    .toEqual({ version: 1, beat: 1, hash: null });

  /* --- beat 1: perform, on-chain ---------------------------------------- */

  const one = beat(page, 1);
  await expect(one).toContainText('on-chain');

  // If the deployment has no demo account this button is absent and the beat
  // offers a preset instead. A preset run would prove nothing about testnet,
  // so this fails here rather than sliding into the cheaper path.
  const perform = one.getByRole('button', { name: 'Perform a transaction' });
  await expect(
    perform,
    'beat 1 is not offering to submit — the demo account is unconfigured, and a preset run would not satisfy §6.3',
  ).toBeEnabled();
  await perform.click();

  const hashCell = one.locator('dd').first();
  await expect(hashCell).toHaveText(TX_HASH, { timeout: 120_000 });
  const hash = (await hashCell.innerText()).trim();

  // The explorer link is part of the claim: a reviewer must be able to leave
  // the page and check the transaction exists.
  await expect(one.getByRole('link', { name: 'View on stellar.expert' })).toHaveAttribute(
    'href',
    `https://stellar.expert/explorer/testnet/tx/${hash}`,
  );

  /* --- beat 2: observe, on-chain read ------------------------------------ */

  const two = beat(page, 2);
  await two.getByRole('button', { name: 'Observe it' }).click();

  // Live, and provably not a fixture: the marker and the caveat share one slot
  // in `ObservedSection`, so asserting both directions pins which one rendered.
  await expect(two).toContainText('(observed on testnet', { timeout: 90_000 });
  await expect(two).not.toContainText('shipped fixture — not observed on a live network');

  // The transaction read back is beat 1's own, not a leftover.
  await expect(two.locator('dd').first()).toHaveText(hash);

  const ledger = (await two.locator('dt:text-is("ledger") + dd').innerText()).trim();
  expect(Number(ledger), 'ledger should be a real sequence number').toBeGreaterThan(0);
  // The demo transaction is a single SAC `transfer`, so the movement provably
  // belongs to that invocation. If live meta ever stopped yielding exactly one
  // invocation, this would read "the metadata does not say which call caused
  // them" instead — a real change in what the page claims, not a wording drift.
  await expect(two).toContainText('Token movements');
  await expect(two).toContainText('caused by the single invocation above');
  await expect(two).toContainText('OUT');

  /* --- beat 3: derive, computed locally ---------------------------------- */

  // No click here. A successful observation sets `observed` and advances the
  // beat to 3 in the same handler, so beat 3 derives itself as soon as beat 2
  // lands. The gate that used to sit here could never render and is gone; this
  // assertion keeps it from coming back as dead code.
  const three = beat(page, 3);
  await expect(two.getByRole('button', { name: 'Derive the boundary' })).toHaveCount(0);

  await expect(three).toContainText('computed locally');
  await expect(three).toContainText('Context rule');
  // The count and the heading are separate elements, so innerText joins them
  // with no space.
  await expect(three).toContainText(/Policies\s*\(\d of 5 max\)/);
  await expect(three).toContainText('Rationale');
  // Synthesis refusing here would still render a section, so name the failure.
  await expect(three, 'synthesis refused the demo transaction').not.toContainText('REFUSED');

  /* --- beat 4: the product ------------------------------------------------ */

  const four = beat(page, 4);
  await three.getByRole('button', { name: 'Try to exceed it' }).click();

  // The observed flow permitted, every single-axis mutation refused. This is
  // the claim the whole repository rests on; if it moves, the run is not green.
  await expect(four).toContainText('1 permitted');
  await expect(four).toContainText('6 refused');
  await expect(four.getByRole('alert')).toHaveCount(0);
  await expect(four.getByLabel('permitted')).toHaveCount(1);
  await expect(four.getByLabel('denied')).toHaveCount(6);

  // The caveat that keeps beat 4 from reading as on-chain enforcement.
  // `&rsquo;`, not an ASCII apostrophe — this is the string `caveats.test.ts`
  // pins in the source, asserted here as it actually reaches the screen.
  await expect(four).toContainText('adjudicated by this repository’s evaluator');
  await expect(four).toContainText('Nothing above has been enforced on-chain.');

  /* --- beat 5: the payload ------------------------------------------------ */

  const five = beat(page, 5);
  await four.getByRole('button', { name: 'Read the policy' }).click();

  await expect(five).toContainText('Unsigned payload');
  const xdr = five.locator('pre');
  await expect(xdr).toBeVisible();
  await expect(xdr).not.toHaveText('Building…');
  expect((await xdr.innerText()).trim().length).toBeGreaterThan(100);
  await expect(five).toContainText('nothing here is submitted');

  /* --- the warm-state surface -------------------------------------------- */

  // §0: only the beat index and the hash may survive. A stored proposal, cap,
  // or XDR would be a number on screen that `synthesize()` did not emit on
  // this run. The Node test pins the allowlist; this pins what a real browser
  // actually wrote.
  const state = await persisted(page);
  expect(state).toEqual({ version: 1, beat: 5, hash });
  expect(Object.keys(state as object).sort()).toEqual(['beat', 'hash', 'version']);

  // Reload in the same tab: `sessionStorage` survives, so this is the
  // rehydration path at DemoStepper.tsx:111 plus the resume-observe effect
  // below it. Nothing is clicked after this point.
  await page.reload();

  const oneAfter = beat(page, 1);
  await expect(oneAfter.locator('dd').first()).toHaveText(hash);
  await expect(oneAfter.getByRole('button', { name: 'Perform a transaction' })).toHaveCount(0);

  // Beats 3–5 are recomputed from a re-fetched transaction, not restored.
  const fiveAfter = beat(page, 5);
  await expect(fiveAfter).toContainText('Unsigned payload', { timeout: 90_000 });
  await expect(fiveAfter.locator('pre')).not.toHaveText('Building…');
  await expect(beat(page, 2)).toContainText('(observed on testnet');
  await expect(beat(page, 4)).toContainText('6 refused');

  // Resuming must not have performed a second transaction.
  expect(await persisted(page)).toEqual({ version: 1, beat: 5, hash });

  // Recorded so the run is checkable against an explorer after the fact, which
  // is the only thing that makes "it ran against testnet" more than a claim.
  test.info().annotations.push({ type: 'testnet tx', description: hash });
  test.info().annotations.push({ type: 'ledger', description: ledger });
  console.log(`RUN RECORD hash=${hash} ledger=${ledger}`);
});
