import { Landing } from '@/components/landing/Landing';
import { PolicyReview } from '@/components/PolicyReview';
import { DEFAULT_FIXTURE_KEY, FIXTURES } from '@/fixtures';

export default function Home() {
  const initial = FIXTURES[DEFAULT_FIXTURE_KEY];
  if (initial === undefined) throw new Error(`missing fixture ${DEFAULT_FIXTURE_KEY}`);

  return (
    <main className="flex w-full flex-col">
      <Landing />

      {/* The demo. Scrolls normally — nothing here is pinned, because every
          section of it is meant to be compared against the others. */}
      <section
        id="demo"
        className="mx-auto flex w-full max-w-[92rem] flex-col gap-14 border-t border-border-subtle px-6 py-16 sm:px-10"
      >
        <header className="flex flex-col gap-3">
          <span className="eyebrow-lead text-faint">the demo</span>
          <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-foreground">
            Derivation, end to end
          </h2>
          <p className="max-w-[76ch] text-[14px] leading-relaxed text-muted">
            A transaction is performed once. Limen derives the minimum smart-account context rule and
            policy set that permits exactly that flow, and refuses everything adjacent to it. An agent
            then operates inside that boundary and never holds a key.
          </p>
        </header>

        <PolicyReview
          initialTransaction={initial}
          initialKey={DEFAULT_FIXTURE_KEY}
          fixtureKeys={Object.keys(FIXTURES)}
        />

        <footer className="max-w-[86ch] border-t border-border-subtle pt-6 text-[12.5px] leading-relaxed text-muted-dim">
          Policy is synthesized deterministically; the same transaction always produces the same
          proposal. Claude explains the result and phrases the intent question — it never authors
          authorization logic. Every policy is a configuration of an existing audited OpenZeppelin
          primitive; no code is generated.
        </footer>
      </section>
    </main>
  );
}
