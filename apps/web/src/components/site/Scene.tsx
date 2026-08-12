import type { ReactNode } from 'react';
import { Reveal } from '@/components/Reveal';

/**
 * One idea, one screen of scroll.
 *
 * The narrative's unit. It owns the shell, the vertical rhythm, the heading
 * treatment and the arrival — so a scene's own file contains its argument and
 * nothing about how a scene is put together. Six scenes choosing their own
 * spacing is the failure `.screen` was invented to prevent, one level up.
 *
 * ## Why the heading and the lead are props rather than children
 *
 * Because every scene has exactly one of each, and making them props is what
 * makes that true. A scene taking arbitrary children would let the fourth one
 * grow a second `h2` and nobody would notice until the document outline was
 * read by something that cares — a screen reader, or the docs sidebar
 * generator. The index and the heading are also the two things that must stay
 * in the same relationship on every scene, and a prop is a contract about that.
 *
 * ## The eyebrow index is not decoration
 *
 * It is the reader's position in a six-part argument, which is the one thing a
 * long scrolling page takes away from them. `user-select: none` in `.eyebrow`
 * means copying a scene never picks up its number.
 */
export function Scene({
  id,
  index,
  eyebrow,
  title,
  lead,
  children,
  /**
   * Where the scene's heading block travels from. The body decides its own.
   *
   * Defaults to arriving from below, which is the direction that agrees with
   * the scroll. A scene that comes from the side is making a point about being
   * a departure — scene 3 does, because it is the turn the whole page is built
   * around — and if every scene did it, none would.
   */
  from,
}: {
  id: string;
  /** Position in the argument, as printed. Two digits, so 01 sorts beside 06. */
  index: string;
  /** The scene's subject in two or three words. */
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  from?: 'up' | 'down' | 'left' | 'right';
}) {
  return (
    <section id={id} className="scene" aria-labelledby={`${id}-title`}>
      <Reveal as="header" from={from} className="flex flex-col gap-4 measure-scene">
        <p className="eyebrow-lead text-muted-dim">
          <span className="text-faint">{index}</span>
          <span aria-hidden="true" className="mx-2 text-faint">
            ·
          </span>
          {eyebrow}
        </p>
        <h2 id={`${id}-title`} className="scene-h2 text-foreground">
          {title}
        </h2>
        {lead === undefined ? null : <p className="scene-lead">{lead}</p>}
      </Reveal>
      {children}
    </section>
  );
}

/**
 * A scene's body, arriving after its heading.
 *
 * The stagger is the whole reason this exists as a component rather than as a
 * `<Reveal>` at each call site: a scene's parts should arrive in the order they
 * are read, and an index passed by hand at six call sites is six chances to
 * pass the same one twice. `index` here is the position within the scene, and
 * the heading above is implicitly zero.
 */
export function SceneBlock({
  children,
  index = 1,
  from,
  className,
}: {
  children: ReactNode;
  index?: number;
  from?: 'up' | 'down' | 'left' | 'right';
  className?: string;
}) {
  return (
    <Reveal index={index} from={from} className={className}>
      {children}
    </Reveal>
  );
}
