import { Children } from 'react';
import Link from 'next/link';
import { WaitlistButton } from '@/components/landing/WaitlistButton';
import { EVIDENCE } from '@/lib/evidence';
import { REPOSITORY, REPOSITORY_ISSUES, repositoryFile } from '@/lib/repository';

/**
 * The landing's footer: four columns, and the provenance statement under them.
 *
 * PLAN-V5 §3.4. The paragraph at the bottom was the whole footer before this,
 * and the columns are added **above** it rather than in place of it. That is the
 * load-bearing decision here and it is easy to get backwards: the paragraph
 * states that every hash, address, cap and count on this page is read at build
 * time from two named files. It is the page's provenance, not footer
 * boilerplate, and demoting it to a line of small print beside a copyright is
 * how the most important sentence on the page stops being read.
 *
 * The columns exist to do something the paragraph cannot: name those two files
 * as links, so *"read at build time from"* is checkable in one click rather than
 * being a claim about a repository the reader has to go and find.
 *
 * ## Why the links are not `.link`
 *
 * `.link` is underlined in the rule colour and brightens to the accent, which is
 * right for a link inside a sentence, where it has to be findable in running
 * prose. Fourteen of them stacked in four columns is a wall of underlines. These
 * are a list — the list *is* the affordance — so they take the quiet chrome
 * treatment `TopBar` and the section nav already use, and the underline is saved
 * for where it does work.
 */

/** The files the provenance paragraph names, and the licence and docs beside them. */
const DEPLOYMENTS = repositoryFile('packages/chain/deployments/testnet.json');
const EVIDENCE_JSON = repositoryFile('apps/web/src/generated/evidence.json');

export function SiteFooter() {
  return (
    <footer className="flex flex-col gap-10 border-t border-border-subtle pt-8">
      <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        <Column title="Product">
          <Internal href="/app/accounts">Interface</Internal>
          <Internal href="/app/policies/new">Install a boundary</Internal>
          <Internal href="/app/simulator">Simulator</Internal>
          <Internal href="/app/activity">Activity</Internal>
        </Column>

        <Column title="Evidence">
          <Internal href="#evidence">What the network refused</Internal>
          <Internal href="#how-it-works">The revoke sequence</Internal>
          <External href={DEPLOYMENTS}>deployments/testnet.json</External>
          <External href={EVIDENCE_JSON}>generated/evidence.json</External>
        </Column>

        <Column title="Resources">
          <Internal href="/docs">Docs</Internal>
          <External href={REPOSITORY}>Repository</External>
          <External href={repositoryFile('README.md')}>README</External>
          <External href={repositoryFile('LICENSE')}>MIT licence</External>
        </Column>

        <Column title="Contact">
          {/* The waitlist is the only channel this product has, and saying so is
              better than inventing an address that forwards nowhere. */}
          <div className="flex items-center">
            <WaitlistButton variant="secondary" />
          </div>
          <External href={REPOSITORY_ISSUES}>Open an issue</External>
        </Column>
      </div>

      {/* Unchanged, and deliberately still here. See the header. */}
      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        Every hash, address, cap and count on this page is read at build time from{' '}
        <span className="value">packages/chain/deployments/testnet.json</span> and{' '}
        <span className="value">src/generated/evidence.json</span>. The recording is dated{' '}
        {EVIDENCE.chain.recordedAt}. Policy is synthesized deterministically — the same transaction
        always produces the same proposal — and Claude explains a result and phrases the intent
        question, but never authors authorization logic.
      </p>
    </footer>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="col-head">{title}</h2>
      <ul className="flex flex-col items-start gap-2">
        {/* A list of one item per child, without every call site writing `<li>`
            around its own link. `Children.map` keys the results itself. */}
        {Children.map(children, (child) => (
          <li>{child}</li>
        ))}
      </ul>
    </div>
  );
}

const ITEM = 'text-[12.5px] text-muted-dim transition-colors hover:text-foreground';

function Internal({ href, children }: { href: string; children: React.ReactNode }) {
  // An in-page anchor is a plain `<a>` for the same reason the section nav's are:
  // it never leaves the page, so there is nothing for the router to do.
  if (href.startsWith('#')) {
    return (
      <a href={href} className={ITEM}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={ITEM}>
      {children}
    </Link>
  );
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={ITEM}>
      {children}
    </a>
  );
}
