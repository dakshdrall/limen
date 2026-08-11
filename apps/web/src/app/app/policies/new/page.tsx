import { connection } from 'next/server';
import { NewPolicyScreen } from '@/components/app/NewPolicyScreen';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { DEFAULT_FIXTURE_KEY, FIXTURES, REFUSING_FIXTURES } from '@/fixtures';

export const metadata = {
  title: 'Limen — new policy',
  description:
    'Derive a permission boundary from an observed transaction and lower it onto audited OpenZeppelin primitives.',
};

/**
 * `?tx=` and `?account=` are how the account screen hands this one its work.
 *
 * Both are validated by shape here rather than trusted into the client. They
 * arrive from a URL, which anyone can type: `tx` is fed to `/api/ingest` and
 * `account` becomes the contract an install is written to, and neither should
 * reach a signing path as an arbitrary string. A malformed one is dropped and
 * the screen renders its default — the fixture picker — rather than erroring,
 * because a bad query parameter is not a broken screen.
 */
const LOOKS_LIKE_HASH = /^[0-9a-f]{64}$/;
const LOOKS_LIKE_CONTRACT = /^C[A-Z2-7]{55}$/;

function one(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.length === 0 ? null : first;
}

export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const initial = FIXTURES[DEFAULT_FIXTURE_KEY];
  if (initial === undefined) throw new Error(`missing fixture ${DEFAULT_FIXTURE_KEY}`);

  const params = await searchParams;
  const txParam = one(params.tx);
  const accountParam = one(params.account);
  const observeHash = txParam !== null && LOOKS_LIKE_HASH.test(txParam) ? txParam : null;
  const accountId =
    accountParam !== null && LOOKS_LIKE_CONTRACT.test(accountParam) ? accountParam : null;

  // Read at request time for the same reason the narrative does: whether live
  // ingest works is a property of the running deployment, not of the build.
  await connection();
  const liveIngestEnabled = (process.env.SOROBAN_RPC_URL ?? '').length > 0;

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="interface"
        title="New policy"
        lede="One transaction in, one installable boundary out — with the step between them shown rather than assumed. What Limen derives and what an OpenZeppelin smart account can hold are different languages, and the translation either succeeds or is refused with the constraint named."
        labels={['TESTNET ONLY', 'COMPOSITION ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']}
      />

      <NewPolicyScreen
        initialTransaction={initial}
        initialKey={DEFAULT_FIXTURE_KEY}
        fixtureKeys={Object.keys(FIXTURES)}
        refusingKeys={[...REFUSING_FIXTURES]}
        liveIngestEnabled={liveIngestEnabled}
        observeHash={observeHash}
        accountId={accountId}
      />
    </main>
  );
}
