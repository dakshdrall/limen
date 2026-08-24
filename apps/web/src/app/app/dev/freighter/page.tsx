import { notFound } from 'next/navigation';
import { FreighterProbe } from '@/components/app/FreighterProbe';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { probesEnabled } from '@/lib/dev-probe';

export const metadata = {
  title: 'Limen — Freighter probe (dev)',
  description:
    'A development probe: what Freighter’s signMessage actually returns, and whether a server can verify it from the account’s public key alone.',
  // A page that exists to be run once by one person, not to be found. The
  // route is deliberately absent from the header nav for the same reason.
  robots: { index: false, follow: false },
};

/**
 * The probe screen. Development only, and a 404 anywhere else.
 *
 * `notFound()` rather than a rendered refusal: a page that says *"this probe is
 * disabled in production"* still tells a visitor the route exists, and there is
 * nothing to gain from that. `probesEnabled` fails closed — an environment it
 * cannot classify is treated as production.
 *
 * Kept out of `SiteHeader`'s `SECTIONS` on purpose. It is not a section of the
 * product; it is an experiment with a URL, and it goes away when the question
 * it was built to answer has an answer.
 */
export default function FreighterProbePage() {
  if (!probesEnabled()) notFound();

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="dev probe"
        title="Freighter signMessage"
        lede={
          <>
            <p>
              Not part of the product and not linked from anywhere. This exists to settle one
              question: <em>does Freighter sign a message in a way a server can verify from the
              account&rsquo;s public key alone</em>, and if so, over which bytes.
            </p>
            <p>
              The answer decides whether wallet sign-in is buildable. It is measured here rather
              than assumed, because the signing happens inside a browser extension whose code is
              not in this repository — <span className="value">@stellar/freighter-api</span>{' '}
              contains no signing code at all.
            </p>
          </>
        }
        labels={['TESTNET ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']}
      />

      <FreighterProbe />
    </main>
  );
}
