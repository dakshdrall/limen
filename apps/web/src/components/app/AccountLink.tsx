import Link from 'next/link';
import { truncateAddress } from '@/lib/format';

/**
 * An account address as the heading of the block about it, linking to its
 * detail screen.
 *
 * Longer than the truncation a table cell gets — ten characters of head, six of
 * tail against `truncateAddress`'s six and four — because this is the title of
 * the thing rather than a value inside it, and a reader scanning a list of
 * accounts is distinguishing them from each other rather than reading one.
 *
 * That is a defensible difference. What was not defensible was where it lived:
 * the two screens that render this each spelled out `slice(0, 10)` and
 * `slice(-6)` themselves, so the decision existed twice and belonged to neither.
 * The next screen to show an account heading would have picked its own numbers,
 * and none of the three would have been wrong exactly — they would just have
 * disagreed.
 *
 * Not `Address`, which is a copy button: this navigates, and a control that both
 * copies and navigates does neither predictably. The full value is in the
 * `title` for the same reason `Address` carries it — a truncated value a
 * reviewer cannot recover is a value they cannot check.
 */
export function AccountLink({ contractId }: { contractId: string }) {
  return (
    <Link
      href={`/app/accounts/${contractId}`}
      title={contractId}
      className="link font-mono text-[13px] tracking-[-0.01em] text-foreground"
    >
      {truncateAddress(contractId, 10, 6)}
    </Link>
  );
}
