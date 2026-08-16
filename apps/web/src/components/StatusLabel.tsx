import { STATUS_LABELS, type StatusLabelName } from '@limen/shared/status-labels';

/**
 * A limit, rendered.
 *
 * The vocabulary itself is in `@limen/shared/status-labels` and this is a
 * consumer of it. Through V5 the constants lived in this file and `lib/local-key.ts`
 * imported one of them from here — the data layer reaching up into the
 * rendering layer, which became a type error the first time the rendering layer
 * was deleted. The set is content; this is markup; the dependency runs one way.
 *
 * `loud` is for the one label a person must read before they act — `NOT AUDITED`
 * above an install button. It is a brighter rule and brighter text within the
 * existing ramp, never a colour of its own: a warning that looks like a badge
 * gets read as a badge.
 *
 * The `title` carries the full sentence. It is a supplement and never the only
 * place a limit is stated — PLAN-V6 requires the limits be visible before the
 * argument, and a tooltip is not visible.
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

/** A row of labels, for a scene's spec strip and for screen headers. */
export function StatusLabels({
  names,
  weight = 'normal',
}: {
  names: readonly StatusLabelName[];
  weight?: 'normal' | 'loud';
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {names.map((name) => (
        <StatusLabel key={name} name={name} weight={weight} />
      ))}
    </span>
  );
}
