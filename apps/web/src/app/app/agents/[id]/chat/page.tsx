import { AgentChat } from '@/components/app/AgentChat';
import { ScreenHeader } from '@/components/app/ScreenHeader';

export const metadata = {
  title: 'Limen — chat',
  description:
    'Talk to a deployed agent. Every tool call it makes is bounded by the permission rule installed on its smart account.',
};

/**
 * The screen §51 calls the demo: permitted, refused, revoked, and the same call
 * failing differently afterwards.
 *
 * The id is not validated here beyond being present. Unlike an account address
 * — which has a shape a mistyped URL fails — an agent id is a UUID owned by one
 * user, and the only useful check is the scoped lookup the chat route already
 * does against the database. Doing it here as well would mean a second place
 * that decides whether an agent exists.
 */
export default async function AgentChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="agent"
        title="Chat"
        labels={['TESTNET ONLY', 'NOT AUDITED', 'LIMEN HOLDS THE AGENT KEY']}
      />

      <AgentChat agentId={id} />
    </main>
  );
}
