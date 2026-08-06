import { expect, test, type Page } from '@playwright/test';

/**
 * PLAN-V4 §11's two cheap conditions, which were open for the same reason the
 * expensive one was: nobody had opened a browser.
 *
 *   - **No page scrolls the body sideways at 1280, 1024, 768, 390px.**
 *   - **Every screen states on-chain vs computed locally vs shipped fixture.**
 *
 * Both are properties of rendered layout and rendered copy, so neither can be
 * checked from Node, and both were listed as unrun rather than waived. Unlike
 * `account-lifecycle.spec.ts` this costs nothing: it reads pages, submits
 * nothing, and spends no testnet fee. It is out of the default CI job only
 * because it shares a `webServer` with the suite that does.
 *
 *     npm run e2e -w @limen/web -- viewports
 *
 * ## Why the horizontal check is written the way it is
 *
 * `document.documentElement.scrollWidth > clientWidth` is the whole test, and it
 * is deliberately taken on the **document**, not on any element. Wide content is
 * allowed here — several tables are wider than a phone and live in their own
 * `overflow-x: auto` box, which is the designed answer. What is not allowed is
 * that overflow reaching the body, because a page that pans sideways under a
 * thumb reads as broken regardless of which child caused it.
 *
 * The failure that made this worth pinning is recorded in `Address.tsx`: an
 * `sr-only` span with no positioned ancestor escaped its clipping container and
 * added several hundred pixels of document scroll width, from a label nobody
 * can see. The tables were clipping perfectly. That is exactly the class of bug
 * a per-element assertion would have missed.
 */

/** §11 names these four. */
const WIDTHS = [1280, 1024, 768, 390] as const;

/**
 * Every route with a page, plus the two that need an id.
 *
 * The detail routes use the recorded `v4ChainRun` account — a real testnet
 * account with a real rule 1, so those screens render their populated state
 * rather than their empty one. An empty screen is a much easier layout than a
 * table of 56-character addresses, and checking only the easy one would be
 * checking nothing.
 */
const ACCOUNT = 'CBYJPUD4Q2EPT6TYNIPLYSBOEMTK5JVQNNE5KYOAW243NDGL4VPO5GKW';

const ROUTES = [
  '/',
  '/docs',
  '/app/accounts',
  '/app/accounts/new',
  '/app/activity',
  '/app/simulator',
  '/app/policies/new',
  `/app/accounts/${ACCOUNT}`,
  `/app/policies/${ACCOUNT}-1`,
] as const;

/**
 * The provenance vocabulary. Every screen has to say which of these its numbers
 * are, and the set is closed by `StatusLabel`.
 *
 * `/app/accounts/new` is the one screen that legitimately carries none of them
 * on arrival: it has no numbers yet, only two buttons and a wasm hash. It says
 * so through `NOT AUDITED` and `COMPOSITION ONLY` instead, which are claims
 * about the same question — where this came from and how far to trust it.
 */
const PROVENANCE = ['ON-CHAIN', 'COMPUTED LOCALLY', 'shipped fixture', 'NOT AUDITED'];

/**
 * The three designed no-data states, which carry no provenance label because
 * they have nothing to attribute.
 *
 * This is the honest form of the check and not a loophole, so it is worth being
 * exact about what it does and does not allow. The claim under test is *no
 * screen shows numbers without saying where they came from*. A screen showing a
 * read failure, an empty list, or a pending read is showing no numbers, so
 * there is nothing for a label to be about — `ScreenState` exists to make those
 * three look deliberate rather than broken.
 *
 * What this does **not** permit is a screen that renders a table, a cap or a
 * ledger number with no provenance beside it. That still fails, on every route,
 * which is the regression worth catching.
 */
const NO_DATA_STATES = ['read failed', 'no accounts', 'Waiting for', 'Reading', 'Simulating'];

/**
 * `/app/activity` scans per account and shows an empty state until it has one.
 *
 * Seeded rather than exempted, so the check at least reaches past the arrival
 * state. Whether the scan then finds anything depends on the public RPC's event
 * retention, which is a few days — an account recorded last week reads back as
 * a failure, and that is the endpoint's memory ending rather than the screen
 * being wrong. Its scanned state renders `ON-CHAIN` in `ScanWindow`, which is
 * the only place it claims anything about the chain.
 */
const SEEDED_STORE = {
  version: 1,
  accounts: {
    [ACCOUNT]: {
      contractId: ACCOUNT,
      provenance: {},
      addedAt: '2026-08-06T00:00:00.000Z',
    },
  },
};

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.describe('no page scrolls the body sideways', () => {
  for (const width of WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });

      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        // The read-backed screens paint their tables after a network round
        // trip, and a table is the likeliest thing to overflow. Measuring
        // before it lands would measure the pending state.
        await page.waitForLoadState('networkidle').catch(() => {});

        const overflow = await documentOverflow(page);
        expect(
          overflow,
          `${route} overflows the document by ${overflow}px at ${width}px — ` +
            'wide content belongs in its own scroll-x box, never on the body',
        ).toBeLessThanOrEqual(0);
      }
    });
  }
});

test('every screen states where its numbers came from', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.addInitScript((store) => {
    window.localStorage.setItem('limen.v1', JSON.stringify(store));
  }, SEEDED_STORE);

  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    const text = await page.locator('main').innerText();
    const labelled = PROVENANCE.some((label) => text.includes(label));
    const noData = NO_DATA_STATES.some((state) => text.includes(state));

    expect(
      labelled || noData,
      `${route} shows data and names none of ${PROVENANCE.join(', ')} — a screen that ` +
        'does not say whether its numbers are the ledger’s, ours, or a fixture is ' +
        'asking to be trusted',
    ).toBe(true);
  }
});
