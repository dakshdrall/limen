/**
 * Where this repository is, and how to point at a file in it.
 *
 * One definition, for the same reason the palette and the mark have one: the
 * footer alone links five paths into this repository, and five hand-written
 * `https://github.com/…/blob/main/…` strings are five chances to ship a 404 that
 * nobody clicks in review. A wrong link in a footer that says *here is the file
 * every number on this page was read from* is worse than no link, because the
 * whole claim of that footer is that the evidence can be checked.
 *
 * `blob/main` rather than a commit sha on purpose. These links are an invitation
 * to read the current file, not a citation of the version that happened to be
 * checked out when the page was built — and a sha would need re-pinning on every
 * commit to stay the thing it claims to be.
 */

export const REPOSITORY = 'https://github.com/dakshdrall/limen';

export const REPOSITORY_ISSUES = `${REPOSITORY}/issues`;

/** A path from the repository root, as a link to the file on the default branch. */
export function repositoryFile(path: string): string {
  return `${REPOSITORY}/blob/main/${path}`;
}
