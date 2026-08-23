'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TurnResult } from '@/components/app/TurnResult';

/**
 * The conversation, and the polling that stands in for streaming.
 *
 * A turn is accepted and then worked on: `POST /api/agents/:id/chat` comes back
 * with a turn id, and this asks `GET /api/turns/:id` until the row says `done`.
 * §7.5.4 chose that shape over holding a connection open, and the reason shows
 * up here as a feature — a reload during a payment loses the tab, not the turn.
 * The row is still there, and a future version of this screen can find it.
 *
 * ## The model's words and the tool's result are different things on screen
 *
 * An assistant bubble is something the model said. A `TurnResult` is what a tool
 * did, rendered from its own outcome union. They are never merged, because the
 * model is never told what the tool returned (`chat.ts` says why at length) and
 * a bubble that appeared to narrate a result would be narrating nothing.
 */

type Entry =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string }
  /** §4.4 row one. Kept distinct from `assistant` so it cannot read as an answer. */
  | { id: string; role: 'agent_error'; text: string }
  | { id: string; role: 'turn'; turnId: string; tool: string; status: string; result: unknown };

/** Roughly once a second; a turn is 15–45 seconds and this is not a race. */
const POLL_MS = 1_000;

/**
 * A ceiling on polling, so a worker that died holding a turn does not leave a
 * tab asking forever. The turn itself is resolved by the runtime — `turn.ts`
 * closes out a turn whose worker vanished — this only stops the asking.
 */
const POLL_LIMIT = 120;

let counter = 0;
const nextId = () => `e${++counter}`;

export function AgentChat({ agentId }: { agentId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries]);

  const patchTurn = useCallback((turnId: string, patch: Partial<Extract<Entry, { role: 'turn' }>>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.role === 'turn' && entry.turnId === turnId ? { ...entry, ...patch } : entry,
      ),
    );
  }, []);

  const poll = useCallback(
    async (turnId: string) => {
      for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));

        let response: Response;
        try {
          response = await fetch(`/api/turns/${turnId}`, { cache: 'no-store' });
        } catch {
          continue; // A dropped poll is not a failed turn. Ask again.
        }

        if (!response.ok) {
          patchTurn(turnId, {
            status: 'done',
            result: {
              outcome: 'infra_error',
              summary: 'The result of this turn could not be read.',
              stage: `polling (HTTP ${response.status})`,
            },
          });
          return;
        }

        const view = (await response.json()) as { status: string; result: unknown };
        if (view.status === 'done') {
          patchTurn(turnId, { status: 'done', result: view.result });
          return;
        }
        patchTurn(turnId, { status: view.status });
      }

      patchTurn(turnId, {
        status: 'done',
        result: {
          outcome: 'infra_error',
          summary: 'This turn is taking longer than this screen waits.',
          stage: 'polling timed out',
        },
      });
    },
    [patchTurn],
  );

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (message.length === 0 || busy) return;

    setBusy(true);
    setDraft('');

    // The history the server gets is only what the model may see: the words in
    // the conversation. Tool results are excluded by construction here, which
    // is the same §4.4 property `chat.ts` asserts on its own request.
    const history = entries
      .filter((entry): entry is Extract<Entry, { role: 'user' | 'assistant' }> =>
        entry.role === 'user' || entry.role === 'assistant',
      )
      .map((entry) => ({ role: entry.role, text: entry.text }));

    setEntries((current) => [...current, { id: nextId(), role: 'user', text: message }]);

    try {
      const response = await fetch(`/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });

      const body = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        setEntries((current) => [
          ...current,
          {
            id: nextId(),
            role: 'agent_error',
            text:
              typeof body.message === 'string'
                ? body.message
                : `The message was not accepted (${String(body.error ?? response.status)}).`,
          },
        ]);
        return;
      }

      if (body.kind === 'text') {
        setEntries((current) => [
          ...current,
          { id: nextId(), role: 'assistant', text: String(body.text) },
        ]);
        return;
      }

      if (body.kind === 'agent_error') {
        setEntries((current) => [
          ...current,
          { id: nextId(), role: 'agent_error', text: String(body.detail) },
        ]);
        return;
      }

      const turnId = String(body.turnId);
      setEntries((current) => [
        ...current,
        { id: nextId(), role: 'turn', turnId, tool: String(body.tool), status: 'queued', result: null },
      ]);
      await poll(turnId);
    } catch (error) {
      setEntries((current) => [
        ...current,
        {
          id: nextId(),
          role: 'agent_error',
          text: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3" role="log" aria-live="polite" aria-label="Conversation">
        {entries.length === 0 && (
          <p className="measure text-[13px] leading-relaxed text-muted">
            Ask for a balance, or for a payment. What the agent may actually do is fixed by the
            boundary installed on its account — this screen shows you which of the two refused when
            one does.
          </p>
        )}

        {entries.map((entry) =>
          entry.role === 'turn' ? (
            <div key={entry.id} className="flex flex-col gap-1.5">
              <span className="eyebrow text-muted">
                {entry.tool}
                {entry.status !== 'done' && ` — ${entry.status}…`}
              </span>
              {entry.status === 'done' ? (
                <TurnResult result={entry.result} />
              ) : (
                <div className="panel">
                  <p className="text-[12.5px] leading-relaxed text-muted">
                    Working. This is a real transaction on testnet, so it takes as long as it takes.
                  </p>
                </div>
              )}
            </div>
          ) : entry.role === 'agent_error' ? (
            // No verdict badge: nothing decided anything. See TurnResult's header.
            <div key={entry.id} className="panel" data-tone="refused" role="alert">
              <span className="eyebrow text-muted">the agent could not act</span>
              <p className="measure text-[13px] leading-relaxed text-foreground/90">{entry.text}</p>
            </div>
          ) : (
            <div
              key={entry.id}
              className={
                entry.role === 'user'
                  ? 'self-end rounded-lg bg-surface px-3 py-2 text-[13px] leading-relaxed text-foreground/90'
                  : 'measure text-[13px] leading-relaxed text-foreground/90'
              }
            >
              {entry.text}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="flex gap-2">
        <label htmlFor="chat-message" className="sr-only">
          Message
        </label>
        <input
          id="chat-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
          maxLength={2_000}
          autoComplete="off"
          placeholder="what's my balance?"
          className="flex-1 rounded-lg border border-border-default bg-surface px-3 py-2 text-[13px] text-foreground/90"
        />
        <button type="submit" disabled={busy || draft.trim().length === 0} className="button">
          {busy ? 'Working…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
