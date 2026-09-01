import { CandleTape } from '@/components/landing/CandleTape';
import { CapTrack } from '@/components/landing/CapTrack';
import { PriceTapeArt, SillArt, VolumeArt } from '@/components/landing/LandingArt';
import { SilverHeading } from '@/components/landing/SilverHeading';
import { chainTxUrl } from '@/lib/explorer';
import { decimalise, describeAmount, ledgersToDuration, truncateHash } from '@/lib/format';
import {
  RECORDED_TRADING,
  RECORDED_TRADING_REFUSED,
  RECORDED_TRADING_SETTLED,
  recordedTradingWindowLedgers,
} from '@/lib/recorded-runs';

/**
 * The narrative surface, ported from `prototype/limen-landing.html`.
 *
 * It lives at `/landing` and not at `/`. The nine-scene argument at `/` is
 * untouched by this change and both are now reachable, which is the point: they
 * are two answers to the same question and the comparison is the deliverable,
 * not the switch.
 *
 * ## Where the chrome comes from
 *
 * The prototype is a standalone document, so it drew its own header and its own
 * footer. This route renders under the root layout, which already puts
 * `SiteHeader` and `SiteFooter` on every surface — so those are not ported, and
 * porting them would have produced two of each. The palette follows the page
 * rather than the other way round: `body:has(.landing)` in `globals.css`
 * re-points the tokens the chrome already reads, so the shared header and
 * footer render in this surface's black and gold without either component
 * learning that a third palette exists. That is how `.console` does it.
 *
 * The one thing lost with the prototype's header is its three-entry section nav.
 * The in-page anchors it pointed at are all still here and still work — the hero
 * links to `#proof` and `#app` directly — so nothing is unreachable; there is
 * simply one fewer route to it.
 *
 * ## Every figure is read, none is typed
 *
 * The cap, both amounts, both hashes and the contract error come from
 * `RECORDED_TRADING`, which is the C0 run in `deployments/testnet.json`.
 * `evidence.test.ts` fails the build if a hash or an address is typed into any
 * file that renders, and that rule is the reason this page reads rather than
 * quotes — but it would be the right shape without the rule, because the claim
 * the page makes is that these are checkable.
 */

/**
 * The cap demonstration's labels, derived from the recorded integers.
 *
 * The bar *widths* are in `landing.css`, and the comment there sets out the
 * geometry: the line at 40% of the track, the settled bar at 12%, the refused
 * bar at 200% and clipped. Both halves are computed from these same stroop
 * values, so the picture and the labels cannot disagree — but they are computed
 * in two files, which is worth stating plainly since it is the one seam here
 * that a future edit could pull apart.
 *
 * "daily" is not a word this page is free to use. It is true only because the
 * recorded window is 17280 ledgers and a Stellar ledger is about five seconds,
 * which `ledgersToDuration` turns into a day. So the label asks that function
 * and uses the word only if it agrees; if the run is ever re-recorded against a
 * different window, the label silently drops back to naming no period rather
 * than confidently naming the wrong one.
 */
function capLabel(): string {
  const cap = decimalise(RECORDED_TRADING.cap);
  const ledgers = recordedTradingWindowLedgers;
  const daily = ledgers !== undefined && ledgersToDuration(ledgers) === '≈ 1 day';
  return daily ? `${cap} XLM daily limit` : `${cap} XLM limit`;
}

/** The prose the recording does not carry: what each outcome is called. */
const VERDICT_LABEL = {
  settled: 'settled',
  refused: 'refused by the account',
} as const;

export default function LandingPage() {
  const refusalCode = RECORDED_TRADING_REFUSED?.contractError;

  const rows = [
    RECORDED_TRADING_SETTLED === undefined
      ? undefined
      : {
          amount: describeAmount(BigInt(RECORDED_TRADING_SETTLED.amount)),
          verdict: VERDICT_LABEL.settled,
          refused: false,
          hash: RECORDED_TRADING_SETTLED.hash,
          hashLabel: truncateHash(RECORDED_TRADING_SETTLED.hash, 8, 5),
          href: chainTxUrl(RECORDED_TRADING_SETTLED.hash),
        },
    RECORDED_TRADING_REFUSED === undefined
      ? undefined
      : {
          amount: describeAmount(BigInt(RECORDED_TRADING_REFUSED.amount)),
          verdict: VERDICT_LABEL.refused,
          refused: true,
          hash: RECORDED_TRADING_REFUSED.hash,
          hashLabel: truncateHash(RECORDED_TRADING_REFUSED.hash, 8, 5),
          href: chainTxUrl(RECORDED_TRADING_REFUSED.hash),
          error:
            refusalCode === undefined
              ? undefined
              : {
                  code: refusalCode,
                  rest: ' — raised by the rule living in the account, before the swap reached Soroswap.',
                },
        },
  ].filter((row) => row !== undefined);

  return (
    <main className="screen" id="top">
      <section className="hero">
        <CandleTape />
        <SilverHeading as="h1">Your agent trades. The account holds the line.</SilverHeading>
        <p className="lede">
          Limen deploys autonomous trading agents on Stellar. The spending limit lives inside the
          account, not inside our code — so a trade past it fails on the ledger, with a hash you can
          look up.
        </p>
        {/* TODO: production has neither LIMEN_MASTER_KEY nor LIMEN_RUNTIME_URL set, so the deploy
            path behind "Deploy an agent" and "Open the app" cannot actually deploy an agent yet.
            Deliberately left as a plain link: no env check, no feature flag, no disabled state.
            Where these should point once the runtime has its credentials is a routing decision
            that belongs in its own change. */}
        <div className="actions">
          <a className="btn" href="#app">
            Deploy an agent
          </a>
          <a className="btn ghost" href="#proof">
            See the refusal
          </a>
        </div>
      </section>

      <hr className="sill" />

      <section id="proof">
        <PriceTapeArt />
        <SilverHeading lite>A refusal anyone can look up</SilverHeading>
        <p className="say">
          Two swaps, same agent key, same daily limit, same venue. One settled. The other was
          rejected by the account itself before it reached the market — and the rejection is on the
          ledger, with a fee paid and a contract error attached.
        </p>

        <div className="proof">
          <CapTrack capLabel={capLabel()} rows={rows} />

          <p className="aside">
            We could have caught the second trade in simulation. We didn&rsquo;t. A simulated
            refusal costs nothing and leaves nothing behind — so this one was put on a ledger on
            purpose.
          </p>
        </div>
      </section>

      <hr className="sill" />

      <section id="build">
        <SillArt />
        <SilverHeading lite>From a sentence to a signed limit</SilverHeading>
        <p className="say">
          Three screens. Nothing reaches your account until you have read the exact rules it will
          carry.
        </p>

        <div className="flow">
          <div className="step">
            <span className="tick" />
            <h3>Describe the strategy</h3>
            <p>
              Say what the agent should do in plain words. Limen reads out a venue, a pair, and the
              condition that makes it act.
            </p>
          </div>
          <div className="step">
            <span className="tick" />
            <h3>Read the limits</h3>
            <p>
              Limen derives a boundary from the trade you described and shows the rules line by
              line. Accept them and that exact proposal is stored.
            </p>
          </div>
          <div className="step">
            <span className="tick" />
            <h3>Install and verify</h3>
            <p>
              The stored rules are installed on your smart account, then read back from the network.
              If the ledger disagrees with what you accepted, the deploy fails.
            </p>
          </div>
        </div>
      </section>

      <hr className="sill" />

      <section>
        <SilverHeading lite>The boundary is derived, not authored</SilverHeading>
        <p className="say">
          A blank policy form asks you to imagine every trade in advance and price it. Limen reads
          the limit off the trade you already described, and shows its work before anything is
          signed.
        </p>

        <div className="derive">
          <div className="cell">
            <h4>Authored</h4>
            <span className="fake-field">max_spend_per_window …</span>
            <span className="fake-field">allowed_contracts[] …</span>
            <span className="fake-field">window_ledgers …</span>
            <p>You guess the numbers, then find out at the venue whether they were right.</p>
          </div>
          <div className="cell now">
            <h4>Derived</h4>
            <p className="observed">
              swap <b>XLM → USDC</b>
              <br />
              venue <b>Soroswap router</b>
              <br />
              size <b>0.3 XLM</b> per cycle
            </p>
            <p>
              The limit and the callable contract come out of that trade. You approve two rules you
              can read, not a form you have to fill.
            </p>
          </div>
        </div>
      </section>

      <hr className="sill" />

      <section>
        <SilverHeading lite>Two kinds of no</SilverHeading>
        <p className="say">
          Most agent platforms have one refusal and one voice behind it. Limen keeps them apart,
          because only one of them is a guarantee.
        </p>

        <div className="pair">
          <div className="col network">
            <SilverHeading as="h3" lite>
              The account refuses
            </SilverHeading>
            <p>
              Enforced by your smart account on Stellar. Comes back as a ledger entry with a hash
              and a contract error. Limen cannot switch it off.
            </p>
            <ul>
              <li>
                Spending beyond the limit{refusalCode === undefined ? '' : ' — '}
                {refusalCode === undefined ? null : <code>{refusalCode}</code>}
              </li>
              <li>Calling a contract the agent was never granted</li>
              <li>Acting after the rule expires or is revoked on-chain</li>
            </ul>
          </div>
          <div className="col">
            <SilverHeading as="h3" lite>
              Limen refuses
            </SilverHeading>
            <p>
              Checked before signing, for the things a contract cannot see. No hash, and the app
              never pretends there is one.
            </p>
            <ul>
              <li>Agent paused, or its key is no longer a signer</li>
              <li>Recipient is not on your list</li>
              <li>Position size or pair outside what you accepted</li>
              <li>No amount check here — that one belongs to the network</li>
            </ul>
          </div>
        </div>
      </section>

      <hr className="sill" />

      <section className="close" id="app">
        <VolumeArt />
        <SilverHeading>Deploy one agent and try to break it</SilverHeading>
        <p className="say">
          Fund a testnet account, describe a strategy, accept the limits, then send it past them and
          watch the ledger say no.
        </p>
        {/* TODO: same as the hero — neither LIMEN_MASTER_KEY nor LIMEN_RUNTIME_URL is set in
            production, so this path cannot deploy yet. Left pointing where the prototype pointed. */}
        <div className="actions">
          <a className="btn" href="https://limen.cash">
            Open the app
          </a>
          <a className="btn ghost" href="https://github.com/dakshdrall/limen">
            Read the code
          </a>
        </div>
      </section>
    </main>
  );
}
