import { StatusLabel } from '@/components/StatusLabel';
import { Address } from '@/components/Address';
import { LOCAL_KEY_LABEL } from '@/components/StatusLabel';
import { NOT_EXPORTABLE, type KeyRole } from '@/lib/key-roles';

/**
 * Which key is about to act, and what that key is.
 *
 * This is where `TESTNET ONLY · LOCAL KEY` reaches a screen. Everywhere else it
 * is a constant; here it is a thing a person reads, which is the only form of
 * it that does any work. `test/local-key-label.test.ts` requires that at least
 * one file render it and that every file touching the key name it — this is the
 * first half.
 *
 * It renders beside every signature rather than once at the top of a flow. The
 * claim the whole product makes is that the agent's key cannot exceed a
 * boundary the owner's key installed; a person who cannot see which of the two
 * is signing at the moment it signs has been asked to take that on trust.
 *
 * `loud` is reserved for the moment of creation, where the disposability
 * sentence is the thing that has to be read before acting. In a confirmation
 * beside a button the label is context, not a warning, and a warning that
 * appears everywhere is one nobody reads anywhere.
 */
export function LocalKeyBadge({
  role,
  publicKey,
  weight = 'normal',
  showDisposability = false,
}: {
  role: KeyRole;
  publicKey: string;
  weight?: 'normal' | 'loud';
  /** Say what clearing site data costs. True wherever a key is created. */
  showDisposability?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{role}</span>
        <Address value={publicKey} />
        <StatusLabel name={LOCAL_KEY_LABEL} weight={weight} />
      </div>
      {showDisposability ? (
        <p className="text-[12.5px] leading-relaxed text-muted-dim">{NOT_EXPORTABLE}</p>
      ) : null}
    </div>
  );
}
