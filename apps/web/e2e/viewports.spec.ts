import { expect, test, type Page } from '@playwright/test';
import recorded from '../../../packages/chain/deployments/testnet.json';

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
 * The detail routes use the recorded **walkthrough** account and its context
 * rule, so those screens render their populated state rather than their empty
 * one. An empty screen is a much easier layout than a table of 56-character
 * addresses, and checking only the easy one would be checking nothing.
 *
 * ## Read from the recording, not typed
 *
 * This was a typed `v4ChainRun` address and a typed `1` until the V6 rebuild,
 * and both had gone stale without anything going red. That run *revokes* its own
 * rule in its last step, so the chain answers "no rule 1" — correctly — and the
 * screen renders its empty state. Worse, refusal evidence is attributed by
 * `recorded-runs.ts` to `walkthrough.smartAccount` alone, so the account that was
 * pinned here could never have shown a refusal table at all. The comment above
 * claimed a populated screen while the test measured an empty one, which is the
 * failure mode this whole file exists to catch, reproduced in the file itself.
 *
 * So it is read from the evidence file, like everything else on the site. A
 * recording that moves to another account or renumbers its rule now moves this
 * suite with it instead of quietly hollowing it out.
 */
const ACCOUNT = recorded.walkthrough.smartAccount;
const RULE = recorded.walkthrough.contextRuleId;

const ROUTES = [
  '/',
  '/docs',
  '/app/accounts',
  '/app/accounts/new',
  '/app/activity',
  '/app/simulator',
  '/app/policies/new',
  `/app/accounts/${ACCOUNT}`,
  `/app/policies/${ACCOUNT}-${RULE}`,
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

/**
 * The refusal table's surface is the table's width, not the section's.
 *
 * ## What this replaced, and why it is not the same test
 *
 * Through V5 this block measured `Exhibit` — the `w-max` container that made the
 * landing's permitted panel and refusal table share both edges on the evidence
 * band. Five cases located `[data-exhibit]` inside `#evidence` on `/`. Step 3 of
 * the V6 rebuild deleted the landing, and `RefusalTable.tsx` records the decision
 * not to carry `Exhibit` forward: `/app` stacks the permitted row above the table
 * inside a `Section`, so there is no second panel to align against and a
 * two-panel edge-sharing test has nothing left to assert.
 *
 * Those five cases were removed rather than re-pointed. Re-pointing them at the
 * policy screen would have kept the name and lost the claim — the two elements
 * there are stacked, not set side by side, and any pair of stacked blocks shares
 * its left and right edges trivially.
 *
 * ## What survived, and does still need measuring
 *
 * `RefusedTable` is `w-max max-w-full` around a `.tbl-fit` table, and that pair
 * is a claim about rendered text metrics that nothing in the CSS enforces —
 * exactly the kind the Node suite cannot make, and the reason the V5 test existed
 * at all. The panel takes the width of its widest child and the table is expected
 * to be that child. If the caption or a prose cell ever outgrew the sum of the
 * column tokens, the panel would size to the prose instead, the table would sit
 * inside it one edge short, and every source file involved would still read
 * correctly.
 *
 * Stated as one identity rather than two regimes, because `w-max max-w-full` is
 * one rule: the panel is the narrower of the table and the space it is given.
 * Above the sum that pins the panel to the table — the stretch this is really
 * about. Below it, the panel stops at the content column and the table keeps its
 * full width and scrolls inside `.scroll-x`, which is the designed answer and
 * the reason the suite above measures overflow on the document rather than here.
 *
 * 1440 is in this list and not in `WIDTHS` because it is the width with slack to
 * give away, and slack is the only place a stretched panel can hide.
 */
const PANEL_WIDTHS = [1440, 1280, 1024, 768, 390] as const;

test.describe('the refusal table sizes its own surface', () => {
  for (const width of PANEL_WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/policies/${ACCOUNT}-${RULE}`, { waitUntil: 'domcontentloaded' });

      // By the table it holds, not by `.scroll-x` alone — the policy screen has
      // other scroll boxes, and a positional selector would pass for the wrong
      // reason the moment one is added above this one.
      //
      // `RefusedTable` renders off `surveyFor()`, a shipped recording, not off
      // the chain read — so this does not depend on the RPC being reachable and
      // does not degrade to the pending state the way the rule panel above it
      // does.
      const panel = page.locator('.scroll-x:has(> table.tbl-fit)');
      const table = panel.locator('> table.tbl-fit');

      // Named separately so deleting the surface fails as "there is no panel"
      // rather than as a timeout on one of its descendants.
      await expect(panel, 'the policy screen should hold exactly one refusal table').toHaveCount(1);

      await expect(table, 'the refusal table should render').toHaveCount(1);

      // Measured in one pass in the page rather than as three `boundingBox()`
      // calls, because the border below has to come from the same element in the
      // same layout as the width it is being subtracted from.
      const m = await panel.evaluate((el) => {
        const inner = el.querySelector(':scope > table');
        const style = getComputedStyle(el);
        return {
          panel: el.getBoundingClientRect().width,
          table: inner === null ? null : inner.getBoundingClientRect().width,
          // The width the panel is *offered*. A panel sized by this rather than
          // by its table is the regression.
          slot: el.parentElement === null ? null : el.parentElement.getBoundingClientRect().width,
          // `.scroll-x` is a bordered box and `boundingBox()` is the border box,
          // so the panel is legitimately its table plus one border on each side.
          // Read rather than written as `2`: the border is a token, and a test
          // that hardcodes its width goes quietly wrong the day the token moves.
          borderX: parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth),
        };
      });

      expect(m.table, 'the refusal table should be a direct child of the panel').not.toBeNull();
      expect(m.slot, 'the panel should have a parent to be bounded by').not.toBeNull();
      if (m.table === null || m.slot === null) return;

      const expected = Math.min(m.table + m.borderX, m.slot);
      const drift = m.panel - expected;

      // Sub-pixel, because the panel and its bound resolve from the same
      // fractional container width and split it the same way twice.
      expect(
        Math.abs(drift),
        `at ${width}px the refusal panel is ${m.panel.toFixed(1)}px where the narrower of its ` +
          `table plus its ${m.borderX}px border (${(m.table + m.borderX).toFixed(1)}px) and its ` +
          `slot (${m.slot.toFixed(1)}px) is ${expected.toFixed(1)}px — a panel wider than its ` +
          'table is the surface stretching to the section, which is the mismatch ' +
          '`w-max max-w-full` exists to remove',
      ).toBeLessThanOrEqual(0.5);
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

    // `main` where there is one, `.screen` where there is not. Every `/app`
    // route renders `<main className="screen">` and `/` renders a bare `<main>`,
    // but the docs shell wraps its sidebar and content column in a plain
    // `<div className="screen">` — so a bare `main` locator does not resolve on
    // `/docs` and this test spent its whole 180s timeout waiting for one.
    //
    // Scoped to a region rather than widened to `body` on purpose: `body` would
    // let the header's own chrome answer for a screen, and the top bar carries a
    // live ledger reading. The docs shell's sidebar comes along with `.screen`,
    // which is acceptable — it is navigation, and it states no figures.
    //
    // That missing landmark is a real gap and is not this file's to close: the
    // docs pages are the only ones on the site with no `main` landmark, so a
    // screen reader lands in the sidebar. Fixing it belongs in `docs/layout.tsx`.
    const text = await page.locator('main, .screen').first().innerText();
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
