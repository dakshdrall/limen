import { BuildSteps } from '@/components/app/BuildSteps';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { StrategyInput } from '@/components/app/StrategyInput';

export const metadata = {
  title: 'Limen — build an agent',
  description:
    'Describe a trading strategy, review the limits it would run under, and deploy it onto Stellar testnet inside a boundary the network enforces.',
};

/**
 * Build an Agent — step one of three, and the screen is the step.
 *
 * ## What moved, and why it is not here any more
 *
 * This screen opened with two paragraphs and four status labels stacked above a
 * three-row textarea, and then revealed the review and deploy sections below
 * itself as they became reachable. Two things were wrong with that.
 *
 * The first is order. A person arriving to build an agent met an explanation
 * before the thing being explained. The two paragraphs said that a model reads
 * the description and that nothing reaches the chain until the review step —
 * both true, and both *about the review step*, which is where they now are.
 * Copy belongs on the screen it is about; read a step early it is a caveat, and
 * read in place it is an instruction.
 *
 * The second is that sections stacking below one another are not steps. There
 * was one URL for the whole flow, so the back button left the builder entirely,
 * a reload lost everything, and the proposal existed only in the tab that
 * generated it. Three routes fix all three, and the cost is that orientation
 * has to be drawn rather than implied — see {@link BuildSteps}.
 *
 * ## The labels stay, and they moved rather than shrank
 *
 * `ScreenHeader` requires them, and the requirement is right: every screen here
 * is testnet-only and unaudited, and a screen that could omit that is a screen
 * that eventually does. They are above the fold and beside the input rather
 * than in a row under the title, which keeps them read without making them the
 * first four things on the page.
 *
 * ## The layout uses the width because a console should
 *
 * A single measure-width column on a wide screen reads as a page that has not
 * finished loading. The input takes the room — a strategy is a few sentences
 * and wants to look like it — and the rail beside it carries position and
 * caveats, which are exactly the things you want visible and not in the way.
 * Below the `lg` breakpoint the two stack, input first.
 */
export default function NewAgentPage() {
  return (
    <main className="screen">
      <ScreenHeader eyebrow="build" title="Build an Agent" labels={['TESTNET ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12">
        <div className="flex flex-col gap-4">
          <p className="measure text-[13px] leading-relaxed text-muted">
            Say what the agent should do and what it may spend. Limen drafts the limits from it,
            you correct them on the next screen, and only then does anything reach a chain.
          </p>

          <StrategyInput />
        </div>

        <aside className="flex flex-col gap-8 lg:border-l lg:border-border-subtle lg:pl-8">
          <BuildSteps current="strategy" />

          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">what this does not do</span>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Nothing here places a trade. This flow installs a boundary on a smart account —
              the limits an agent cannot exceed — and stops there.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
