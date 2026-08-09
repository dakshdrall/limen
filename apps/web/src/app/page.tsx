/**
 * Placeholder. The narrative site is PLAN-V6 step 3 and replaces this file.
 *
 * It renders one figure rather than "hello world" on purpose: the figure is read
 * from `generated/evidence.json`, which is written by `scripts/evidence.mjs`
 * from the deployments file and the test suites. So even the scaffold obeys the
 * rule that survives the rebuild — every claim on the site is read from a
 * generated source, and nothing is typed.
 */

import { EVIDENCE } from "@/lib/evidence";

export default function Home() {
  return (
    <main className="p-12">
      <p className="text-sm">
        Scaffold. {EVIDENCE.chain.transactions} recorded transactions on{" "}
        {EVIDENCE.chain.network}, as of {EVIDENCE.chain.recordedAt}.
      </p>
    </main>
  );
}
