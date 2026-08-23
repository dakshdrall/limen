import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PLAN-V8's *"NOT RUN: the demo itself"*, driven end to end.
 *
 * `agent-builder.spec.ts` closed the seam where a browser deploys an agent. It
 * stopped there, and the section it left behind said so plainly: everything
 * about the chat was *"the chat working as software"*, and what had not
 * happened was one person talking to one deployed agent and watching the
 * refusals arrive against a live ledger. It named the blocker exactly —
 * `agent_keys` held no rows, so no agent anywhere had a server-held signer, and
 * the one existing `agents` row predates `0003`.
 *
 * This file is that conversation. It deploys a **fresh** agent — never the
 * existing row, which is the whole point of the blocker — and then talks to it.
 *
 * ## What it is
 *
 * A real Chromium with a virtual authenticator over CDP, a real `next start`, a
 * real `apps/runtime` on the other end of `LIMEN_RUNTIME_URL`, a real Neon, a
 * real Upstash and live testnet. `page.route` appears nowhere in this file.
 * The model call is real too: `chat.ts` asks Opus which tool a sentence wants,
 * so *"pay 20 XLM to G…"* becomes `send_payment` with a stroop count Claude
 * converted, and a run without `ANTHROPIC_API_KEY` fails here rather than
 * skipping.
 *
 * ## The four messages, and why the third and fourth are both refusals
 *
 * | # | message | outcome | evidence |
 * |---|---|---|---|
 * | 1 | what's my balance | `succeeded` | none — a read moves nothing |
 * | 2 | pay 20 XLM to the approved address | `succeeded` | a hash |
 * | 3 | pay 200 XLM to the same address | `refused_by_network` | a hash, and `#3221` |
 * | 4 | pay 1 XLM to an address nobody approved | `refused_by_limen` | none, and none is missing |
 *
 * Rows three and four are the pair this whole repository is arranged around,
 * and they are two different refusals rather than one refusal twice.
 *
 * **Three is the network's.** `gate.ts` refuses only what the network cannot
 * see, and it argues the case in its own header: a gate that pre-empted the cap
 * would turn the product's central demonstration into Limen's opinion, and
 * *"a refusal that never reached a ledger is evidence of nothing"* would then
 * describe Limen's own behaviour. So an over-cap payment is **submitted**, the
 * spending-limit policy refuses it inside `__check_auth`, and the refusal comes
 * back with a transaction hash anyone can look up. That is strictly stronger
 * than a local veto, and this spec asserts the hash rather than accepting its
 * absence.
 *
 * **Four is Limen's.** No audited on-chain primitive expresses a recipient
 * allowlist, so `recipient_not_allowed` is computed locally, nothing is sent,
 * and there is no hash — which §4.4 requires to be stated as a finding rather
 * than rendered as a blank field. It also carries `ledgerWould: 'permit'`: the
 * ledger would have allowed this, and the limit is Limen's alone. A run where
 * three and four came back wearing the same badge would be the one failure this
 * project cannot ship.
 *
 * ## Why the per-payment ceiling is deliberately left empty
 *
 * This is load-bearing and will look like an omission otherwise. The builder
 * offers a per-payment ceiling under *"Enforced by Limen"*, and once the gate
 * enforces it, any ceiling below 200 XLM would intercept message three **before
 * it reached the network** — turning row three from `refused_by_network` with a
 * hash into `refused_by_limen` with none, and silently deleting the strongest
 * evidence in the file. The two ceilings are different instruments:
 *
 *   - the **cap** is the boundary, installed on the account, enforced by the
 *     spending-limit policy contract, and a refusal by it has a hash;
 *   - the **per-payment ceiling** is Limen's, computed locally, and a refusal
 *     by it never reaches a ledger.
 *
 * A payment can be refused by either, for different reasons, and this spec
 * exercises the first. The ceiling is left unset so that the network is the
 * only thing standing between message three and a ledger.
 *
 * ## The traps, inherited from `agent-builder.spec.ts`
 *
 * 1. **Never assert from the screen alone.** Every outcome is re-read from the
 *    `turns` row in Postgres, over a connection this process opens itself. The
 *    screen is asserted too — it is what a person sees — but the `outcome`
 *    column is the claim, and `resultJson` is where the hash and the constraint
 *    are checked.
 * 2. **Never assert a chain fact from a hash.** The 20 XLM payment is not
 *    proved by a transaction id. It is proved by the balance falling by exactly
 *    20 XLM, read back through `get_balance` afterwards.
 * 3. **Never let the model's absence become a skip.** `ANTHROPIC_API_KEY` is
 *    required. Without it `decideChatTurn` degrades and no tool is ever called,
 *    and a run that passed that way would have asserted nothing.
 *
 * ## Why it is out of CI
 *
 * It spends real testnet fees, it needs a running `apps/runtime`, and it needs
 * credentials a GitHub runner does not have. Untagged, so
 * `playwright.ci.config.ts`'s `grep: /@ci/` cannot reach it by construction.
 * From `apps/web`, with `.env.m1` exported and the runtime up:
 *
 *     npx playwright test e2e/agent-chat.spec.ts
 *
 * `localhost` rather than `127.0.0.1`, for the reason `agent-builder.spec.ts`
 * gives: an RP ID must be a registrable domain and an IP literal is not one, so
 * `navigator.credentials.create` fails on the IP before any authenticator is
 * consulted.
 */

test.use({ baseURL: 'http://localhost:3000' });

/** A deploy, then four turns, two of which submit and wait for a ledger. */
const RUN_TIMEOUT = 1_800_000;
const SUBMIT_TIMEOUT = 240_000;

/** One turn: an Opus call, then a tool that may submit and poll for a close. */
const TURN_TIMEOUT = 300_000;

const TX_HASH = /^[0-9a-f]{64}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

const KEY_STORAGE = 'limen.keys.v1';
const PASSKEY_STORAGE = 'limen.passkey.v1';

/**
 * What this run needs, and what it refuses to pretend about.
 *
 * `LIMEN_RUNTIME_URL` is here because its absence has a *designed* failure mode
 * that looks like a passing test from the outside: `runtime-client.ts` returns
 * `unavailable` and the chat says so politely. That is correct behaviour and it
 * is not this run. `ANTHROPIC_API_KEY` is here for the mirror-image reason —
 * without it the model never chooses a tool, so nothing below would execute.
 */
const REQUIRED = ['DATABASE_URL', 'LIMEN_RUNTIME_URL', 'ANTHROPIC_API_KEY'] as const;

const DESCRIPTION = 'an agent that pays one approved supplier, up to 50 XLM a day';
const AGENT_NAME = 'Supplier payer (chat e2e)';

/**
 * The cap: 50 XLM a day, and the number is chosen so that both payments below
 * are decided by *this* rule rather than by anything incidental.
 *
 * 20 XLM is comfortably under it, so message two is permitted by the boundary.
 * 200 XLM is four times it, so message three is refused by the boundary. Both
 * are checked against `CAP_UNITS` written out rather than computed, for the
 * reason `agent-builder.spec.ts` gives: `headroom_bps = 10000` means the cap
 * stored is the cap typed, and asserting a re-derivation would be this
 * repository agreeing with itself.
 */
const CAP_DECIMAL = '50';
const CAP_UNITS = '500000000';
const ASSET_LABEL = 'XLM';
const ASSET_DECIMALS = '7';

/** `WINDOW_OPTIONS.daily` and `EXPIRY_OPTIONS['7d']`, as the contract counts them. */
const WINDOW_LEDGERS = 17_280;
const EXPIRY_LEDGERS = 7 * 17_280;

/** 1 XLM. Every amount in this file is stroops, because the tool's are. */
const XLM = 10_000_000n;

const PERMITTED_XLM = 20n;
const OVER_CAP_XLM = 200n;
const STRANGER_XLM = 1n;

/**
 * The addresses, read out of the recorded deployments rather than typed here.
 *
 * `deployments/testnet.json` is this repository's record of what exists on
 * testnet, and an address retyped into a spec is the class of claim it exists
 * to prevent. The token is read the same way and then checked against
 * `send_payment`'s own choice: the tool hardcodes `nativeTokenId`, and a
 * boundary installed on any other contract would be refused as
 * `asset_not_authorized` before a single payment was attempted. Asserting the
 * two agree turns that from a coincidence into a check.
 */
interface RecordedDeployments {
  walkthrough: { token: string; ownerSigner: string };
  liveDerivation: { token: string };
  v4ChainRun: { token: string; ownerSigner: string };
}

function recordedDeployments(): RecordedDeployments {
  const path = join(__dirname, '../../../packages/chain/deployments/testnet.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RecordedDeployments;
}

type Settled =
  | { kind: 'on-ledger'; hash: string }
  | { kind: 'refused'; hash: string; codes: string }
  | { kind: 'not-submitted'; text: string };

/** `agent-builder.spec.ts`'s reader, for the deploy half. Order matters. */
async function settle(page: Page, what: string): Promise<Settled> {
  const scope = page.locator('div.panel').filter({ hasText: what }).last();

  await expect
    .poll(
      async () => {
        if ((await scope.count()) === 0) return 'running';
        const text = await scope.innerText();
        if (text.includes('on ledger — failed there')) return 'refused';
        if (text.includes('on ledger')) return 'on-ledger';
        if (text.includes('not submitted') || text.includes('stopped at ')) return 'not-submitted';
        return 'running';
      },
      { timeout: SUBMIT_TIMEOUT, message: `"${what}" never settled` },
    )
    .not.toBe('running');

  const text = await scope.innerText();
  if (text.includes('not submitted') || text.includes('stopped at ')) {
    return { kind: 'not-submitted', text };
  }

  const link = scope.locator('a[href*="/explorer/testnet/tx/"]').last();
  const hash = (await link.count()) === 0 ? '' : ((await link.getAttribute('title')) ?? '').trim();

  if (text.includes('on ledger — failed there')) {
    const codes = (await scope.locator('dt:text-is("contract codes") + dd').innerText()).trim();
    return { kind: 'refused', hash, codes };
  }
  return { kind: 'on-ledger', hash };
}

async function landed(page: Page, what: string): Promise<string> {
  const result = await settle(page, what);
  expect(
    result.kind,
    `"${what}" was expected to succeed on a ledger; got ${result.kind}${
      result.kind === 'not-submitted' ? ` — ${result.text}` : ''
    }${result.kind === 'refused' ? ` — ${result.codes}` : ''}`,
  ).toBe('on-ledger');
  const { hash } = result as { hash: string };
  expect(hash, `"${what}" landed without a usable transaction hash`).toMatch(TX_HASH);
  return hash;
}

async function addressIn(scope: Locator, prefix: string): Promise<string> {
  const button = scope.locator(`button[title^="${prefix}"]`).first();
  await expect(button, `no ${prefix}… address rendered here`).toBeVisible();
  return ((await button.getAttribute('title')) ?? '').split('\n')[0]!.trim();
}

function group(page: Page, heading: string): Locator {
  return page.getByRole('heading', { level: 3, name: heading }).locator('xpath=ancestor::section[1]');
}

/* --- what Postgres holds -------------------------------------------------- */

/**
 * The `turns` row, read by this process rather than reported by the app.
 *
 * `status` and `outcome` are two columns because they are two facts, and this
 * spec depends on the distinction: a refused turn is **done**, not failed. The
 * outcome word is the claim every assertion below is really making.
 */
async function readTurnRow(turnId: string): Promise<{
  status: string;
  outcome: string | null;
  result_json: Record<string, unknown> | null;
  channel: string;
}> {
  const sql = neon(process.env.DATABASE_URL ?? '');
  const rows = (await sql`
    select status, outcome, result_json, channel from turns where id = ${turnId}
  `) as unknown as {
    status: string;
    outcome: string | null;
    result_json: Record<string, unknown> | null;
    channel: string;
  }[];
  expect(rows.length, `no turns row with id ${turnId}`).toBe(1);
  return rows[0]!;
}

/**
 * The account that will pay this agent's fees, resolved the way the runtime
 * resolves it.
 *
 * `agent_fee_account` is nullable and nothing writes it today. That is not an
 * oversight: `store.ts` reads `row.feeAccount ?? row.agentPublicKey`, because
 * the agent signs its own fee envelope and the deploy funds that address with
 * friendbot precisely so it can pay. This spec deliberately repeats the
 * fallback rather than reading one column — an assertion against
 * `agent_fee_account` alone fails on every correctly deployed agent, which is
 * how the first run of this file failed.
 */
async function readFeeAccount(agentId: string): Promise<string> {
  const sql = neon(process.env.DATABASE_URL ?? '');
  const rows = (await sql`
    select agent_fee_account, agent_public_key from agent_accounts where agent_id = ${agentId}
  `) as unknown as { agent_fee_account: string | null; agent_public_key: string }[];
  expect(rows.length, 'agent_accounts has no row for this agent').toBe(1);
  const fee = rows[0]!.agent_fee_account ?? rows[0]!.agent_public_key;
  expect(fee, 'neither a fee account nor an agent key is recorded for this agent').toMatch(PUBLIC_KEY);
  return fee;
}

/**
 * Friendbot, and only if it is needed.
 *
 * The deploy already funds the fee account, so this is a guard rather than a
 * step: an unfunded fee account makes every write fail as an infrastructure
 * error, which would read as an outage rather than as the setup problem it is.
 * A friendbot that refuses because the account already exists is success here,
 * not failure — that is the state this function wants.
 */
async function fundIfNeeded(address: string): Promise<'already-funded' | 'funded'> {
  const horizon = `https://horizon-testnet.stellar.org/accounts/${address}`;
  const existing = await fetch(horizon);
  if (existing.ok) return 'already-funded';

  const response = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  expect(
    response.ok,
    `friendbot would not fund ${address} (HTTP ${response.status}), so the agent cannot pay a fee`,
  ).toBe(true);
  return 'funded';
}

/* --- the conversation ----------------------------------------------------- */

interface TurnOnScreen {
  turnId: string;
  tool: string;
  entry: Locator;
}

/**
 * Type a message, send it, and return the turn the runtime accepted.
 *
 * The POST's body is what says whether the model chose a tool at all. A message
 * that came back as `text` or `agent_error` never reached the runtime, and
 * failing here names that — rather than letting a later locator time out
 * against a screen that is behaving perfectly.
 */
async function say(page: Page, agentId: string, message: string, index: number): Promise<TurnOnScreen> {
  const accepted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/agents/${agentId}/chat` &&
      response.request().method() === 'POST',
    { timeout: TURN_TIMEOUT },
  );

  await page.locator('#chat-message').fill(message);
  await page.getByRole('button', { name: 'Send' }).click();

  const response = await accepted;
  const body = (await response.json()) as Record<string, unknown>;

  expect(
    body.kind,
    `"${message}" did not become a tool call: ${JSON.stringify(body).slice(0, 300)}`,
  ).toBe('turn');
  expect(response.status()).toBe(202);

  // Entries are appended in pairs — the user's bubble, then the turn — so the
  // turn for message n is at 2n-1. Deterministic because the arm above is
  // already asserted to be `turn`; a `text` reply would have shifted it.
  const entry = page.locator('div[role="log"] > div').nth(2 * index - 1);
  await expect(entry, 'the turn did not render on screen').toContainText(String(body.tool));

  return { turnId: String(body.turnId), tool: String(body.tool), entry };
}

/**
 * Wait for a turn to finish, from the database, and hand back both halves.
 *
 * The row is the authority on when a turn is done — the screen finds out a
 * second later by polling — so it is what is waited on. The screen is then
 * waited on separately, because what it renders is a claim this spec also has
 * to check.
 */
async function finished(
  page: Page,
  turn: TurnOnScreen,
): Promise<{ row: Awaited<ReturnType<typeof readTurnRow>>; panel: Locator }> {
  await expect
    .poll(async () => (await readTurnRow(turn.turnId)).status, {
      timeout: TURN_TIMEOUT,
      intervals: [2_000],
      message: `turn ${turn.turnId} (${turn.tool}) never reached done`,
    })
    .toBe('done');

  const panel = turn.entry.locator('div.panel');
  await expect
    .poll(async () => (await panel.innerText()).includes('Working. This is a real transaction'), {
      timeout: 60_000,
      intervals: [1_000],
      message: 'the screen never stopped saying it was working',
    })
    .toBe(false);

  return { row: await readTurnRow(turn.turnId), panel };
}

/* --- the run -------------------------------------------------------------- */

test('a person talks to a freshly deployed agent, and is refused twice, differently', async ({
  page,
  context,
}) => {
  test.setTimeout(RUN_TIMEOUT);

  const missing = REQUIRED.filter((name) => (process.env[name] ?? '').length === 0);
  expect(
    missing,
    `set ${missing.join(', ')} before running this suite. It deploys an agent, talks to it through ` +
      'a real model, and reads every outcome back out of Postgres; each of those three needs one of ' +
      'these, and a run without them would assert nothing while looking green.',
  ).toEqual([]);

  const record: Record<string, unknown> = {};
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [browser console] ${message.text()}`);
  });

  const deployments = recordedDeployments();
  const TOKEN = deployments.walkthrough.token;
  const RECIPIENT = deployments.walkthrough.ownerSigner;
  const STRANGER = deployments.v4ChainRun.ownerSigner;

  expect(
    [deployments.walkthrough.token, deployments.liveDerivation.token, deployments.v4ChainRun.token],
    'the recorded runs disagree about which token they used',
  ).toEqual([TOKEN, TOKEN, TOKEN]);
  expect(TOKEN, 'the recorded token is not a contract address').toMatch(CONTRACT);
  expect(RECIPIENT, 'the recorded owner signer is not an account address').toMatch(PUBLIC_KEY);
  expect(STRANGER, 'the stand-in stranger is not an account address').toMatch(PUBLIC_KEY);
  expect(
    STRANGER,
    'the approved recipient and the unapproved one are the same address, so message four proves nothing',
  ).not.toBe(RECIPIENT);
  record.token = TOKEN;
  record.recipient = RECIPIENT;
  record.stranger = STRANGER;

  /* --- 1: register, and deploy a fresh agent ------------------------------
   *
   * Fresh, and never the existing row. That row predates `0003` and has no
   * `agent_keys` entry, so `agentForTurn`'s inner join finds nothing and every
   * turn against it 404s at the runtime — which is exactly the blocker
   * PLAN-V8's NOT RUN section named.
   */

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      defaultBackupEligibility: false,
      defaultBackupState: false,
    },
  });

  await page.goto('/app/agents/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Deploy an agent' })).toBeVisible();

  const storage = await page.evaluate(
    ([keys, passkey]: [string, string]) => ({
      keys: window.localStorage.getItem(keys),
      passkey: window.localStorage.getItem(passkey),
    }),
    [KEY_STORAGE, PASSKEY_STORAGE] as [string, string],
  );
  expect(storage.keys, 'this browser arrived with signing keys in it — not a clean profile').toBeNull();
  expect(storage.passkey, 'this browser arrived with a passkey in it — not a clean profile').toBeNull();

  await expect(
    page.getByRole('heading', { level: 3, name: 'Sign in to deploy an agent' }),
    'the builder did not render its signed-out state — check /api/auth/session and DATABASE_URL',
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Dismiss' }).click();

  const session = (await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    return (await response.json()) as { user: { id?: string } | null };
  })) as { user: { id?: string } | null };
  expect(session.user, 'registering did not produce a session').not.toBeNull();
  record.userId = session.user?.id;

  await expect(page.getByRole('heading', { level: 2, name: 'Describe the agent' })).toBeVisible();
  await page.getByLabel('What the agent should be able to do').fill(DESCRIPTION);

  const [, createResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/agents/generate')),
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/agents' && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Generate the limits' }).click(),
  ]);

  const created = (await createResponse.json()) as { agent: { id: string; status: string } };
  expect(createResponse.status()).toBe(200);
  expect(created.agent.status, 'the row was not written as a DRAFT').toBe('DRAFT');
  const agentId = created.agent.id;
  record.agentId = agentId;

  /* --- 2: the limits this conversation is about ---------------------------
   *
   * Every field is filled rather than accepted from the draft. This run has a
   * model behind it, so `/api/agents/generate` may well have proposed
   * something — and a spec whose two payments are decided by numbers a model
   * chose is a spec that asserts nothing stable. What is typed here is what the
   * boundary is checked against below.
   */

  await expect(page.getByRole('heading', { level: 2, name: 'Review the limits' })).toBeVisible();

  await page.locator('#agent-name').fill(AGENT_NAME);
  await page.locator('#agent-asset').fill(TOKEN);
  await page.locator('#agent-asset-label').fill(ASSET_LABEL);
  await page.locator('#agent-asset-decimals').fill(ASSET_DECIMALS);
  await page.locator('#agent-cap').fill(CAP_DECIMAL);
  await page.locator('#agent-window').selectOption('daily');
  await page.locator('#agent-expiry').selectOption('7d');
  await page.locator('#agent-recipients').fill(RECIPIENT);

  // Empty, and asserted empty. See the header: a ceiling below 200 XLM would
  // intercept message three before it reached the network, and the strongest
  // piece of evidence in this file would disappear without anything failing.
  await page.locator('#agent-per-transaction').fill('');
  await expect(
    page.locator('#agent-per-transaction'),
    'a per-payment ceiling is set, which would refuse message three locally instead of on a ledger',
  ).toHaveValue('');

  const enforcedByLimen = group(page, 'Enforced by Limen');
  await expect(enforcedByLimen).toContainText('The ledger does not enforce these.');

  const [configureResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/agents/${agentId}/configure`)),
    page.getByRole('button', { name: 'Accept these limits' }).click(),
  ]);

  const configured = (await configureResponse.json()) as {
    agent: { status: string };
    proposal: { contextRule: { validFromLedger: number } };
    plan: {
      rules: {
        contract: string;
        validUntilLedger: number | null;
        policies: { kind: string; asset: string; limit: string; windowLedgers: number }[];
      }[];
    };
    config: { enforcedOffChain: { perTransactionCap: string | null; recipients: string[] } };
  };
  expect(
    configureResponse.status(),
    `configure refused: ${JSON.stringify(configured).slice(0, 400)}`,
  ).toBe(200);
  expect(configured.agent.status).toBe('CONFIGURED');

  const planned = configured.plan.rules[0]!;
  expect(configured.plan.rules.length, 'the plan does not describe exactly one context rule').toBe(1);
  expect(planned.contract, 'the boundary was derived against a different token').toBe(TOKEN);
  expect(planned.policies[0]!.limit, 'the derived cap is not the cap that was typed').toBe(CAP_UNITS);
  expect(planned.policies[0]!.windowLedgers).toBe(WINDOW_LEDGERS);
  expect(
    planned.validUntilLedger! - configured.proposal.contextRule.validFromLedger,
    'the rule does not expire the number of ledgers the form asked for',
  ).toBe(EXPIRY_LEDGERS);

  // The two halves of the off-chain config, as the *server* validated them.
  // The empty ceiling is checked here as well as on the form, because this is
  // the value that reaches `policies.enforced_offchain_json` and therefore the
  // gate.
  expect(
    configured.config.enforcedOffChain.perTransactionCap,
    'the server recorded a per-payment ceiling this run deliberately left unset',
  ).toBeNull();
  expect(configured.config.enforcedOffChain.recipients).toEqual([RECIPIENT]);
  record.capUnits = planned.policies[0]!.limit;

  /* --- 3: deploy ---------------------------------------------------------- */

  const deployedResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/agents/${agentId}/deployed`) &&
      response.request().method() === 'POST',
    { timeout: RUN_TIMEOUT },
  );

  await page.getByRole('button', { name: 'Deploy this agent' }).click();

  for (const who of ['owner', 'agent'] as const) {
    const result = await settle(page, `Friendbot funding the ${who}`);
    expect(
      result.kind,
      `friendbot did not submit for the ${who}'s classic account: ${JSON.stringify(result)}`,
    ).not.toBe('not-submitted');
  }

  record.deployTx = await landed(page, 'Creating the smart account');
  record.seedTx = await landed(page, 'Funding the smart account');
  record.installTx = await landed(page, 'Installing the boundary');

  const deployedResponse = await deployedResponsePromise;
  const recorded = (await deployedResponse.json()) as {
    agent: { status: string };
    verified: { contextRuleId: number; contract: string | null; limit: string };
  };
  expect(
    deployedResponse.status(),
    `the deployment was not recorded: ${JSON.stringify(recorded).slice(0, 400)}`,
  ).toBe(200);
  expect(recorded.agent.status).toBe('ACTIVE');
  expect(recorded.verified.contract, 'the installed rule authorizes a different token').toBe(TOKEN);
  expect(recorded.verified.limit, 'the installed cap is not the reviewed cap').toBe(CAP_UNITS);
  record.contextRuleId = recorded.verified.contextRuleId;

  const deployedPanel = page.locator('div[data-tone="permitted"]').filter({
    hasText: 'deployed, and read back',
  });
  await expect(deployedPanel).toBeVisible({ timeout: 60_000 });
  const smartAccount = await addressIn(deployedPanel, 'C');
  expect(smartAccount).toMatch(CONTRACT);
  record.smartAccount = smartAccount;

  // The server-held key, which is the thing the existing agent row does not
  // have and the reason this run deploys a new one. Asserted before a single
  // message is sent, because without it every turn below 404s at the runtime
  // and the failure would read as a routing problem.
  const sql = neon(process.env.DATABASE_URL ?? '');
  const keyRows = (await sql`
    select algorithm from agent_keys where agent_id = ${agentId}
  `) as unknown as { algorithm: string }[];
  expect(
    keyRows.length,
    'this agent has no agent_keys row, so the runtime cannot open a key to sign with',
  ).toBe(1);
  record.agentKeyAlgorithm = keyRows[0]!.algorithm;

  record.feeAccount = await readFeeAccount(agentId);
  record.feeAccountFunding = await fundIfNeeded(String(record.feeAccount));

  /* --- 4: the conversation ------------------------------------------------ */

  await page.goto(`/app/agents/${agentId}/chat`);
  await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();

  /* message 1 — a read. Nothing moves, and there is no hash to want. */

  const balanceTurn = await say(page, agentId, "what's my balance", 1);
  expect(balanceTurn.tool, 'the model did not choose get_balance for a balance question').toBe(
    'get_balance',
  );
  const balance = await finished(page, balanceTurn);

  expect(balance.row.status).toBe('done');
  expect(
    balance.row.outcome,
    `get_balance did not succeed: ${JSON.stringify(balance.row.result_json).slice(0, 400)}`,
  ).toBe('succeeded');
  expect(balance.row.channel, 'the turn was not recorded as coming from the web').toBe('web');

  const beforeData = (balance.row.result_json as { data: { account: { stroops: string } } }).data;
  const balanceBefore = BigInt(beforeData.account.stroops);
  expect(
    balanceBefore,
    `the smart account holds ${balanceBefore} stroops, which is less than the ${PERMITTED_XLM} XLM ` +
      'message two is about to send. The deploy seeds it, so this means the seed did not land.',
  ).toBeGreaterThanOrEqual(PERMITTED_XLM * XLM);
  await expect(balance.panel).toContainText('PERMIT');
  record.balanceBefore = balanceBefore.toString();

  /* message 2 — a payment the boundary permits. A hash, and a balance that moved. */

  const payTurn = await say(page, agentId, `pay ${PERMITTED_XLM} XLM to ${RECIPIENT}`, 2);
  expect(payTurn.tool).toBe('send_payment');
  const paid = await finished(page, payTurn);

  expect(
    paid.row.outcome,
    `the permitted payment did not succeed: ${JSON.stringify(paid.row.result_json).slice(0, 600)}`,
  ).toBe('succeeded');

  const paidResult = paid.row.result_json as {
    evidence: { hash?: string } | null;
    data: { stroops: string; destination: string };
  };
  const paidHash = paidResult.evidence?.hash ?? '';
  expect(paidHash, 'the permitted payment succeeded without a transaction hash').toMatch(TX_HASH);
  expect(
    paidResult.data.stroops,
    'the model converted the amount to a different number of stroops',
  ).toBe((PERMITTED_XLM * XLM).toString());
  expect(paidResult.data.destination).toBe(RECIPIENT);
  record.permittedTx = paidHash;

  // On screen, where a person reads it: permitted, and the hash is a link.
  await expect(paid.panel).toContainText('PERMIT');
  await expect(paid.panel).toContainText('checkable by anyone');
  const paidLink = paid.panel.locator(`a[href*="/explorer/testnet/tx/"]`).last();
  expect((await paidLink.getAttribute('title'))?.trim()).toBe(paidHash);

  /* message 3 — over the cap. The NETWORK refuses, and the refusal has a hash. */

  const overTurn = await say(page, agentId, `pay ${OVER_CAP_XLM} XLM to ${RECIPIENT}`, 3);
  expect(overTurn.tool).toBe('send_payment');
  const over = await finished(page, overTurn);

  expect(
    over.row.status,
    'a refused turn is done, not failed — status and outcome are two columns for this reason',
  ).toBe('done');
  expect(
    over.row.outcome,
    'an over-cap payment must be refused by the network, not by Limen. gate.ts refuses only what ' +
      'the network cannot see, and the cap is the network\'s. A refused_by_limen here would mean ' +
      'the gate started pre-empting the boundary, which turns the demonstration into an opinion. ' +
      `Got: ${JSON.stringify(over.row.result_json).slice(0, 600)}`,
  ).toBe('refused_by_network');

  const overResult = over.row.result_json as {
    codes: number[];
    boundaryRefusal: boolean;
    evidence: { hash?: string } | null;
    whyNoEvidence?: string;
    summary: string;
  };
  expect(
    overResult.boundaryRefusal,
    `the network refused this, but not because of the boundary: codes ${JSON.stringify(overResult.codes)}`,
  ).toBe(true);
  expect(
    overResult.codes,
    'the refusal does not carry SpendingLimitExceeded#3221, so the cap is not what refused it',
  ).toContain(3221);

  const overHash = overResult.evidence?.hash ?? '';
  expect(
    overHash,
    'the over-cap refusal never reached a ledger, so there is no hash to check. ' +
      `payment.ts borrows a footprint precisely to avoid this: ${overResult.whyNoEvidence ?? ''}`,
  ).toMatch(TX_HASH);
  record.refusedByNetworkTx = overHash;
  record.refusedByNetworkCodes = overResult.codes;

  await expect(over.panel).toContainText('refused by the network');
  await expect(over.panel).toContainText('#3221');
  await expect(over.panel).toContainText('checkable by anyone');

  /* message 4 — an unapproved recipient. LIMEN refuses, and there is no hash. */

  const strangerTurn = await say(page, agentId, `pay ${STRANGER_XLM} XLM to ${STRANGER}`, 4);
  expect(strangerTurn.tool).toBe('send_payment');
  const stranger = await finished(page, strangerTurn);

  expect(stranger.row.status).toBe('done');
  expect(
    stranger.row.outcome,
    'a payment to an address outside the allowlist must be refused by Limen. No audited on-chain ' +
      'primitive expresses a recipient allowlist, so the ledger cannot be what refuses this. ' +
      `Got: ${JSON.stringify(stranger.row.result_json).slice(0, 600)}`,
  ).toBe('refused_by_limen');

  const strangerResult = stranger.row.result_json as {
    constraint: string;
    ledgerWould: string;
    reachedLedger: boolean;
    summary: string;
  };
  expect(strangerResult.constraint, 'the refusal does not name the constraint').toBe(
    'recipient_not_allowed',
  );
  expect(strangerResult.reachedLedger).toBe(false);
  expect(
    strangerResult.ledgerWould,
    'a 1 XLM payment is well inside the cap, so the ledger would have permitted it — and saying so ' +
      'is what distinguishes a Limen limit from the network\'s',
  ).toBe('permit');
  expect(
    strangerResult.summary,
    'the refusal does not name the address it refused',
  ).toContain(STRANGER);

  // The absence is the claim. `refused_by_limen` has no `evidence` field in the
  // union at all, so this asserts that nothing invented one on the way through
  // two processes and a jsonb column.
  expect(
    'evidence' in strangerResult,
    'a Limen refusal carries an evidence field, which is row two borrowing row three\'s badge',
  ).toBe(false);
  record.refusedByLimenConstraint = strangerResult.constraint;

  await expect(stranger.panel).toContainText('refused by Limen');
  await expect(stranger.panel).toContainText('recipient_not_allowed');
  await expect(stranger.panel).toContainText('no transaction to look up, and none is missing');
  await expect(
    stranger.panel.locator('a[href*="/explorer/"]'),
    'the Limen refusal rendered an explorer link, which claims a transaction that never existed',
  ).toHaveCount(0);

  /* --- 5: the ledger, not the hash ---------------------------------------- */

  // Trap 2. The payment is proved by the balance falling by exactly 20 XLM,
  // read back through the same tool that read it before. The two refusals moved
  // nothing, so this also proves they moved nothing.
  const afterTurn = await say(page, agentId, "what's my balance", 5);
  const after = await finished(page, afterTurn);
  expect(after.row.outcome).toBe('succeeded');

  const afterData = (after.row.result_json as { data: { account: { stroops: string } } }).data;
  const balanceAfter = BigInt(afterData.account.stroops);
  expect(
    balanceBefore - balanceAfter,
    'the balance did not fall by exactly the permitted payment. Either the payment did not move ' +
      'what it said it moved, or one of the two refusals moved something.',
  ).toBe(PERMITTED_XLM * XLM);
  record.balanceAfter = balanceAfter.toString();

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });

  /* --- what this run establishes ------------------------------------------ */

  for (const [key, value] of Object.entries(record)) {
    test.info().annotations.push({ type: key, description: String(value) });
  }

  console.log('\n--- what this run establishes -------------------------------');
  console.log(`a fresh agent, deployed and holding a server-side key : ${agentId}`);
  console.log(`  smart account   ${smartAccount}`);
  console.log(`  cap installed   ${String(record.capUnits)} stroops / ${WINDOW_LEDGERS} ledgers`);
  console.log('a person talked to it, and got four different answers :');
  console.log(`  balance         succeeded, ${String(record.balanceBefore)} stroops`);
  console.log(`  20 XLM          succeeded  ${String(record.permittedTx)}`);
  console.log(
    `  200 XLM         refused by the NETWORK  ${String(record.refusedByNetworkTx)} ` +
      `codes ${JSON.stringify(record.refusedByNetworkCodes)}`,
  );
  console.log(`  1 XLM, stranger refused by LIMEN, no hash, ${String(record.refusedByLimenConstraint)}`);
  console.log(`the balance moved by exactly the permitted payment    : ${String(record.balanceBefore)} → ${String(record.balanceAfter)}`);
  console.log('\nRUN RECORD ' + JSON.stringify(record));
});
