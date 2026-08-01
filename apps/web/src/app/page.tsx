import { PolicyReview } from '@/components/PolicyReview';
import { DEFAULT_FIXTURE_KEY, FIXTURES } from '@/fixtures';

export default function Home() {
  const initial = FIXTURES[DEFAULT_FIXTURE_KEY];
  if (initial === undefined) throw new Error(`missing fixture ${DEFAULT_FIXTURE_KEY}`);

  return (
    <main className="mx-auto flex w-full max-w-[100rem] flex-col gap-8 px-5 py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[19px] font-semibold tracking-wide text-foreground">
          LIMEN <span className="text-muted-dim">— the permission layer for agentic money</span>
        </h1>
        <p className="max-w-[80ch] text-muted">
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

      <footer className="border-t border-border-subtle pt-4 text-muted-dim">
        Policy is synthesized deterministically; the same transaction always produces the same
        proposal. Claude explains the result and phrases the intent question — it never authors
        authorization logic. Every policy is a configuration of an existing audited OpenZeppelin
        primitive; no code is generated.
      </footer>
    </main>
  );
}
