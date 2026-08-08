#!/usr/bin/env node
/**
 * The landing's product screenshots, generated rather than taken.
 *
 * PLAN-V5 §3.1. The landing needs images of the product, and the obvious way to
 * get them is to open the app, crop a window, and commit the PNG. Do that and
 * every hash in those images is frozen at the moment somebody pressed the
 * shutter — while the hashes themselves are read at build time from
 * `deployments/testnet.json`, which changes whenever a script runs. The page's
 * text stays honest automatically and its pictures quietly stop matching it.
 *
 * That is the one place `caveats.test.ts` cannot reach. A stale sentence is a
 * red build; a stale screenshot is a picture of a transaction that is no longer
 * this project's, and nobody would think to check it. So the images are output,
 * not input: this script produces them, `--check` fails when they have drifted,
 * and regenerating is a rerun rather than an afternoon in a screenshot tool.
 *
 * ## What may be photographed, and what may not
 *
 * Only screens that render from committed data. That is a rule about honesty
 * rather than about convenience.
 *
 * A screenshot of a live chain read is a claim frozen in time: the account had
 * that rule, at that ledger, when the shutter fell. Committing one puts a
 * second, unverifiable copy of chain state in the repository — exactly the
 * failure this script exists to prevent, reintroduced by the tool meant to
 * prevent it. So the manifest below is restricted to pages whose every value
 * comes from `deployments/testnet.json`, `generated/evidence.json`, or a shipped
 * fixture evaluated locally, and the run is hermetic: every request to a chain
 * endpoint is aborted, so a shot that depended on one would fail here rather
 * than bake a live answer into a PNG.
 *
 * The `How it works` sequence is therefore shot from the simulator's
 * fixture-driven path and the app's own arrival states — the flow as a stranger
 * first meets it — rather than from a populated account read over RPC.
 *
 * ## What `--check` compares, and why it is not the image
 *
 * Each PNG is written with a JSON sidecar holding the `innerText` of the cropped
 * subtree, and `--check` compares the sidecar. The image itself is not compared.
 *
 * It used to be, byte for byte, and that check could not survive a second
 * machine. The committed PNGs are rendered in this repository's devcontainer;
 * CI renders on `ubuntu-latest`, and different font rasterization moved
 * `step-derive` by a whole pixel of height and changed the bytes of two more
 * shots whose dimensions were identical. Three of four failed the first time CI
 * ever ran the check, on a commit that had changed nothing they photograph.
 *
 * A pixel-difference threshold was the obvious repair and it does not work. A
 * changed transaction hash is roughly 300 pixels of a 640,000-pixel crop — under
 * 0.05% — while rasterization noise is spread across the whole image and
 * comfortably exceeds that. Any threshold loose enough to absorb the noise
 * absorbs the drift, and the check becomes a green light that means nothing.
 *
 * Text has neither problem. It is identical on every machine, so CI and a laptop
 * agree; and it changes precisely when the thing this script was built to catch
 * changes, because every hash, address and cap in these crops is rendered from
 * `deployments/testnet.json`. Re-record a run and the sidecar moves with it.
 *
 * ## What this no longer catches
 *
 * Pure layout drift with unchanged text: a broken grid, a collapsed gap, a
 * control that moved — anything that rearranges the same words. The sidecar
 * cannot see it, and this is a real reduction in coverage rather than a wash.
 *
 * Two things make it an acceptable one. `assertNothingScrolls` below still fails
 * the run on the worst version of it, a table with a column cut off, which is
 * the layout fault that actually damages one of these images. And the byte
 * check never caught any of it either: it was added on the branch that also
 * added the CI step, and it failed on the first CI run it ever saw, so it never
 * survived long enough to catch a single regression of any kind.
 *
 * ## Determinism
 *
 * A shot whose text rendered differently twice would be permanently stale and
 * the check would cry wolf until someone stopped believing it. Four things make
 * a run reproducible, and `--twice` proves it rather than assuming it:
 *
 *   - a fixed viewport and `deviceScaleFactor: 2`;
 *   - `reducedMotion: 'reduce'`, which parks the ground's heartbeat at phase 0
 *     and collapses every transition — the ground is *in* these crops;
 *   - no network, so nothing live can vary;
 *   - crops taken from a locator's own box, so a reflow moves the crop with the
 *     content instead of slicing it.
 *
 * ## The viewport, and why it is not 1280
 *
 * These images are displayed at roughly half the width of a 74rem page, so a
 * crop taken at 1280 arrives about 1144px wide and renders near 0.44 scale,
 * putting the application's 13px body text under 6px. A picture nobody can read
 * is decoration however real the data inside it is. So the shots are taken
 * narrow and displayed close to their own size.
 *
 * How narrow is bounded from both sides, and both bounds were measured against
 * the running application rather than reasoned about:
 *
 *   - **Not below 768**, Tailwind's `md`. Under it the `md:` rules stop applying
 *     and the shot shows a layout no one on a laptop sees. (The subjects here
 *     happen to use only `sm:`, and their structure at 900 is identical to 1280
 *     — same grids, same crop heights, only text wrapping differs — but the
 *     floor stands for whatever gets photographed next.)
 *   - **Not below ~872**, which is where the policy tables inside the simulator
 *     beats stop fitting: at 860 the `.scroll-x` box is 728 wide around 736 of
 *     content and a column is cut off. A screenshot of a table with a column
 *     missing is worse than a small one, so 900 it is, and `assertNothingScrolls`
 *     below makes that a condition of every run rather than a fact measured once
 *     on one afternoon.
 *
 * ## Usage
 *
 *     npm run shots           regenerate the images and their sidecars
 *     npm run shots:check     fail if any committed sidecar has drifted
 *     node scripts/screenshots.mjs --twice    prove each shot is reproducible
 *
 * The server is started and stopped by this script unless one is already
 * answering on the port, so CI runs it as one command.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const OUT = join(web, 'public', 'shots');

/** See the note above: above `md`, above the widest table, and no wider. */
const VIEWPORT = { width: 900, height: 1100 };

const PORT = Number(process.env.SHOTS_PORT ?? 3121);
const BASE = `http://127.0.0.1:${PORT}`;

/** Chain endpoints. Aborted, so no shot can depend on a live answer. */
const CHAIN = /soroban-testnet\.stellar\.org|horizon-testnet\.stellar\.org|friendbot/i;

/**
 * The deployment state these shots photograph, declared rather than inherited.
 *
 * This was found the hard way. `/app/policies/new` picks its copy from whether
 * the deployment has an RPC endpoint — `liveIngestEnabled` — and this repository
 * has an untracked `apps/web/.env.local` that sets one. So `step-observe` was a
 * photograph of *this machine's configuration*: it said "Resolved live through
 * Soroban RPC on testnet" locally and "Live ingest is unavailable" on a runner
 * that has no `.env.local`. The image was never a property of the application.
 *
 * The byte check could not have told anyone that. It failed on the same shot for
 * what looked like the same reason as the two beside it, and the honest-looking
 * answer — "CI renders fonts differently" — was true of those two and wrong here.
 * Comparing text is what turned a rasterization complaint into a named sentence.
 *
 * So the environment is pinned here, next to the viewport and the locale and for
 * the same reason: a screenshot is not the place to discover what the machine
 * happened to have. `next start` inherits these, and `@next/env` leaves a value
 * already in `process.env` alone, so `.env.local` cannot reach back in.
 *
 * `SOROBAN_RPC_URL` is set because a configured endpoint is the state a deployed
 * Limen is in, and it is set to somewhere unroutable because nothing may reach
 * it. Only its emptiness is ever read — the value is server-side and never
 * rendered — and the discard port keeps the hermetic promise above literal: a
 * shot that started depending on a live read would fail here rather than bake
 * the answer into a PNG.
 *
 * The optional secrets are blanked rather than left alone, so a photographer who
 * has them in `.env.local` takes the same picture as a runner that does not.
 */
const SHOT_ENV = {
  SOROBAN_RPC_URL: 'http://127.0.0.1:9/rpc-is-never-called-during-shots',
  LIMEN_DEMO_SECRET: '',
  LIMEN_DEMO_DESTINATION: '',
  LIMEN_SIMULATION_SOURCE: '',
  ANTHROPIC_API_KEY: '',
  AGENT_SECRET: '',
};

/**
 * The account seeded into `localStorage`, so screens that list remembered
 * accounts render their populated state rather than their empty one.
 *
 * The same account `e2e/viewports.spec.ts` uses, and read from the deployments
 * file rather than typed, so a re-recorded run cannot leave a stale address
 * here.
 */
const deployments = JSON.parse(
  readFileSync(join(root, 'packages', 'chain', 'deployments', 'testnet.json'), 'utf8'),
);
const ACCOUNT = deployments.v4ChainRun?.smartAccount ?? deployments.smartAccount;
if (typeof ACCOUNT !== 'string') {
  throw new Error('no smart account in deployments/testnet.json — the manifest cannot be seeded');
}

const SEEDED_STORE = {
  version: 1,
  accounts: {
    [ACCOUNT]: { contractId: ACCOUNT, provenance: {}, addedAt: '2026-08-06T00:00:00.000Z' },
  },
};

/**
 * A shot is a route, a way to reach the state, and the element to crop to.
 *
 * `prepare` drives the page into the state worth photographing. Anything that
 * needs a click belongs there rather than in a coordinate, so the manifest stays
 * a statement about *what* is being shown.
 *
 * There used to be a `through`, extending a crop from one element's top edge to
 * another's bottom, for subjects that are a run of siblings with no wrapper
 * around them. The only shot that needed it was the refusal table on `/`, and
 * that shot is gone for the reason below. Twenty lines of crop arithmetic that
 * no manifest entry exercises is twenty lines that rot unnoticed and are wrong
 * by the time something needs them, so it went with its only caller. The git
 * history has it if a subject ever wants it back.
 */
/*
 * Nothing here is shot from `/`, and that is a rule rather than an accident.
 *
 * Two entries were: `refusal-table` cropped the permitted row and the refusals
 * under it, and `worked-example` cropped the Mechanism section. Both were shot
 * from the landing page, and both were destined *for* the landing page — which
 * renders each of them live, in HTML, a few hundred pixels below where the
 * image would have sat. A page illustrated with photographs of itself.
 *
 * The live markup beats the picture on every axis that matters here: its hashes
 * are read at build time so they cannot go stale, its text is selectable and
 * reaches a screen reader, and it needs no check to stay honest because there is
 * nothing to keep in step. The screenshot was strictly the worse copy, and it
 * carried a maintenance cost for the privilege.
 *
 * So a shot has to earn its place by showing something the page cannot show
 * itself: an application screen. All four below are from `/app`.
 */
const SHOTS = [
  {
    name: 'step-create',
    what: 'create — the two keys, before anything is generated',
    route: '/app/accounts/new',
    select: 'section:has(h2:has-text("Generate the two keys"))',
  },
  {
    name: 'step-derive',
    what: 'derive — the boundary synthesised from a shipped flow',
    route: '/app/simulator',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'simple-transfer' }).click();
      await beatButton(page, 2, 'Read the shipped flow');
      await page.waitForTimeout(1200);
    },
    select: 'ol > li:nth-child(3)',
  },
  {
    name: 'step-install',
    what: 'install — the exact policy set and the unsigned payload',
    route: '/app/simulator',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'simple-transfer' }).click();
      await beatButton(page, 2, 'Read the shipped flow');
      await beatButton(page, 3, 'Try to exceed it');
      await beatButton(page, 4, 'Read the policy');
      await page.waitForTimeout(1500);
    },
    select: 'ol > li:nth-child(5)',
  },
  {
    name: 'step-observe',
    what: 'observe — the transaction a boundary is derived from, read back',
    route: '/app/policies/new',
    select: 'section:has(h2:has-text("Observe a transaction"))',
  },

  /*
   * There is deliberately no `step-revoke`.
   *
   * PLAN-V5 §3 asks for four steps — create, derive, install, revoke — and the
   * first three are above. Revoke is missing because the only screen that shows
   * it is the policy detail screen, and that screen renders a live chain read.
   * Photographing it would commit a picture of one account's rule at one ledger
   * and call it a product screenshot: a second, unverifiable copy of chain state
   * in the repository, which is the exact failure this script exists to prevent.
   *
   * This was nearly missed. A shot named `step-revoke` pointed at
   * `/app/policies/new` and produced a perfectly good image — of the *observe*
   * step, which is what that route actually shows. The name claimed a capability
   * the picture did not demonstrate, which is the kind of small untruth this
   * project treats as the expensive kind. Renamed rather than re-pointed.
   *
   * So the landing's fourth step is a decision, not an oversight: either it
   * carries an SVG of the revoke path drawn from the same tokens, or the
   * sequence is honestly three screenshots and a described fourth. It does not
   * get a screenshot of a different screen wearing revoke's label.
   */
];

/**
 * Fails the run if anything inside the crop is scrolling horizontally.
 *
 * A scroll box on a live screen is a working control: the reader drags it and
 * sees the rest of the table. In a screenshot it is a column that has been cut
 * off, silently, in an artefact nobody reviews pixel by pixel — and the cut is
 * invisible in the image itself, because a clipped table looks exactly like a
 * narrow one.
 *
 * This is what keeps the viewport honest. The 900 above was chosen because the
 * simulator's policy tables need 736px and stop fitting at 860; if a column is
 * added, or a value grows, the run fails and names the element instead of
 * quietly shipping a picture with something missing.
 *
 * `sr-only` is excluded by construction: the visually-hidden idiom is a 1px box
 * clipped around real text, so it always overflows and always should.
 */
async function assertNothingScrolls(page, shot) {
  const cut = await page.locator(shot.select).first().evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((el) => el.clientWidth > 8 && el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 48),
        visible: el.clientWidth,
        actual: el.scrollWidth,
      })),
  );
  if (cut.length > 0) {
    const worst = cut.reduce((a, b) => (b.actual - b.visible > a.actual - a.visible ? b : a));
    throw new Error(
      `${shot.name}: a column is cut off — <${worst.tag} class="${worst.cls}"> shows ${worst.visible}px ` +
        `of ${worst.actual}px. Widen VIEWPORT past ${VIEWPORT.width + (worst.actual - worst.visible)} ` +
        'or crop to a subject that fits.',
    );
  }
}

/** Clicks the button in a beat and waits for the stepper to settle. */
async function beatButton(page, index, name) {
  const button = page.locator('ol').first().locator('> li').nth(index - 1).getByRole('button', { name });
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  await page.waitForTimeout(1200);
}

/* -------------------------------------------------------------------------- */

function log(...parts) {
  console.log('shots:', ...parts);
}

/** Where a shot's sidecar lives: beside its PNG, same stem. */
const sidecarPath = (dir, name) => join(dir, `${name}.json`);

/**
 * The text a shot is checked on.
 *
 * `innerText` is already close to what a reader sees — it honours `display:
 * none`, and it does not insert a break for a soft wrap, so a line that wraps
 * differently at the same viewport does not register as a change. What is left
 * to normalise is incidental: runs of spaces, the non-breaking spaces the value
 * formatters emit, and the blank lines that fall out of an empty inline element.
 *
 * Deliberately light. Every additional rule here is a class of drift the check
 * stops seeing, and the point of comparing text at all is that a changed hash
 * cannot hide in it.
 */
function subjectText(raw) {
  return raw
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * What a shot's sidecar records.
 *
 * `text` is the assertion. `route` and `select` are recorded with it because a
 * shot re-pointed at a different screen is the near-miss this manifest has
 * already had once — see the `step-revoke` note above — and a sidecar that names
 * its subject makes that visible in the diff rather than only in the image.
 */
function sidecar(shot, text) {
  return `${JSON.stringify({ name: shot.name, route: shot.route, select: shot.select, text }, null, 2)}\n`;
}

/**
 * The first line that differs, for an error message that says what moved.
 *
 * A changed transaction hash is one line out of forty, and "step-install no
 * longer matches" without it sends someone to a diff of a PNG they cannot read.
 */
function firstTextDifference(committed, rendered) {
  const a = committed.split('\n');
  const b = rendered.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const clip = (line) => (line === undefined ? '(end of text)' : `"${line.slice(0, 72)}"`);
      return `line ${i + 1}: committed ${clip(a[i])}, now ${clip(b[i])}`;
    }
  }
  return null;
}

/** Starts `next start` unless something already answers on the port. */
async function serve() {
  if (await reachable()) {
    // Said out loud, because a reused server was started by someone else and
    // `SHOT_ENV` never reached it — so it may be serving a different deployment
    // state, and a `--check` failure against it is not the application's fault.
    log(`reusing the server already answering on ${PORT} — its environment is not pinned by SHOT_ENV`);
    return null;
  }
  log(`starting next start on ${PORT}`);
  // The binary directly, not through `npx`. `npx next` resolves against the
  // registry before it will run a package that is already on disk, and on this
  // machine that turned a 25-second job into an eight-minute one — with stdout
  // buffered, so it looked like a hang rather than like waiting.
  const next = join(root, 'node_modules', '.bin', 'next');
  if (!existsSync(next)) throw new Error(`no next binary at ${next} — run \`npm install\``);
  const child = spawn(next, ['start', '--port', String(PORT)], {
    cwd: web,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ...SHOT_ENV },
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await reachable()) return child;
  }
  child.kill('SIGKILL');
  throw new Error(`the server never answered on ${PORT} — run \`npm run build\` first`);
}

async function reachable() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Renders every shot into `dir`.
 *
 * Returns the shots in manifest order so the caller can diff them; throws on the
 * first selector that finds nothing, because a manifest entry that silently
 * matched zero elements would leave the previous PNG in place and read as
 * "nothing changed".
 */
async function capture(dir) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    // The ground's heartbeat is a transition on a ledger read, and it is inside
    // these crops. Reduced motion parks it at phase 0 — see `globals.css`.
    reducedMotion: 'reduce',
    // A fixed locale and zone: a screenshot is not the place to discover that a
    // date renders differently on the machine that took it.
    locale: 'en-GB',
    timezoneId: 'UTC',
  });

  await context.addInitScript((store) => {
    window.localStorage.setItem('limen.v1', JSON.stringify(store));
  }, SEEDED_STORE);

  // Hermetic. A shot that needed a chain would fail here rather than bake a live
  // answer into a committed PNG.
  await context.route(CHAIN, (route) => route.abort());

  const page = await context.newPage();
  const written = [];

  for (const shot of SHOTS) {
    const began = Date.now();
    await page.goto(`${BASE}${shot.route}`, { waitUntil: 'domcontentloaded' });
    // Short, and allowed to expire. Chain requests are aborted above, and an
    // aborted request never settles into idle — so the default 30s timeout is
    // spent in full on every shot, six times, for nothing.
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    if (shot.prepare) await shot.prepare(page);

    // Nothing hovered, nothing focused: both are real states and neither is the
    // one being photographed.
    await page.mouse.move(2, 2);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(400);

    const target = page.locator(shot.select).first();
    if ((await page.locator(shot.select).count()) === 0) {
      throw new Error(`${shot.name}: \`${shot.select}\` matched nothing on ${shot.route}`);
    }
    await assertNothingScrolls(page, shot);

    // Scroll clear of the sticky top bar, then clip in viewport space — a
    // full-page clip would paint the sticky chrome across the subject.
    await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -72));
    await page.waitForTimeout(250);

    const box = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const pad = 20;
    const top = Math.max(56, Math.round(box.y - pad));
    const clip = {
      x: Math.max(0, Math.round(box.x - pad)),
      y: top,
      width: Math.round(box.width + pad * 2),
      height: Math.round(Math.min(box.y - top + box.height + pad, VIEWPORT.height - top)),
    };
    if (clip.width <= 0 || clip.height <= 40) {
      throw new Error(`${shot.name}: the crop came out empty (${JSON.stringify(clip)})`);
    }

    const file = join(dir, `${shot.name}.png`);
    await page.screenshot({ path: file, clip });

    // Read from the same locator, in the same settled state the shutter caught,
    // so the sidecar is a description of this image rather than of a second
    // render of the page.
    const text = subjectText(await target.evaluate((el) => el.innerText));
    if (text.length === 0) {
      throw new Error(`${shot.name}: the crop has no text, so there is nothing for --check to compare`);
    }
    writeFileSync(sidecarPath(dir, shot.name), sidecar(shot, text));

    written.push(shot.name);
    log(
      `${shot.name.padEnd(16)} ${String(clip.width).padStart(4)}×${String(clip.height).padEnd(4)} ` +
        `${String(((Date.now() - began) / 1000).toFixed(1)).padStart(5)}s  ${shot.what}`,
    );
  }

  await browser.close();
  return written;
}

/* -------------------------------------------------------------------------- */

const args = new Set(process.argv.slice(2));
const mode = args.has('--check') ? 'check' : args.has('--twice') ? 'twice' : 'write';

let server = null;
let status = 0;
try {
  server = await serve();

  if (mode === 'write') {
    // Cleared first, so a shot removed from the manifest does not linger as a
    // committed image nothing generates any more.
    if (existsSync(OUT)) rmSync(OUT, { recursive: true });
    await capture(OUT);
    log(`wrote ${SHOTS.length} images to apps/web/public/shots`);
  }

  if (mode === 'twice') {
    const a = join(root, '.shots-a');
    const b = join(root, '.shots-b');
    await capture(a);
    await capture(b);
    // The sidecar, not the image: that is what `--check` compares, so that is
    // what has to be stable for `--check` to be believable. Two runs on this
    // machine would agree on the bytes too; two machines would not, which is
    // the whole reason the check moved to text.
    const unstable = SHOTS.filter(
      ({ name }) =>
        readFileSync(sidecarPath(a, name), 'utf8') !== readFileSync(sidecarPath(b, name), 'utf8'),
    ).map(({ name }) => name);
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
    if (unstable.length > 0) {
      console.error(
        `shots: these render differently between two runs, so --check would never pass: ${unstable.join(', ')}`,
      );
      status = 1;
    } else {
      log(`all ${SHOTS.length} images are reproducible across two runs`);
    }
  }

  if (mode === 'check') {
    const tmp = join(root, '.shots-check');
    await capture(tmp);

    const drifted = [];
    const why = [];
    for (const shot of SHOTS) {
      const { name } = shot;
      // The image is still required to be present, even though it is no longer
      // compared: the landing imports it, and a sidecar with no PNG beside it
      // would pass this check and fail the build.
      if (!existsSync(join(OUT, `${name}.png`))) {
        drifted.push(`${name} (image never committed)`);
        continue;
      }
      if (!existsSync(sidecarPath(OUT, name))) {
        drifted.push(`${name} (no sidecar — regenerate to record its text)`);
        continue;
      }

      const committed = readFileSync(sidecarPath(OUT, name), 'utf8');
      const rendered = readFileSync(sidecarPath(tmp, name), 'utf8');
      if (committed === rendered) continue;

      drifted.push(name);
      const difference = firstTextDifference(JSON.parse(committed).text, JSON.parse(rendered).text);
      why.push(
        difference === null
          ? `shots: ${name}: the text is unchanged, but the manifest now photographs a different subject.`
          : `shots: ${name}: ${difference}`,
      );
    }

    const produced = new Set(SHOTS.flatMap(({ name }) => [`${name}.png`, `${name}.json`]));
    const extra = existsSync(OUT)
      ? readdirSync(OUT).filter((f) => (f.endsWith('.png') || f.endsWith('.json')) && !produced.has(f))
      : [];
    rmSync(tmp, { recursive: true, force: true });

    if (drifted.length > 0 || extra.length > 0) {
      if (drifted.length > 0) {
        const one = drifted.length === 1;
        console.error(
          `shots: ${drifted.join(', ')} no longer ${one ? 'matches' : 'match'} what the application renders.\n` +
            `shots: the page ${one ? 'it illustrates' : 'these illustrate'} has changed, or the data underneath ` +
            `${one ? 'it' : 'them'} has.\n` +
            [...why, 'shots: run `npm run shots` and commit the result.'].join('\n'),
        );
      }
      if (extra.length > 0) {
        console.error(`shots: ${extra.join(', ')} is committed but no manifest entry produces it.`);
      }
      status = 1;
    } else {
      log('up to date');
    }
  }
} catch (error) {
  console.error(`shots: ${error instanceof Error ? error.message : String(error)}`);
  status = 1;
} finally {
  if (server) server.kill('SIGKILL');
}

process.exit(status);
