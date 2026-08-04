import { connection } from 'next/server';
import { Landing } from '@/components/landing/Landing';
import { PolicyReview } from '@/components/PolicyReview';
import { DEFAULT_FIXTURE_KEY, FIXTURES, REFUSING_FIXTURES } from '@/fixtures';

export default async function Home() {
  const initial = FIXTURES[DEFAULT_FIXTURE_KEY];
  if (initial === undefined) throw new Error(`missing fixture ${DEFAULT_FIXTURE_KEY}`);

  // Read at request time, not at build time: whether an RPC endpoint is
  // configured is a property of the deployment, and baking it into prerendered
  // HTML would leave the hash input permanently disabled on a deployment that
  // later gained one.
  await connection();
  // The boolean, never the endpoint. The RPC URL is server-side only and never
  // crosses into the client bundle.
  const liveIngestEnabled = (process.env.SOROBAN_RPC_URL ?? '').length > 0;

  return (
    <main className="flex w-full flex-col">
      <Landing />

      {/* The demo. Scrolls normally — nothing here is pinned, because every
          section of it is meant to be compared against the others. */}
      {/* Sits on the ruled ground rather than being cut out of it: a surface
          step and a hairline border, no shadow. */}
      <section
        id="demo"
        className="on-ground mx-auto my-10 flex w-full max-w-[92rem] flex-col gap-14 px-6 py-16 sm:px-10"
      >
        <header className="flex flex-col gap-3">
          <span className="eyebrow-lead text-faint">the demo</span>
          <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-foreground">
            Derivation, end to end
          </h2>
          <p className="measure text-[14px] leading-relaxed text-muted">
            A transaction is performed once. Limen derives the minimum smart-account context rule and
            policy set that permits exactly that flow, and refuses everything adjacent to it. An agent
            then operates inside that boundary and never holds a key.
          </p>
        </header>

        <PolicyReview
          initialTransaction={initial}
          initialKey={DEFAULT_FIXTURE_KEY}
          fixtureKeys={Object.keys(FIXTURES)}
          refusingKeys={[...REFUSING_FIXTURES]}
          liveIngestEnabled={liveIngestEnabled}
        />

        <footer className="measure border-t border-border-subtle pt-6 text-[12.5px] leading-relaxed text-muted-dim">
          Policy is synthesized deterministically; the same transaction always produces the same
          proposal. Claude explains the result and phrases the intent question — it never authors
          authorization logic. Every policy is a configuration of an existing audited OpenZeppelin
          primitive; no code is generated.
        </footer>
      </section>
    </main>
  );
}
