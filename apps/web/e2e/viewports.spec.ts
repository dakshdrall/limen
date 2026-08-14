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
 * nothing, and spends no testnet fee.
 *
 *     npm run e2e -w @limen/web -- viewports
 *
 * ## Two of these suites now gate every push
 *
 * The whole file used to sit outside CI, on the accurate but too-broad ground
 * that it shared a `webServer` with the suite that spends testnet funds. What
 * that reasoning actually indicted was the shared server, not these tests — so
 * the server was what got replaced. `playwright.ci.config.ts` boots its own on
 * port 3001 and selects by tag, and the two suites marked `@ci` below run on
 * every push.
 *
 * They are the two that hold up on an unconfigured server: **document
 * overflow** and **column overlap**. The other two stay on demand, for reasons
 * that are theirs rather than the server's — see each.
 *
 * Worth the trouble because the column check found a live defect the first time
 * anything ran it, on a screen no screenshot had ever photographed. A check
 * with that hit rate should not depend on someone remembering it exists.
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
  '/app/try',
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

/**
 * `@ci` — this one is whole on an unconfigured server.
 *
 * It measures the document, and every route renders a document. A screen whose
 * chain read failed lays out its `ScreenState` instead of its table, which is
 * still a layout and still must not pan sideways. Coverage narrows a little
 * without the RPC — a populated table is the likeliest thing to overflow — but
 * nothing here goes vacuous, and the defect that made the suite worth writing
 * was an `sr-only` span, which no read configures away.
 */
test.describe('no page scrolls the body sideways', { tag: '@ci' }, () => {
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

/**
 * Not tagged `@ci`, and this is the one exclusion that is a judgement rather
 * than a constraint.
 *
 * It would work as a gate. It reads one fixture-backed route, needs no RPC, and
 * costs five page loads. What keeps it out for now is that it asserts a
 * sub-pixel identity over rendered text metrics at five widths, and the thing
 * it is most sensitive to is font rasterisation — which is a property of the
 * machine, and a GitHub runner is not the machine it was proven on. Promoting
 * it is a small change and a reasonable one; it wants its own run and its own
 * evidence that 0.5px holds on a runner, rather than being carried in on the
 * back of a suite that was measured.
 */
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

/**
 * The width `scripts/screenshots.mjs` photographed at, kept as the width this
 * assertion was proven at rather than multiplied into five runs of itself.
 *
 * The columns under test are tokenised, so they are the same width at 1440 as at
 * 900 — unlike the document-overflow suite above, whose whole subject is what
 * changes with the viewport. 900 is where the token widths were last shown
 * correct, so 900 is where they stay pinned.
 */
const SHOT_WIDTH = 900;

/**
 * Drives the simulator onto its deny table, which is beat 4.
 *
 * Through the shipped flow, never beat 1 — `perform()` is the only thing in this
 * component that submits, and it is on the other branch. This suite's promise is
 * that it spends no testnet fee, and driving four beats does not change that.
 */
async function simulatorThroughDenyTable(page: Page): Promise<void> {
  await page.goto('/app/simulator', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'simple-transfer' }).click();
  for (const [beat, label] of [
    [2, 'Read the shipped flow'],
    [3, 'Try to exceed it'],
  ] as const) {
    const button = page
      .locator('ol')
      .first()
      .locator('> li')
      .nth(beat - 1)
      .getByRole('button', { name: label });
    await button.waitFor({ state: 'visible', timeout: 30_000 });
    await button.click();
    await page.waitForTimeout(1400);
  }
  await page.locator('table.tbl').filter({ hasText: 'Verdict' }).first().waitFor({ timeout: 30_000 });
}

/**
 * No column is narrower than what it holds.
 *
 * ## Where this came from
 *
 * This is `assertNothingScrolls`, which lived in `scripts/screenshots.mjs` and
 * went when the screenshots did. It is here rather than deleted with them
 * because it was the one thing in that script asserting a property of the
 * application rather than a property of four PNGs.
 *
 * ## What it actually proved, which is less than it sounded like
 *
 * It ran inside a shot's crop, and there were four crops: two sections and two
 * simulator beats. So it covered the tables inside those four regions and no
 * others. **Neither the deny table nor the refusal table was ever in a shot** —
 * the deny table is beat 4 and the manifest photographed beats 3 and 5 — so the
 * two widest tables in `/app` were never under it. Both are covered here.
 *
 * ## Cells, not scroll boxes
 *
 * The distinction the screenshot check could not draw, because in a PNG the two
 * look identical. A `.scroll-x` box that scrolls is the designed answer for a
 * table wider than the column it sits in: at 900px the refusal table is 1088px
 * in an 818px box and the deny table is 928px in a 768px one, both deliberate,
 * both readable by dragging. In a photograph that was a silently cut column,
 * which is what `assertNothingScrolls` was really objecting to — a property of
 * the artefact, and it dies with the artefact.
 *
 * What does not die is the cell case. Under `table-layout: fixed` a cell that
 * cannot fit its contents does not shrink them and does not scroll them; it
 * paints them over the next column. That is a real defect at any width, in a
 * live screen as much as in a picture, and it is what the token block in
 * `globals.css` exists to prevent — `--col-rowhead` was caught at 18ch this way,
 * a 134px heading in a 132px column.
 *
 * `sr-only` is excluded by construction, as it was in the original: the
 * visually-hidden idiom is a 1px box clipped around real text, so it always
 * overflows and always should. Scoping to table cells excludes it.
 */
/**
 * The routes that must have a table to measure no matter how the server is
 * configured — and the reason this suite can be a gate at all.
 *
 * ## The hole this closes
 *
 * The check is a filter over table cells, so a route with no cells contributes
 * nothing and reports no failures. That is indistinguishable, from the outside,
 * from a route that was measured and found clean. On an unconfigured server —
 * which is exactly what `playwright.ci.config.ts` boots — the account detail
 * screen answers `rpc_unconfigured`, renders `read failed`, and lays out no
 * table at all. Measured on the built app: 49 cells with an RPC configured, 0
 * without. Every other route is identical either way.
 *
 * So the naive move, taking this suite into CI as it stood, would have gated
 * the site with a check that silently skipped the one screen where it found a
 * real defect — `--col-rowhead` at 18ch, a 134px heading in a 132px column.
 * A check that passes by finding nothing to look at is the failure this file
 * was written to catch, and it would have been reintroduced by the act of
 * making the file run more often.
 *
 * ## What is listed, and what is deliberately not
 *
 * These four are fixture-backed: they render from shipped recordings and local
 * derivation, so they are populated on any server, and if one of them ever
 * comes up empty something is broken rather than unconfigured. Notably the two
 * widest tables in `/app` are both here — the refusal table and the deny table,
 * the two no screenshot ever reached.
 *
 * The RPC-backed routes are absent by intent, not oversight. Requiring them
 * would mean pointing the gate at a public testnet endpoint and going red
 * whenever that endpoint has a bad afternoon. They keep their coverage in the
 * on-demand suite, which has the RPC and does not run on every push.
 */
const TABLES_EXPECTED_ANYWHERE = [
  '/',
  '/app/policies/new',
  `/app/policies/${ACCOUNT}-${RULE}`,
  '/app/simulator beat 4',
] as const;

test.describe('no table column is narrower than what it holds', { tag: '@ci' }, () => {
  test(`at ${SHOT_WIDTH}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: SHOT_WIDTH, height: 1100 });

    await page.addInitScript((store) => {
      window.localStorage.setItem('limen.v1', JSON.stringify(store));
    }, SEEDED_STORE);

    const overflowing = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll('table.tbl td, table.tbl th')]
          // +1 absorbs the sub-pixel difference between a cell's fractional
          // laid-out width and the integer `scrollWidth` reports.
          .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
          .map((cell) => ({
            tag: cell.tagName.toLowerCase(),
            cls: String(cell.className).slice(0, 48),
            shows: cell.clientWidth,
            needs: cell.scrollWidth,
            text: (cell.textContent ?? '').trim().slice(0, 40),
          })),
      );

    // Every route, then one assertion — so a run names every overlapping column
    // on the site rather than the first one and whatever it hid.
    const found: string[] = [];
    // How many cells each route actually offered up. `found` being empty is
    // only evidence if this is not.
    const measured = new Map<string, number>();
    const collect = async (where: string) => {
      measured.set(
        where,
        await page.evaluate(
          () => document.querySelectorAll('table.tbl td, table.tbl th').length,
        ),
      );
      for (const c of await overflowing()) {
        found.push(
          `${where}: <${c.tag} class="${c.cls}"> shows ${c.shows}px of ${c.needs}px — "${c.text}"`,
        );
      }
    };

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});

      // A table still waiting on its chain read has no rows, and a table with no
      // rows cannot overflow — it would pass this check by being empty, which is
      // the failure mode the account pinning above exists to prevent, arriving
      // by a different route. Where a table is on the page, wait for a row.
      const body = page.locator('table.tbl tbody tr').first();
      if ((await page.locator('table.tbl').count()) > 0) {
        await body.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
      }

      await collect(route);
    }

    // Beat 4, which no shot ever reached.
    await simulatorThroughDenyTable(page);
    await collect('/app/simulator beat 4');

    // Asserted before the overlaps, and the order is the point. If the run went
    // hollow, `found` is empty for a reason that has nothing to do with columns,
    // and reporting "no overlapping columns" first would answer a question this
    // run did not ask.
    const hollow = TABLES_EXPECTED_ANYWHERE.filter((route) => (measured.get(route) ?? 0) === 0);
    expect(
      hollow,
      `nothing was measured on ${hollow.join(', ')} — these routes render from shipped ` +
        'recordings and are populated on any server, so an empty one is a broken page or a ' +
        'broken selector, not a clean one. This suite is a filter over table cells: with no ' +
        'cells it reports no overlaps and passes, which is the failure it exists to catch',
    ).toEqual([]);

    expect(
      found,
      `a column is painting over the one beside it —\n${found.join('\n')}\n` +
        'a fixed-layout cell that cannot fit does not wrap or scroll, it overlaps: ' +
        'give the column a token in globals.css, or widen the one it has',
    ).toEqual([]);
  });
});

/**
 * Not tagged `@ci`, because an unconfigured server is where this one is weakest
 * rather than merely narrower.
 *
 * `NO_DATA_STATES` is the escape hatch that makes the check honest — a screen
 * showing `read failed` has no numbers, so it owes no provenance label. On a
 * server with no RPC every read-backed route takes that branch, so the suite
 * would run green while asking almost nothing: the routes whose labelling is
 * worth pinning are exactly the ones that would answer through the exemption.
 *
 * That is the same hollowing `TABLES_EXPECTED_ANYWHERE` refuses above, and it
 * could be refused the same way. It has not been, because unlike a table cell
 * count there is no cheap census here that separates "labelled" from "excused",
 * and inventing one for the sake of a per-push gate is a bigger change than
 * this commit is. Stays on demand, where the RPC is configured and the
 * exemption is load-bearing for three screens instead of most of them.
 */
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
    // route renders `<main className="screen">` and `/` renders a bare `<main>`.
    //
    // The docs shell used to render neither — it wrapped its sidebar and content
    // column in a plain `<div className="screen">`, so a bare `main` locator did
    // not resolve on `/docs` and this test spent its whole 180s timeout waiting
    // for one. That was recorded here as a real accessibility gap rather than
    // worked around, and it has since been closed: `docs/layout.tsx` now marks
    // its content column `<main>`, so a screen reader jumping to the landmark
    // reaches the prose instead of the navigation.
    //
    // The `.screen` half of this selector is kept anyway. It is what makes the
    // locator a statement about every screen rather than about the screens that
    // currently happen to have a landmark, and it is the reason the gap above
    // was visible from here at all.
    //
    // Scoped to a region rather than widened to `body` on purpose: `body` would
    // let the header's own chrome answer for a screen, and the top bar carries a
    // live ledger reading. The docs shell's sidebar comes along with `.screen`,
    // which is acceptable — it is navigation, and it states no figures.
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
