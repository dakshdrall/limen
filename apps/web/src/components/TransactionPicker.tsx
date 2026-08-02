'use client';

import { useState, type FormEvent } from 'react';

/**
 * The hash input is the difference between a demo and a product: without it a
 * reviewer can only watch Limen derive a policy from transactions we chose. So
 * it leads, and the shipped presets sit underneath it as a fallback rather than
 * as the main event.
 *
 * Validation here is deliberately the same shape as the route's, and equally
 * loose — it rejects input that is obviously not a hash and defers every real
 * judgement to the server.
 */
const HASH = /^[0-9a-f]{64}$/i;

export function TransactionPicker({
  fixtureKeys,
  refusingKeys,
  activeKey,
  loading,
  liveIngestEnabled,
  onSelectPreset,
  onObserveHash,
}: {
  fixtureKeys: string[];
  refusingKeys: string[];
  activeKey: string;
  loading: boolean;
  liveIngestEnabled: boolean;
  onSelectPreset: (key: string) => void;
  onObserveHash: (hash: string) => void;
}) {
  const [hash, setHash] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = hash.trim();
    if (!HASH.test(trimmed)) {
      setLocalError('A Soroban transaction hash is 64 hexadecimal characters.');
      return;
    }
    setLocalError(null);
    onObserveHash(trimmed.toLowerCase());
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <label htmlFor="tx-hash" className="col-head text-muted">
          Paste any Soroban testnet transaction hash
        </label>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            id="tx-hash"
            name="hash"
            value={hash}
            onChange={(event) => setHash(event.target.value)}
            disabled={!liveIngestEnabled || loading}
            spellCheck={false}
            autoComplete="off"
            placeholder="64 hexadecimal characters"
            aria-describedby="tx-hash-note"
            className="value min-w-0 flex-1 basis-[28rem] rounded-[4px] border border-border-default bg-surface px-3 py-2 text-foreground transition-colors placeholder:text-faint hover:border-border-bright focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!liveIngestEnabled || loading}
            className="cursor-pointer rounded-[4px] border border-accent bg-accent-dim px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Observe
          </button>
        </div>

        <p id="tx-hash-note" className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-dim">
          {liveIngestEnabled ? (
            <>
              Resolved live through Soroban RPC on testnet. The transaction must have succeeded and
              must contain at least one contract invocation.
            </>
          ) : (
            // Stated rather than silently falling back to a fixture: serving a
            // different transaction than the one asked for would be the worst
            // possible degradation.
            <>
              Live ingest is unavailable — this deployment has no Soroban RPC endpoint configured
              (<span className="value">SOROBAN_RPC_URL</span>). The shipped presets below still run
              the full pipeline.
            </>
          )}
        </p>

        {localError !== null && (
          <p role="alert" className="text-[12.5px] text-deny">
            {localError}
          </p>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="col-head mr-1 text-muted-dim">or a shipped preset</span>
        {fixtureKeys.map((key) => {
          const refusing = refusingKeys.includes(key);
          return (
            <button
              key={key}
              type="button"
              disabled={loading}
              onClick={() => onSelectPreset(key)}
              aria-pressed={key === activeKey}
              title={
                refusing
                  ? 'Derives more policies than a context rule holds — Limen refuses it'
                  : undefined
              }
              className={`value inline-flex cursor-pointer items-baseline gap-2 rounded-[4px] border px-2.5 py-1 transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${
                key === activeKey
                  ? 'border-accent bg-accent-dim text-foreground'
                  : 'border-border-default text-muted hover:bg-surface-hover'
              }`}
            >
              {key}
              {refusing && (
                <span className="col-head text-deny" aria-label="this preset is refused">
                  REFUSED
                </span>
              )}
            </button>
          );
        })}
        {loading && <span className="text-[12.5px] text-muted-dim">loading…</span>}
      </div>
    </div>
  );
}
