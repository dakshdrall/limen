import { NewAccountScreen } from '@/components/app/NewAccountScreen';
import { ScreenHeader } from '@/components/app/ScreenHeader';

export const metadata = {
  title: 'Limen — create an account',
  description:
    'Create an OpenZeppelin smart account on Stellar testnet from the browser, owned by a disposable key generated in the page.',
};

/**
 * The screen that was absent rather than broken.
 *
 * Everything before v4 read the chain; nothing wrote to it, because writing
 * needs an owner signature and no browser signer existed. This is where that
 * stops being true, and the labels say so precisely: `TESTNET ONLY` and `NOT
 * AUDITED` as everywhere else, and no custody label — the key created here
 * exists so it can move testnet funds, and claiming otherwise on the one screen
 * that generates it would be the exact inaccuracy the label set exists to
 * prevent.
 *
 * `NO CUSTODY` was retired in V8 M1 and its replacement, `NO OWNER CUSTODY`, is
 * true on this screen. It is still not rendered here: see `/app/try` for the
 * reason, which is about what a second label does to the loud one beside it
 * rather than about whether the sentence is accurate.
 */
export default function NewAccountPage() {
  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="interface"
        title="Create an account"
        lede={
          <>
            <p>
              A smart account, deployed from this browser and owned by a key generated in it. No
              wallet, no sign-in, and nothing of yours on a Limen server — the fee is paid by a
              testnet account friendbot funds a few seconds before it is spent.
            </p>
            <p>
              The owner key is disposable and cannot be exported. Clearing this browser&rsquo;s site
              data destroys it, and with it the account it owns. That is stated here rather than
              discovered later.
            </p>
          </>
        }
        labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY', 'IN DEVELOPMENT']}
      />

      <NewAccountScreen />
    </main>
  );
}
