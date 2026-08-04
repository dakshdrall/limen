/**
 * Display helpers. Truncation is for reading; the full value is always
 * recoverable — every truncated address on the page carries its full form in a
 * `title` and is selectable. A grant reviewer must be able to inspect the real
 * addresses and the real amounts.
 */

export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/**
 * The same, for a 64-character transaction hash.
 *
 * Separate from `truncateAddress` because it is a different value with a
 * different length, not because it wants a different rule — a hash keeps more
 * of its head, since the leading characters are what an explorer search and a
 * `deployments/testnet.json` grep are matched on.
 *
 * There were four spellings of this: `0,8`+`-4`, `0,8`, `0,10`, and the
 * address truncation applied to a hash. All four rendered into `--col-hash`,
 * which is one token precisely so a hash is the same width on every screen —
 * and then each table decided for itself how much of the hash to put in it.
 * The tokens fixed the column and left the contents to drift.
 */
export function truncateHash(hash: string, lead = 8, tail = 4): string {
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/**
 * Renders an integer smallest-unit amount with a decimal point inserted, for
 * reading only. The integer string remains the source of truth everywhere else;
 * this value is never fed back into any computation.
 */
export function decimalise(amount: string, decimals = 7): string {
  if (!/^\d+$/.test(amount)) return amount;
  const padded = amount.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction.length > 0 ? `${grouped}.${fraction}` : grouped;
}

/** ~5 seconds per ledger on Stellar. */
export function ledgersToDuration(ledgers: number): string {
  const seconds = ledgers * 5;
  const days = seconds / 86_400;
  if (days >= 1) {
    const rounded = Math.round(days * 10) / 10;
    return `≈ ${rounded} day${rounded === 1 ? '' : 's'}`;
  }
  const hours = Math.round((seconds / 3_600) * 10) / 10;
  return `≈ ${hours} hour${hours === 1 ? '' : 's'}`;
}
