import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PLAN-V8's *"NOT RUN — the browser half of deploy"*, driven end to end.
 *
 * That section states the gap precisely, and it is worth restating rather than
 * pointing at: the four chain writes behind `/app/agents/new` are
 * `lib/chain-actions.ts` unchanged and that module has recorded testnet runs
 * behind it; the `/api/agents*` routes were exercised over HTTP against live
 * Neon and live testnet; the verification in `/deployed` was exercised against
 * real chain state. **The seam where a browser drives those four writes and
 * reports back had been executed by neither a person nor a test.** No smart
 * account had ever been created by this screen. This file is what closes that,
 * or narrows it honestly.
 *
 * ## What it is
 *
 * A real Chromium with a virtual authenticator over CDP, a real `next start`,
 * a real Neon, a real Upstash, and five real testnet submissions signed by
 * ed25519 keys generated inside the page. `page.route` appears nowhere in this
 * file, deliberately, and nothing below the browser is stubbed: the passkey is
 * a credential a browser created, the session is a row, the agent is a row, the
 * boundary is derived by the server against a ledger it read, and the rule is
 * installed by a transaction that closed.
 *
 * ## The three traps this file is built to avoid
 *
 * 1. **Never assert from the screen alone.** The deployed panel is drawn from
 *    `/api/agents/[id]/deployed`'s answer, so a spec that read it and stopped
 *    would pass against a route that wrote nothing. Every claim about the
 *    record is therefore re-read from Postgres afterwards, over a connection
 *    this process opens itself — see {@link readAgentRow}, which uses raw SQL
 *    rather than `stores.ts`, so the check is not the store agreeing with
 *    itself.
 * 2. **Never assert a chain fact from a hash.** The deploy is not proved by the
 *    presence of a transaction id. It is proved by `verified` — the block the
 *    server produced by re-reading the account's context rules over RPC — and
 *    by the numbers in it matching the cap and window that were typed into the
 *    form five minutes earlier.
 * 3. **Never let the model's absence become a skip.** There is no
 *    `ANTHROPIC_API_KEY` in this run, so `/api/agents/generate` degrades to an
 *    empty draft carrying the description. That is a working path — the one CI
 *    exercises — and it is asserted as one: `generated: false`, the degraded
 *    sentence on screen, and every field of the draft empty. A run that
 *    silently generated instead would fail here rather than pass quietly,
 *    because this spec's subject is the form a person fills in.
 *
 * ## Why it is out of CI
 *
 * The same reason as `account-lifecycle.spec.ts` and `passkey-owner.spec.ts`,
 * plus the reason `auth-ceremony.spec.ts` gives: it spends five testnet fees
 * and it needs credentials a GitHub runner does not have. It is untagged, so
 * `playwright.ci.config.ts`'s `grep: /@ci/` cannot reach it by construction
 * rather than by being remembered. It runs on demand, from `apps/web`:
 *
 *     npx playwright test e2e/agent-builder.spec.ts
 *
 * ## `localhost`, not `127.0.0.1`, and it is load-bearing
 *
 * A Relying Party ID must be a registrable domain and an IP literal is not one,
 * so `navigator.credentials.create` on `http://127.0.0.1:3000` fails with
 * `SecurityError` before any authenticator is consulted. The default config
 * points at the IP; this suite registers a passkey, so it states its origin
 * here. `passkey-owner.spec.ts` found this the hard way and B9.3 turned it into
 * a rule: no agent deployment from an IP-reached origin.
 */

test.use({ baseURL: 'http://localhost:3000' });

/** Five submissions, each waiting on a ledger close, plus two RPC read-backs. */
const RUN_TIMEOUT = 1_200_000;

/** One submission: simulate, send, then poll until the ledger closes. */
const SUBMIT_TIMEOUT = 240_000;

const TX_HASH = /^[0-9a-f]{64}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

/** `local-key.ts` and `passkey.ts`. Both asserted empty on arrival. */
const KEY_STORAGE = 'limen.keys.v1';
const PASSKEY_STORAGE = 'limen.passkey.v1';

/**
 * What this run needs, and what it refuses to pretend about.
 *
 * Fail rather than skip, in `auth-ceremony.spec.ts`'s words: a suite whose whole
 * purpose is to be run against real services, quietly passing because they were
 * absent, is the exact shape of coverage this repository keeps losing.
 */
const REQUIRED = ['DATABASE_URL'] as const;

/**
 * The sentence a person writes, and the limits they correct it into.
 *
 * The cap is deliberately tiny. It is a real spending limit on a real testnet
 * account and nothing in this run spends against it, but a demonstration that
 * installs a large one is a demonstration that did not have to think about the
 * number.
 *
 * `CAP_UNITS` is written out beside `CAP_DECIMAL` rather than computed, because
 * it is the described mode's entire arithmetic claim: `headroom_bps = 10000`,
 * the cap stored is the cap typed, with nothing added. 0.1 at 7 decimal places
 * is 1,000,000 smallest units, and that number has to survive `validate`,
 * `synthesize`, `lower`, `add_context_rule`, and a read-back from the policy
 * contract without changing. Asserting it against a constant is what makes that
 * a measurement; asserting it against a re-derivation would be this repository
 * agreeing with itself.
 */
const DESCRIPTION = 'an agent that can pay approved suppliers up to 0.1 XLM a day';
const AGENT_NAME = 'Supplier payer (e2e)';
const CAP_DECIMAL = '0.1';
const CAP_UNITS = '1000000';
const PER_TRANSACTION_DECIMAL = '0.05';
const PER_TRANSACTION_UNITS = '500000';
const ASSET_LABEL = 'XLM';
const ASSET_DECIMALS = '7';

/** `WINDOW_OPTIONS.daily` and `EXPIRY_OPTIONS['7d']`, as the contract counts them. */
const WINDOW_LEDGERS = 17_280;
const EXPIRY_LEDGERS = 7 * 17_280;

/**
 * The token, and the recipient, read out of the recorded deployments rather
 * than written here.
 *
 * `deployments/testnet.json` is the file this repository treats as the record of
 * what exists on testnet, and a contract id retyped into a spec is exactly the
 * class of claim it exists to prevent — *"an address recalled rather than read"*,
 * in `agent-config.ts`'s words about why the form has no asset lookup. Taking
 * it from the file also means this spec stops working, loudly, if the recorded
 * token ever changes, instead of installing a boundary against an address that
 * used to be right.
 *
 * All three recorded uses of the token are compared before one of them is used,
 * so that a file which disagrees with itself is a failure here rather than an
 * arbitrary pick.
 */
interface RecordedDeployments {
  walkthrough: { token: string; ownerSigner: string };
  liveDerivation: { token: string };
  v4ChainRun: { token: string };
}

function recordedDeployments(): RecordedDeployments {
  const path = join(__dirname, '../../../packages/chain/deployments/testnet.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RecordedDeployments;
}

type Settled =
  | { kind: 'on-ledger'; hash: string }
  | { kind: 'refused'; hash: string; codes: string }
  | { kind: 'not-submitted'; text: string };

/**
 * Wait for the one `WriteResult` whose sentence contains `what` to stop
 * running, and say which of its three states it reached.
 *
 * Read off the rendered eyebrow, as `account-lifecycle.spec.ts` reads it and
 * for the same reason: that is the thing a person sees, and the claim under
 * test is what the screen tells them. Order matters — "on ledger — failed
 * there" contains "on ledger" as a substring, so the failure is matched first.
 */
async function settle(page: Page, what: string): Promise<Settled> {
  // The running state and the settled state occupy the same slot, so this is
  // the same locator throughout; `.last()` because `Pending` and `WriteResult`
  // are both `div.panel` and the sentence appears in whichever is mounted.
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

  // Friendbot funding an account that already exists returns no hash, and
  // `WriteResult` renders "no transaction to link" rather than a dead link. It
  // is the one on-ledger case with nothing to read, so it is handled rather
  // than asserted away.
  const link = scope.locator('a[href*="/explorer/testnet/tx/"]').last();
  const hash = (await link.count()) === 0 ? '' : ((await link.getAttribute('title')) ?? '').trim();

  if (text.includes('on ledger — failed there')) {
    const codes = (await scope.locator('dt:text-is("contract codes") + dd').innerText()).trim();
    return { kind: 'refused', hash, codes };
  }
  return { kind: 'on-ledger', hash };
}

/** A settled step that must have succeeded on a ledger, with a hash to check. */
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

/** The full value behind a truncated `Address`, which carries it in `title`. */
async function addressIn(scope: Locator, prefix: string): Promise<string> {
  const button = scope.locator(`button[title^="${prefix}"]`).first();
  await expect(button, `no ${prefix}… address rendered here`).toBeVisible();
  return ((await button.getAttribute('title')) ?? '').split('\n')[0]!.trim();
}

/** The `<section>` whose `<h2>` is `heading`. */
function section(page: Page, heading: string): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: heading }) });
}

/**
 * The `<section>` that *is* the group whose `<h3>` is `heading`: the nearest
 * `<section>` ancestor of that heading.
 *
 * `page.locator('section').filter({ has: h3 }).first()` is the obvious spelling
 * and it is wrong here. Step 2's own `<section>` wraps both groups, so it
 * satisfies the filter as well, and it starts earlier in the document, so it is
 * what `.first()` returns. The partition assertions then read the whole step
 * instead of one half of it, and "the per-payment ceiling is not in the
 * on-chain group" silently becomes "it is somewhere on this page" — true of
 * both groups, and so a check of nothing. It failed the first run this way,
 * against a form that renders the partition correctly.
 */
function group(page: Page, heading: string): Locator {
  return page.getByRole('heading', { level: 3, name: heading }).locator('xpath=ancestor::section[1]');
}

/**
 * What Postgres holds, read by this process rather than reported by the app.
 *
 * Raw SQL over `neon-http`, and deliberately not `drizzleAgentStore`: the
 * question is whether the route wrote the rows it says it wrote, and asking the
 * application's own query layer is how a store agrees with itself. This is
 * test-side only — `@neondatabase/serverless` is `@limen/db`'s dependency and
 * is imported here to read, never to write.
 */
async function readAgentRow(agentId: string): Promise<{
  agent: { status: string; name: string; description: string };
  accounts: {
    smart_account_contract_id: string;
    deploy_tx_hash: string | null;
    install_tx_hash: string | null;
    context_rule_id: number | null;
    owner_signer_kind: string;
    owner_public_key: string;
    agent_public_key: string;
  }[];
  policies: { status: string; install_tx_hash: string | null; context_rule_id: number | null }[];
}> {
  const sql = neon(process.env.DATABASE_URL ?? '');

  const agentRows = (await sql`
    select status, name, description from agents where id = ${agentId}
  `) as unknown as { status: string; name: string; description: string }[];
  expect(agentRows.length, 'no agents row with that id').toBe(1);

  const accounts = (await sql`
    select smart_account_contract_id, deploy_tx_hash, install_tx_hash, context_rule_id,
           owner_signer_kind, owner_public_key, agent_public_key
    from agent_accounts where agent_id = ${agentId}
  `) as unknown as Awaited<ReturnType<typeof readAgentRow>>['accounts'];

  const policyRows = (await sql`
    select status, install_tx_hash, context_rule_id from policies where agent_id = ${agentId}
  `) as unknown as Awaited<ReturnType<typeof readAgentRow>>['policies'];

  return { agent: agentRows[0]!, accounts, policies: policyRows };
}

test('a browser describes an agent, reviews its boundary, and deploys it onto testnet', async ({
  page,
  context,
}) => {
  test.setTimeout(RUN_TIMEOUT);

  const missing = REQUIRED.filter((name) => (process.env[name] ?? '').length === 0);
  expect(
    missing,
    `set ${missing.join(', ')} before running this suite — it deploys an agent and then reads the ` +
      'rows back out of Postgres, which is the half the screen cannot be trusted about.',
  ).toEqual([]);

  const record: Record<string, unknown> = {};
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [browser console] ${message.text()}`);
  });

  const deployments = recordedDeployments();
  const TOKEN = deployments.walkthrough.token;
  const RECIPIENT = deployments.walkthrough.ownerSigner;

  // The file, checked before it is used. Three blocks record the token this
  // repository has been installing boundaries against; if they ever disagree,
  // picking one of them silently is the wrong answer.
  expect(
    [deployments.walkthrough.token, deployments.liveDerivation.token, deployments.v4ChainRun.token],
    'the recorded runs disagree about which token they used',
  ).toEqual([TOKEN, TOKEN, TOKEN]);
  expect(TOKEN, 'the recorded token is not a contract address').toMatch(CONTRACT);
  expect(RECIPIENT, 'the recorded owner signer is not an account address').toMatch(PUBLIC_KEY);
  record.token = TOKEN;

  /* --- the authenticator ---------------------------------------------------
   *
   * The same options `passkey-owner.spec.ts` and `auth-ceremony.spec.ts` use.
   * `hasUserVerification` and `isUserVerified` are required rather than
   * convenient: `webauthn.ts` checks the User Verified bit, and an
   * authenticator without them produces assertions the register and login
   * routes correctly refuse.
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

  /* --- 1: a clean browser, and the screen that refuses it ------------------ */

  await page.goto('/app/agents/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Deploy an agent' })).toBeVisible();

  // Clean profile, asserted rather than assumed. A run that reused an existing
  // passkey or an existing pair of keys would prove nothing about creating
  // either, and both are created below.
  const storage = await page.evaluate(
    ([keys, passkey]: [string, string]) => ({
      keys: window.localStorage.getItem(keys),
      passkey: window.localStorage.getItem(passkey),
    }),
    [KEY_STORAGE, PASSKEY_STORAGE] as [string, string],
  );
  expect(storage.keys, 'this browser arrived with signing keys in it — not a clean profile').toBeNull();
  expect(storage.passkey, 'this browser arrived with a passkey in it — not a clean profile').toBeNull();

  // The sign-in gate, which is the one thing on this site that requires an
  // account. Its presence is also a reading of the database: `use-identity`
  // renders `unavailable` when `/api/auth/session` cannot answer, and that
  // state has different copy, so a Neon that will not answer fails here with a
  // message rather than three steps later as a mystery.
  await expect(
    page.getByRole('heading', { level: 3, name: 'Sign in to deploy an agent' }),
    'the builder did not render its signed-out state — check /api/auth/session and DATABASE_URL',
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Generate the limits' })).toHaveCount(0);
  record.refusedBeforeSignIn = true;

  /* --- 2: register a passkey ---------------------------------------------- */

  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 60_000 });

  // The registration notice is absolutely positioned under the header and
  // dismisses itself after eight seconds. Dismissing it is what a person does,
  // and it keeps the first control of the flow from being covered by it.
  await page.getByRole('button', { name: 'Dismiss' }).click();

  const session = (await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    return (await response.json()) as { user: { id?: string; credentialId?: string } | null };
  })) as { user: { id?: string; credentialId?: string } | null };
  expect(session.user, 'registering did not produce a session').not.toBeNull();
  record.userId = session.user?.id;

  // The gate opens on the same page, without a reload: `registerIdentity`
  // publishes into the identity store the builder subscribes to.
  await expect(page.getByRole('heading', { level: 2, name: 'Describe the agent' })).toBeVisible();

  /* --- 3: describe, and generate with no model behind it ------------------ */

  await page.getByLabel('What the agent should be able to do').fill(DESCRIPTION);

  const [generateResponse, createResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/agents/generate')),
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/agents' && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Generate the limits' }).click(),
  ]);

  const generated = (await generateResponse.json()) as {
    generated: boolean;
    degraded?: string;
    draft: Record<string, unknown>;
  };
  record.generateStatus = generateResponse.status();
  record.generated = generated.generated;
  record.degradedReason = generated.degraded;

  expect(generateResponse.status()).toBe(200);
  // Not a skip. This spec is written for the keyless path — the one CI takes,
  // and the one a person takes when the model is unavailable — and a run where
  // Claude answered would be exercising something else entirely.
  expect(
    generated.generated,
    'a draft was generated, so this run did not exercise the degraded path this spec is written for — unset ANTHROPIC_API_KEY',
  ).toBe(false);
  const degradedReason = generated.degraded ?? '';
  expect(degradedReason.length, 'the route degraded without saying why').toBeGreaterThan(0);
  // The empty draft, field by field, because "empty" is the claim: the model
  // proposed nothing and everything below is what a person typed.
  expect(generated.draft.description, 'the degraded draft dropped the description').toBe(DESCRIPTION);
  expect(generated.draft.cap).toBe('');
  expect(generated.draft.assetContractId).toBe('');
  expect(generated.draft.assetLabel).toBe('');
  expect(generated.draft.name).toBe('');
  expect(generated.draft.recipients).toEqual([]);

  const created = (await createResponse.json()) as { agent: { id: string; status: string } };
  expect(createResponse.status()).toBe(200);
  expect(created.agent.status, 'the row was not written as a DRAFT').toBe('DRAFT');
  const agentId = created.agent.id;
  expect(agentId, 'no agent id came back').toEqual(expect.any(String));
  record.agentId = agentId;

  const review = section(page, 'Review the limits');
  await expect(review).toBeVisible();
  await expect(review, 'the degraded path did not say that nothing was generated').toContainText(
    'nothing was generated',
  );
  await expect(review).toContainText(degradedReason);
  // The form is what a person fills in, so it starts empty — and the name is
  // the row's placeholder rather than something a model chose.
  await expect(page.locator('#agent-cap')).toHaveValue('');
  await expect(page.locator('#agent-asset')).toHaveValue('');
  await expect(page.locator('#agent-name')).toHaveValue('Untitled agent');

  /* --- 4: fill the form, and check the limits ----------------------------- */

  await page.locator('#agent-name').fill(AGENT_NAME);
  await page.locator('#agent-asset').fill(TOKEN);
  await page.locator('#agent-asset-label').fill(ASSET_LABEL);
  await page.locator('#agent-asset-decimals').fill(ASSET_DECIMALS);
  await page.locator('#agent-cap').fill(CAP_DECIMAL);
  await page.locator('#agent-window').selectOption('daily');
  await page.locator('#agent-expiry').selectOption('7d');
  await page.locator('#agent-per-transaction').fill(PER_TRANSACTION_DECIMAL);
  await page.locator('#agent-recipients').fill(RECIPIENT);

  // The partition, on the form itself. B8.2 requires the two groups to be
  // structurally distinct rather than visually grouped, and the labels are how
  // a person is told which is which — so they are asserted where a person reads
  // them, and the off-chain group is asserted to carry the sentence that says
  // the ledger does not enforce it.
  const enforcedByNetwork = group(page, 'Enforced by the network');
  const enforcedByLimen = group(page, 'Enforced by Limen');
  await expect(enforcedByNetwork).toContainText('ON-CHAIN');
  await expect(enforcedByLimen).toContainText('COMPUTED LOCALLY');
  await expect(enforcedByLimen).toContainText('The ledger does not enforce these.');
  // The two off-chain fields are inside the off-chain group, which is the
  // structural half of the claim: a per-payment ceiling rendered under
  // "Enforced by the network" would be the one misrepresentation this project
  // cannot make.
  await expect(enforcedByLimen.locator('#agent-per-transaction')).toHaveCount(1);
  await expect(enforcedByLimen.locator('#agent-recipients')).toHaveCount(1);
  await expect(enforcedByNetwork.locator('#agent-cap')).toHaveCount(1);
  await expect(enforcedByNetwork.locator('#agent-per-transaction')).toHaveCount(0);
  record.partitionRendered = true;

  /* --- 5: the server derives the boundary --------------------------------- */

  const [configureResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/agents/${agentId}/configure`)),
    page.getByRole('button', { name: 'Accept these limits' }).click(),
  ]);

  const configured = (await configureResponse.json()) as {
    agent: { status: string };
    proposal: { contextRule: { validFromLedger: number; validUntilLedger: number } };
    plan: {
      rules: {
        contract: string;
        name: string;
        validUntilLedger: number | null;
        policies: { kind: string; asset: string; limit: string; windowLedgers: number }[];
      }[];
      notes: string[];
    };
    config: { enforcedOffChain: { perTransactionCap: string | null; recipients: string[] } };
  };
  expect(
    configureResponse.status(),
    `configure refused: ${JSON.stringify(configured).slice(0, 400)}`,
  ).toBe(200);
  expect(configured.agent.status).toBe('CONFIGURED');

  // Exactly one rule, on the token that was pasted, with the cap that was
  // typed. `headroom_bps = 10000` means the derivation adds nothing, and this
  // is that claim as a number: 0.1 XLM at 7 decimals, unchanged by synthesis.
  expect(configured.plan.rules.length, 'the plan does not describe exactly one context rule').toBe(1);
  const planned = configured.plan.rules[0]!;
  expect(planned.contract, 'the boundary was derived against a different token').toBe(TOKEN);
  expect(planned.policies.length).toBe(1);
  expect(planned.policies[0]!.kind).toBe('spending_limit');
  expect(planned.policies[0]!.asset).toBe(TOKEN);
  expect(planned.policies[0]!.limit, 'the derived cap is not the cap that was typed').toBe(CAP_UNITS);
  expect(planned.policies[0]!.windowLedgers).toBe(WINDOW_LEDGERS);

  // The expiry that was chosen, counted from the ledger the server read. Both
  // numbers come from the same response, so this checks the selection reached
  // the derivation rather than checking the server's arithmetic against itself.
  const derivedAt = configured.proposal.contextRule.validFromLedger;
  expect(planned.validUntilLedger, 'the plan has no expiry').not.toBeNull();
  expect(
    planned.validUntilLedger! - derivedAt,
    'the rule does not expire the number of ledgers the form asked for',
  ).toBe(EXPIRY_LEDGERS);
  record.derivedAtLedger = derivedAt;
  record.validUntilLedger = planned.validUntilLedger;

  // The off-chain half, as the server validated it — not as the form computed
  // it. `configure` returns its own `config` precisely so the review screen
  // renders what was written to `policies.enforced_offchain_json`.
  expect(configured.config.enforcedOffChain.perTransactionCap).toBe(PER_TRANSACTION_UNITS);
  expect(configured.config.enforcedOffChain.recipients).toEqual([RECIPIENT]);

  /* --- 6: review the derived boundary on screen --------------------------- */

  const boundary = section(page, 'The boundary');
  await expect(boundary).toBeVisible();
  await expect(boundary).toContainText('One context rule');
  await expect(boundary).toContainText('COMPOSITION ONLY');

  // The install table renders what would be written, so what it renders is
  // compared against the plan the server sent rather than against a constant:
  // the screen agreeing with the server is the property, and the server was
  // already checked against the form above.
  const row = boundary.locator('tbody tr').first();
  expect(await addressIn(row, 'C'), 'the table shows a different contract from the plan').toBe(TOKEN);
  await expect(row.locator('td').nth(2)).toHaveText(planned.validUntilLedger!.toLocaleString('en-US'));
  await expect(row.locator('td').nth(3)).toHaveText('spending limit');
  await expect(row.locator('td').nth(4), 'the reviewed cap is not the cap that was typed').toHaveText(
    CAP_DECIMAL,
  );
  await expect(row.locator('td').nth(5)).toHaveText('≈ 1 day');

  // And the half nothing enforces, kept apart from it. No hash column, no
  // explorer link — asserted, because the absence is the claim.
  const offChain = boundary
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 3, name: 'Enforced by Limen' }) })
    .first();
  await expect(offChain).toContainText(`${PER_TRANSACTION_DECIMAL} ${ASSET_LABEL}`);
  expect(await addressIn(offChain, 'G')).toBe(RECIPIENT);
  await expect(
    offChain.locator('a[href*="/explorer/"]'),
    'the off-chain half rendered an explorer link, which claims a transaction that will never exist',
  ).toHaveCount(0);
  record.reviewedOnScreen = true;

  /* --- 7: deploy ----------------------------------------------------------
   *
   * Five submissions: friendbot twice, then the three writes
   * `lib/chain-actions.ts` makes. This is the seam PLAN-V8 recorded as
   * unexecuted — the browser driving those writes and reporting back.
   */

  const deployedResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/agents/${agentId}/deployed`) &&
      response.request().method() === 'POST',
    { timeout: RUN_TIMEOUT },
  );

  await page.getByRole('button', { name: 'Deploy this agent' }).click();

  await settle(page, 'Friendbot funding the owner');
  await settle(page, 'Friendbot funding the agent');
  await expect(
    page.locator('div.panel').filter({ hasText: 'Friendbot funding the' }),
    'friendbot refused one of the two accounts',
  ).not.toContainText('not submitted');

  record.deployTx = await landed(page, 'Creating the smart account');
  record.seedTx = await landed(page, 'Funding the smart account');
  record.installTx = await landed(page, 'Installing the boundary');

  const deployedResponse = await deployedResponsePromise;
  const recorded = (await deployedResponse.json()) as {
    agent: { status: string };
    verified: {
      contextRuleId: number;
      contract: string | null;
      limit: string;
      periodLedgers: number;
      validUntilLedger: number | null;
    };
  };
  expect(
    deployedResponse.status(),
    `the deployment was not recorded: ${JSON.stringify(recorded).slice(0, 400)}`,
  ).toBe(200);

  /* --- 8: what the ledger said, as the server read it --------------------- */

  // Every one of these came from `readAllContextRules` and `readSpendingLimit`
  // over RPC, not from the browser's report. This is the assertion the whole
  // flow exists to earn: the number typed into a form is the number the policy
  // contract holds.
  expect(recorded.agent.status).toBe('ACTIVE');
  expect(recorded.verified.contract, 'the installed rule authorizes a different token').toBe(TOKEN);
  expect(recorded.verified.limit, 'the installed cap is not the reviewed cap').toBe(CAP_UNITS);
  expect(recorded.verified.periodLedgers).toBe(WINDOW_LEDGERS);
  expect(recorded.verified.validUntilLedger).toBe(planned.validUntilLedger);
  expect(Number.isInteger(recorded.verified.contextRuleId)).toBe(true);
  record.contextRuleId = recorded.verified.contextRuleId;
  record.limit = recorded.verified.limit;
  record.periodLedgers = recorded.verified.periodLedgers;

  const deployedPanel = page.locator('div[data-tone="permitted"]').filter({
    hasText: 'deployed, and read back',
  });
  await expect(deployedPanel).toBeVisible({ timeout: 60_000 });
  const smartAccount = await addressIn(deployedPanel, 'C');
  expect(smartAccount, 'the deployed panel shows no smart account address').toMatch(CONTRACT);
  await expect(deployedPanel).toContainText(String(recorded.verified.contextRuleId));
  await expect(deployedPanel).toContainText(CAP_UNITS);
  record.smartAccount = smartAccount;

  // The two keys, off the badges the screen renders. They are generated in this
  // browser during the deploy, and they must be two: an agent bounded by a rule
  // its own key installed is not bounded.
  const keyPanel = page.locator('div.panel').filter({ hasText: 'the keys that sign' }).last();
  const ownerKey = await addressIn(keyPanel.locator('div').filter({ hasText: 'OWNER' }).last(), 'G');
  const agentKey = await addressIn(keyPanel.locator('div').filter({ hasText: 'AGENT' }).last(), 'G');
  expect(ownerKey).toMatch(PUBLIC_KEY);
  expect(agentKey).toMatch(PUBLIC_KEY);
  expect(ownerKey, 'the owner and agent keys are the same key').not.toBe(agentKey);
  record.ownerSigner = ownerKey;
  record.agentSigner = agentKey;

  /* --- 9: the rows, read from Postgres by this process -------------------- */

  const rows = await readAgentRow(agentId);

  expect(rows.agent.status, 'the agent did not reach ACTIVE in the database').toBe('ACTIVE');
  expect(rows.agent.name).toBe(AGENT_NAME);
  expect(rows.agent.description).toBe(DESCRIPTION);

  expect(rows.accounts.length, 'agent_accounts has no row, or more than one').toBe(1);
  const account = rows.accounts[0]!;
  expect(account.smart_account_contract_id, 'the row records a different smart account').toBe(
    smartAccount,
  );
  expect(account.context_rule_id, 'the row records a different context rule').toBe(
    recorded.verified.contextRuleId,
  );
  expect(account.deploy_tx_hash, 'the row records a different deploy transaction').toBe(
    record.deployTx,
  );
  expect(account.install_tx_hash, 'the row records a different install transaction').toBe(
    record.installTx,
  );
  expect(account.owner_signer_kind).toBe('ed25519');
  expect(account.owner_public_key).toBe(ownerKey);
  expect(account.agent_public_key).toBe(agentKey);

  expect(rows.policies.length, 'the agent does not have exactly one policy row').toBe(1);
  expect(rows.policies[0]!.status, 'the reviewed policy was not marked installed').toBe('installed');
  expect(rows.policies[0]!.install_tx_hash).toBe(record.installTx);
  expect(rows.policies[0]!.context_rule_id).toBe(recorded.verified.contextRuleId);
  record.rowsVerifiedFromPostgres = true;

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });

  /* --- what this run establishes ------------------------------------------ */

  for (const [key, value] of Object.entries(record)) {
    test.info().annotations.push({ type: key, description: String(value) });
  }

  console.log('\n--- what this run establishes -------------------------------');
  console.log('a browser deployed an agent from a sentence : YES');
  console.log(`  passkey registered, session row           : user ${String(record.userId)}`);
  console.log(`  generate, with no model behind it         : generated=false, empty draft`);
  console.log(`  boundary derived server-side at ledger    : ${String(record.derivedAtLedger)}`);
  console.log(`  smart account                             : ${smartAccount}`);
  console.log(`  deploy   ${String(record.deployTx)}`);
  console.log(`  seed     ${String(record.seedTx)}`);
  console.log(`  install  ${String(record.installTx)}`);
  console.log(
    `the ledger holds what the form asked for   : rule ${String(record.contextRuleId)}, ` +
      `limit ${String(record.limit)}, period ${String(record.periodLedgers)}, ` +
      `valid until ${String(record.validUntilLedger)}`,
  );
  console.log('the rows exist, read from Postgres         : agents ACTIVE, agent_accounts 1 row');
  console.log('\nRUN RECORD ' + JSON.stringify(record));
});
