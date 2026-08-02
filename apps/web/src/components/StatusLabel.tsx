/**
 * Maturity, stated plainly, in the same words everywhere.
 *
 * The set is closed on purpose. A screen cannot invent a label, and a label
 * cannot drift in wording between two screens — which is the failure mode that
 * turns a precise statement of limits into vague reassurance. Adding one means
 * adding it here, where every existing use is visible.
 *
 * These are not decoration. A project that states its own limits precisely
 * reads as more trustworthy than one that stays quiet, and for a permissions
 * tool that is the entire impression that matters.
 */

export const STATUS_LABELS = {
  'OPEN SOURCE': 'The source for everything on this page is public.',
  MIT: 'Licensed MIT.',
  'TESTNET ONLY': 'Stellar testnet. No real funds are involved anywhere in this application.',
  'IN DEVELOPMENT': 'Actively changing. Interfaces and data may not survive the next deploy.',
  'NOT AUDITED': 'No third party has reviewed this code. The OpenZeppelin contracts it installs are audited; the code that decides what to install is not.',
  'COMPOSITION ONLY': 'Every installed policy is a configuration of an existing audited OpenZeppelin primitive. No Rust is generated, and none is written by hand.',
  'NO CUSTODY': 'No key of yours reaches a Limen server. There is no code path here that can move your funds.',
} as const;

export type StatusLabelName = keyof typeof STATUS_LABELS;

/**
 * `loud` is for the one label a person must read before they act — `NOT
 * AUDITED` above an install button. It is a brighter rule and brighter text
 * within the existing ramp, never a colour of its own: a warning that looks
 * like a badge gets read as a badge.
 */
export function StatusLabel({
  name,
  weight = 'normal',
}: {
  name: StatusLabelName;
  weight?: 'normal' | 'loud';
}) {
  return (
    <span className="status-label" data-weight={weight} title={STATUS_LABELS[name]}>
      {name}
    </span>
  );
}

/** A row of labels, for the landing spec strip and screen headers. */
export function StatusLabels({ names }: { names: readonly StatusLabelName[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {names.map((name) => (
        <StatusLabel key={name} name={name} />
      ))}
    </span>
  );
}
