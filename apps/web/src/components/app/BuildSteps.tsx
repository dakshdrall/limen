import Link from 'next/link';

/**
 * Where you are in the build, on every screen of it.
 *
 * The builder is three routes now rather than three sections, and the thing a
 * stacked flow gave away for free was orientation: you could see the steps
 * because they were all on the page. Splitting the screens buys a working back
 * button and a URL per step, and it costs exactly that, so this pays it back.
 *
 * ## It reports position, it does not offer navigation forward
 *
 * A step behind the current one is a link, because going back is a real thing
 * to do and the browser's back button should not be the only way to do it. The
 * current step and anything ahead of it are plain text. Linking forward would
 * offer a review of limits that have not been drafted and a deploy of a
 * boundary that does not exist — controls for things that cannot happen, which
 * is the one kind of control this application does not render.
 *
 * That is also why `agentId` is optional. On the first screen there is no agent
 * yet, so there is nothing for the later steps to link to even in principle,
 * and they render as what they are: two things that have not happened.
 */

const STEPS = [
  { id: 'strategy', label: 'strategy' },
  { id: 'review', label: 'review' },
  { id: 'deploy', label: 'deploy' },
] as const;

export type BuildStep = (typeof STEPS)[number]['id'];

export function BuildSteps({ current, agentId }: { current: BuildStep; agentId?: string }) {
  const index = STEPS.findIndex((step) => step.id === current);

  return (
    <nav aria-label="Build progress" className="flex flex-col gap-2">
      <span className="col-head text-muted-dim">build</span>
      <ol className="flex flex-col gap-1">
        {STEPS.map((step, position) => {
          const state = position < index ? 'done' : position === index ? 'current' : 'ahead';
          // Only a completed step with an agent behind it can be returned to.
          const href =
            state === 'done' && agentId !== undefined
              ? step.id === 'strategy'
                ? '/app/agents/new'
                : `/app/agents/${agentId}/${step.id}`
              : null;

          const body = (
            <span className="flex items-baseline gap-2">
              <span
                aria-hidden
                className={`font-mono text-[10.5px] ${
                  state === 'current' ? 'text-accent' : 'text-faint'
                }`}
              >
                {position + 1}
              </span>
              <span
                className={`font-mono text-[11.5px] tracking-[0.1em] uppercase ${
                  state === 'current'
                    ? 'text-foreground'
                    : state === 'done'
                      ? 'text-muted'
                      : 'text-faint'
                }`}
              >
                {step.label}
              </span>
            </span>
          );

          return (
            <li key={step.id} aria-current={state === 'current' ? 'step' : undefined}>
              {href === null ? (
                body
              ) : (
                <Link href={href} className="hover:text-foreground">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
