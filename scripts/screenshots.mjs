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
 * ## Determinism
 *
 * `--check` compares bytes, so a shot that renders differently twice would be
 * permanently stale and the check would cry wolf until someone stopped believing
 * it. Four things make a run reproducible, and `--twice` proves it rather than
 * assuming it:
 *
 *   - a fixed viewport and `deviceScaleFactor: 2`;
 *   - `reducedMotion: 'reduce'`, which parks the ground's heartbeat at phase 0
 *     and collapses every transition — the ground is *in* these crops;
 *   - no network, so nothing live can vary;
 *   - crops taken from a locator's own box, so a reflow moves the crop with the
 *     content instead of slicing it.
 *
 * ## Usage
 *
 *     npm run shots           regenerate and write
 *     npm run shots:check     fail if any committed image has drifted
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

const PORT = Number(process.env.SHOTS_PORT ?? 3121);
const BASE = `http://127.0.0.1:${PORT}`;

/** Chain endpoints. Aborted, so no shot can depend on a live answer. */
const CHAIN = /soroban-testnet\.stellar\.org|horizon-testnet\.stellar\.org|friendbot/i;

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
 * `through` extends the crop from `select`'s top edge to that element's bottom
 * edge. Some of what is worth photographing is a run of siblings with no wrapper
 * around it — the permitted row and the refusal table under it are two children
 * of a `Section` and nothing else — and the alternative is either a pixel height
 * or a wrapper `div` added to the page for the benefit of a screenshot tool.
 * Both are worse: one goes stale silently, the other lets this script dictate
 * the markup.
 */
const SHOTS = [
  {
    name: 'refusal-table',
    what: 'the permitted row and the six refusals under it, with real hashes',
    route: '/',
    // Anchored on the permit line, which only `PermittedRow` draws, and carried
    // down through the refusal table's own scroll box. The section heading and
    // the prose after it are deliberately outside the crop: this is meant to be
    // a picture of the instrument, not of the page it sits on.
    select: 'main div.border-permit-line',
    through: 'main div.scroll-x',
  },
  {
    name: 'worked-example',
    what: 'observed, derived and installed, each beside the hash that proves it',
    route: '/',
    select: 'section:has(h2:has-text("Mechanism"))',
  },
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

/** Starts `next start` unless something already answers on the port. */
async function serve() {
  if (await reachable()) {
    log(`reusing the server already answering on ${PORT}`);
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
    viewport: { width: 1280, height: 1100 },
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
    if (shot.through && (await page.locator(shot.through).count()) === 0) {
      throw new Error(`${shot.name}: \`${shot.through}\` matched nothing on ${shot.route}`);
    }

    // Scroll clear of the sticky top bar, then clip in viewport space — a
    // full-page clip would paint the sticky chrome across the subject.
    await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -72));
    await page.waitForTimeout(250);

    const box = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (shot.through) {
      const end = await page.locator(shot.through).first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { bottom: r.bottom, right: r.right };
      });
      box.height = end.bottom - box.y;
      box.width = Math.max(box.width, end.right - box.x);
      if (box.height <= 0) {
        throw new Error(
          `${shot.name}: \`${shot.through}\` ends above \`${shot.select}\` starts — the two are in the wrong order`,
        );
      }
    }
    const pad = 20;
    // A `through` crop ends exactly where the named element ends. Its container
    // is usually a flex column with a gap, so a symmetric pad reaches past the
    // gap and clips the top of whatever comes next — a caption sliced in half
    // reads as a broken image rather than as a deliberate crop.
    const padBottom = shot.through ? 8 : pad;
    const top = Math.max(56, Math.round(box.y - pad));
    const clip = {
      x: Math.max(0, Math.round(box.x - pad)),
      y: top,
      width: Math.round(box.width + pad * 2),
      height: Math.round(Math.min(box.y - top + box.height + padBottom, 1100 - top)),
    };
    if (clip.width <= 0 || clip.height <= 40) {
      throw new Error(`${shot.name}: the crop came out empty (${JSON.stringify(clip)})`);
    }

    const file = join(dir, `${shot.name}.png`);
    await page.screenshot({ path: file, clip });
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
    const unstable = SHOTS.filter(
      ({ name }) => !readFileSync(join(a, `${name}.png`)).equals(readFileSync(join(b, `${name}.png`))),
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
    for (const { name } of SHOTS) {
      const committed = join(OUT, `${name}.png`);
      if (!existsSync(committed)) {
        drifted.push(`${name} (never committed)`);
        continue;
      }
      if (!readFileSync(committed).equals(readFileSync(join(tmp, `${name}.png`)))) {
        drifted.push(name);
      }
    }
    const extra = existsSync(OUT)
      ? readdirSync(OUT).filter((f) => f.endsWith('.png') && !SHOTS.some((s) => `${s.name}.png` === f))
      : [];
    rmSync(tmp, { recursive: true, force: true });

    if (drifted.length > 0 || extra.length > 0) {
      if (drifted.length > 0) {
        const one = drifted.length === 1;
        console.error(
          `shots: ${drifted.join(', ')} no longer ${one ? 'matches' : 'match'} what the application renders.\n` +
            `shots: the page ${one ? 'it illustrates' : 'these illustrate'} has changed, or the data underneath ` +
            `${one ? 'it' : 'them'} has.\n` +
            'shots: run `npm run shots` and commit the result.',
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
