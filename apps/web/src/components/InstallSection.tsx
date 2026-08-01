'use client';

import { useEffect, useState } from 'react';
import type { PolicyProposal } from '@limen/core';

/**
 * Install: build the payload, hand it to the wallet kit for client-side
 * signing, submit.
 *
 * No secret key reaches the server, an env var, or browser storage. Signing
 * happens entirely inside @creit.tech/stellar-wallets-kit, which is imported
 * dynamically so it only loads when a smart account is actually configured.
 *
 * Without NEXT_PUBLIC_SMART_ACCOUNT_ID this renders the exact payload that
 * would be submitted and disables the button, rather than pretending to
 * install. See the README's "not done yet" section.
 */
export function InstallSection({ proposal }: { proposal: PolicyProposal }) {
  const [xdr, setXdr] = useState<string | null>(null);
  const [smartAccountId, setSmartAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setError(null);
      try {
        const response = await fetch('/api/install-preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ proposal }),
        });
        const payload = (await response.json()) as {
          xdr?: string;
          smartAccountId?: string | null;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || payload.xdr === undefined) {
          setError(payload.error ?? 'could not build the install payload');
          return;
        }
        setXdr(payload.xdr);
        setSmartAccountId(payload.smartAccountId ?? null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [proposal]);

  const installable = smartAccountId !== null && smartAccountId.length > 0;

  async function onInstall() {
    setStatus('Connecting wallet…');
    setError(null);
    try {
      // Dynamically imported so the wallet kit only loads when a smart account
      // is actually configured — and so nothing wallet-related is in the
      // server bundle.
      const [{ StellarWalletsKit }, { Networks }, { FreighterModule }, { xBullModule }] =
        await Promise.all([
          import('@creit.tech/stellar-wallets-kit'),
          import('@creit.tech/stellar-wallets-kit/types'),
          import('@creit.tech/stellar-wallets-kit/modules/freighter'),
          import('@creit.tech/stellar-wallets-kit/modules/xbull'),
        ]);

      StellarWalletsKit.init({
        network: Networks.TESTNET,
        modules: [new FreighterModule(), new xBullModule()],
      });

      const { address } = await StellarWalletsKit.authModal();

      // TODO(roadmap): with a deployed OpenZeppelin smart account, the
      // invocation is assembled here — entrypoint, sequence number, fee, and
      // auth entries all come from that account's interface — then signed with
      // `StellarWalletsKit.signTransaction` and submitted to testnet. The
      // signing step never exposes a key to this application.
      setStatus(
        `Connected as ${address}. Transaction assembly needs a deployed smart account contract; the payload above is what it would carry.`,
      );
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!installable && (
        <div className="rounded-sm border border-border-bright bg-surface-raised px-3 py-2">
          <p className="text-foreground">
            <strong>Preview only.</strong> No OpenZeppelin smart account is configured, so there is
            nothing to install onto.
          </p>
          <p className="text-muted-dim">
            Set <code className="text-muted">NEXT_PUBLIC_SMART_ACCOUNT_ID</code> to a deployed
            testnet account contract to enable signing. The payload below is real and is exactly
            what would be submitted.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-muted uppercase tracking-wide">
          Install payload <span className="text-muted-dim">(Soroban ScVal, base64 XDR)</span>
        </h3>
        {error !== null ? (
          <p className="text-deny">{error}</p>
        ) : xdr === null ? (
          <p className="text-muted">Serializing…</p>
        ) : (
          <pre className="scroll-x rounded-sm border border-border-subtle bg-surface p-3 text-muted-dim">
            <code className="break-all whitespace-pre-wrap">{xdr}</code>
          </pre>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!installable || xdr === null}
          onClick={() => void onInstall()}
          className="cursor-pointer rounded-sm border border-accent bg-accent/10 px-3 py-1.5 text-foreground disabled:cursor-not-allowed disabled:border-border-bright disabled:bg-transparent disabled:text-muted-dim"
        >
          Sign &amp; install on testnet
        </button>
        {!installable && (
          <span className="text-muted-dim">
            disabled — no smart account contract to install onto
          </span>
        )}
        {status !== null && <span className="text-muted">{status}</span>}
      </div>

      <p className="text-muted-dim">
        Limen custodies nothing. Signing is client-side only, via
        stellar-wallets-kit; no secret key reaches the server, an environment variable, or browser
        storage. There is no code path in this repository that can move funds.
      </p>
    </div>
  );
}
