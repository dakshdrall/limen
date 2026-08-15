import { ScreenHeader } from '@/components/app/ScreenHeader';
import { TryFlow } from '@/components/app/TryFlow';

export const metadata = {
  title: 'Limen — try it end to end',
  description:
    'Create a smart account, derive a boundary from a transaction it made, install it, and watch an agent run inside it — nine real testnet transactions, in one guided path.',
};

/**
 * The path, where the four reference screens are the reference view.
 *
 * PLAN-V7 §3. Everything this route does was already reachable before it
 * existed: `/app/accounts/new` → `/app/accounts/[id]` → `/app/policies/new` →
 * `/app/policies/[id]`, with a person working out at each boundary what happened
 * next. The capability was there and the wayfinding was not, and a product whose
 * central claim takes four screens and a guess to reach is a product nobody
 * reaches the claim of.
 *
 * It forks none of the logic. `TryFlow` calls `lib/chain-actions.ts`, which is
 * what the four screens call — see §3.4, and the module's own header for why the
 * seam is drawn under the UI rather than through it.
 *
 * ## The labels, and the one that is missing
 *
 * `TESTNET ONLY`, `NOT AUDITED`, `COMPOSITION ONLY` — and no `NO CUSTODY`, for
 * the same reason `/app/accounts/new` omits it. This flow generates a key whose
 * whole purpose is to move testnet funds, and claiming custody of nothing on the
 * one page that creates a spending key would be exactly the inaccuracy the label
 * set exists to prevent.
 *
 * `NOT AUDITED` is also what satisfies the provenance gate on arrival: this
 * screen carries no numbers until it has read some, which is the same position
 * `/app/accounts/new` is in.
 */
export default function TryPage() {
  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="interface"
        title="Try it end to end"
        lede={
          <>
            <p>
              Six steps and nine real transactions on Stellar testnet: a smart account created from
              this browser, a boundary derived from a transaction that account actually made, and an
              agent run inside it — permitted under the cap, refused over it, and refused again when
              it tries to remove the boundary itself.
            </p>
            <p>
              Every step says what it did and links the hash it did it with. Nothing here is a
              simulation, and nothing is a shipped fixture — the fixtures live in the{' '}
              <a href="/app/simulator" className="link">
                simulator
              </a>
              , which spends nothing.
            </p>
          </>
        }
        labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']}
      />

      <TryFlow />
    </main>
  );
}
