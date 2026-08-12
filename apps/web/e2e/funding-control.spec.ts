import { expect, test, type Page } from '@playwright/test';

/**
 * PLAN-V5 §4: the friendbot control has to disable while it is calling.
 *
 * The fault, found by §2.3's verification pass rather than guessed at: funding
 * went through `use-write`'s `note()` rather than `run()`, and only `run()` sets
 * `busy`. So the button that reads `disabled={!haveKeys || log.busy}` stayed
 * live through its own call, and a second click cost a second friendbot request
 * — which returns "already exists" and is reported as success, so the screen
 * showed a satisfying result for a call that did nothing.
 *
 * ## Why this is an e2e test and not a unit test
 *
 * §1's protocol, step 3, and this is exactly the case it was written about. A
 * control that fails to disable is invisible to a suite that reads source:
 * every file involved is correct on its own. `NewAccountScreen` passes
 * `log.busy` to `disabled`, which is right; `useWriteLog` sets `busy` inside
 * `run`, which is also right. The defect is that the funding path never goes
 * through `run`, and nothing about that is visible without rendering the screen
 * and clicking the button while a request is in flight.
 *
 * ## Hermetic
 *
 * Friendbot is intercepted, so this spends no testnet funds, reaches no
 * network, and does not depend on friendbot being up. The interception is also
 * what makes the assertion possible at all: the window in which the control
 * must be disabled is the duration of the request, so the test owns that
 * duration rather than racing a real one.
 *
 *     npm run e2e -w @limen/web -- funding-control
 */

const FRIENDBOT = 'https://friendbot.stellar.org/**';

/**
 * Hold friendbot open until the returned function is called.
 *
 * Deliberately not a fixed delay. A `setTimeout` in the route handler makes the
 * assertions race a timer — the test would be asserting "disabled within 1.5s"
 * rather than "disabled while the call is in flight", and would go green on a
 * slow machine for the wrong reason. Here the request is released by the test,
 * so the in-flight window is bounded by the assertions inside it and not by the
 * clock.
 */
async function holdFriendbot(page: Page): Promise<{ release: () => void; calls: () => number }> {
  let released = false;
  let calls = 0;

  await page.route(FRIENDBOT, async (route) => {
    calls += 1;
    while (!released) await new Promise((resolve) => setTimeout(resolve, 25));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hash: 'a'.repeat(64) }),
    });
  });

  return { release: () => void (released = true), calls: () => calls };
}

test.describe('the friendbot control while it is calling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/accounts/new', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Generate keys' }).click();
    // The two fund buttons only exist as enabled controls once the keys do.
    await expect(page.getByRole('button', { name: 'Fund the owner' })).toBeEnabled();
  });

  test('disables itself, the other fund control, and the deploy', async ({ page }) => {
    const friendbot = await holdFriendbot(page);

    const owner = page.getByRole('button', { name: 'Fund the owner' });
    const agent = page.getByRole('button', { name: 'Fund the agent' });
    const deploy = page.getByRole('button', { name: 'Deploy the account' });

    await owner.click();

    // All three, not just the one clicked. `busy` is a property of the write
    // log rather than of a button, because these steps share an account and a
    // sequence: funding the agent while the owner's call is open, or deploying
    // before either has landed, are the same class of mistake as clicking the
    // same button twice.
    await expect(owner, 'the clicked fund control should disable while it calls').toBeDisabled();
    await expect(agent, 'the other fund control should disable too').toBeDisabled();
    await expect(deploy, 'deploy should not be reachable mid-fund').toBeDisabled();

    friendbot.release();

    await expect(owner, 'the control should come back when the call lands').toBeEnabled();
    await expect(agent).toBeEnabled();
    await expect(deploy).toBeEnabled();
  });

  test('reports the call in flight rather than staying silent', async ({ page }) => {
    const friendbot = await holdFriendbot(page);

    await page.getByRole('button', { name: 'Fund the owner' }).click();

    // The other half of the same defect. `note()` writes the log entry only
    // once the call has returned, so the row sat at `idle` throughout and the
    // screen said nothing at all while it worked — which is what made a second
    // click look reasonable to a person rather than careless.
    await expect(
      page.getByText('Friendbot funding the owner’s classic account'),
      'the screen should say the friendbot call is running while it runs',
    ).toBeVisible();

    friendbot.release();
  });

  test('a second click during the call does not reach friendbot twice', async ({ page }) => {
    const friendbot = await holdFriendbot(page);

    const owner = page.getByRole('button', { name: 'Fund the owner' });
    await owner.click();
    // `force`, because the point is what happens when the disabled attribute is
    // not what stops it. `use-write` guards on a synchronous ref precisely
    // because a disabled attribute is a hint to a person and two clicks in one
    // tick would both read `busy === false` from state; this asserts the
    // mechanism rather than the hint.
    await owner.click({ force: true });

    expect(
      friendbot.calls(),
      'a second click during the call should not buy a second friendbot request — ' +
        'it returns “already exists” and is reported as success, so the screen shows ' +
        'a result for a call that did nothing',
    ).toBe(1);

    friendbot.release();
  });
});
