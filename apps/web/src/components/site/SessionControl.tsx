'use client';

import { useEffect, useState } from 'react';
import { StatusLabel } from '@/components/StatusLabel';
import { truncateAddress, truncateCredentialId } from '@/lib/format';
import { PASSKEY_LABEL, WALLET_DISCLOSURE } from '@limen/shared/status-labels';
import { isRouteRefusal, registerIdentity, signIn, signInWithWallet, signOut } from '@/lib/identity';
import { useIdentity } from '@/lib/use-identity';

/**
 * Which state you are in, and the three controls that change it.
 *
 * The auth routes shipped with nothing calling them. This is what calls them,
 * and it is deliberately the smallest surface that makes the ceremony usable
 * rather than an account area: register, sign in, sign out, and a reading of
 * which of those you are currently on the other side of.
 *
 * ## Why the header, and why nothing else
 *
 * Session state belongs beside the network indicator for the same reason the
 * network indicator is there at all: it is a fact about *this browser right
 * now* that every screen depends on and no screen owns. A `/account` page would
 * answer the question only where somebody navigated to ask it, and the question
 * — am I signed in — is one you have without having asked.
 *
 * ## What is deliberately absent
 *
 * **A display name.** There is no field for one, so any name sent from here
 * would be invented — the same generic string for every user, which is
 * decoration pretending to be identity. The credential id is what this browser
 * actually knows, it is public by construction, and showing it is the same
 * choice every other value on this site is rendered under: the real thing,
 * truncated, with the whole of it in reach. `cleanDisplayName` stays on the
 * server for a caller that has a real one.
 *
 * **Any chrome at all when the deployment has no database.** `unavailable` is a
 * distinct identity state and it renders exactly nothing, so a build with no
 * `DATABASE_URL` looks precisely as it did before this component existed. That
 * is what keeps the README's *no credentials are required* true, and it is the
 * same rule as `LedgerCounter` rendering nothing rather than a zero: a control
 * that cannot work must not be offered.
 *
 * ## The one sentence this component owes a reader
 *
 * A registration creates a credential, so {@link PASSKEY_LABEL} is rendered at
 * the moment it happens rather than named in a constant somewhere. It is not
 * rendered in the bar itself: the bar already carries the network label, and a
 * second pill beside it competes with the one fact the header must never get
 * wrong. `PASSKEY_KEEPS_ACCOUNT` and `PASSKEY_STILL_LOCAL` are not used here on
 * purpose — the second reads *"both local keys below"*, which is written for
 * the screen that creates them and would be a false reference in a header.
 */

/** A success notice is transient; a refusal waits to be read. */
const SUCCESS_MS = 8_000;

type Busy = 'register' | 'sign-in' | 'sign-out' | 'wallet' | null;

interface Notice {
  tone: 'permitted' | 'refused';
  text: string;
  /** Only a fresh credential earns the label. */
  registered?: boolean;
  /**
   * A wallet sign-in says what the wallet did *not* do, in the same panel.
   *
   * Separate from `registered` because the two notices make opposite points —
   * one announces a key this browser now holds, the other announces that no key
   * changed hands at all.
   */
  wallet?: boolean;
}

export function SessionControl() {
  const identity = useIdentity();
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (notice === null || notice.tone !== 'permitted') return;
    const timer = setTimeout(() => setNotice(null), SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * One error path for all three, because they fail the same three ways and a
   * per-control message is how two of them end up disagreeing about what a
   * dismissed prompt means.
   *
   * A dismissed prompt is the ordinary case and is not a fault. `NotAllowedError`
   * is what the browser throws for it — and for a timeout, which is the same
   * thing from a person's side: they did not complete it.
   */
  const run = async (kind: Exclude<Busy, null>, action: () => Promise<Notice>) => {
    setBusy(kind);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setNotice({ tone: 'refused', text: 'The prompt was dismissed or timed out. Nothing changed.' });
      } else if (isRouteRefusal(error)) {
        setNotice({ tone: 'refused', text: error.message });
      } else {
        setNotice({
          tone: 'refused',
          text: error instanceof Error ? error.message : 'That did not go through. Try again.',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  // `unknown` is the server render and the first client frame; `unavailable` is
  // a deployment with no database. Both render nothing, and the markup agrees
  // with the server in both — see `use-identity.ts` on React #418.
  if (identity.status === 'unknown' || identity.status === 'unavailable') return null;

  const label = 'Limen testnet account';

  return (
    <>
      {identity.status === 'signed-out' ? (
        <div className="flex shrink-0 items-center gap-0.5">
          {/*
            The wallet is the route a user meets, and the label carries the
            whole disclosure rather than deferring it to a caption underneath.
            F4 declined this arrangement when the correction arrived *after* the
            promise; `title` is the tooltip on the promise itself, and the
            notice panel repeats it once the ceremony is done.
          */}
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-register="label"
            data-wallet="sign-in"
            disabled={busy !== null}
            title={WALLET_DISCLOSURE}
            onClick={() =>
              void run('wallet', async () => {
                await signInWithWallet();
                return { tone: 'permitted', text: 'Signed in with your wallet.', wallet: true };
              })
            }
          >
            {busy === 'wallet' ? 'Waiting…' : 'Connect wallet'}
          </button>
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-register="label"
            disabled={busy !== null}
            onClick={() =>
              void run('sign-in', async () => {
                await signIn();
                return { tone: 'permitted', text: 'Signed in.' };
              })
            }
          >
            {busy === 'sign-in' ? 'Waiting…' : 'Passkey'}
          </button>
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-register="label"
            disabled={busy !== null}
            onClick={() =>
              void run('register', async () => {
                await registerIdentity(label);
                return { tone: 'permitted', text: 'Registered, and signed in.', registered: true };
              })
            }
          >
            {busy === 'register' ? 'Waiting…' : 'Register'}
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="hidden font-mono text-[10.5px] tracking-[0.08em] text-muted-dim md:inline"
            title={
              identity.user.authMethod === 'wallet'
                ? `Signed in with the wallet ${identity.user.stellarAddress}\n${WALLET_DISCLOSURE}`
                : `Signed in with the passkey ${identity.user.credentialId}\n${PASSKEY_LABEL}`
            }
          >
            <span className="sr-only">Signed in as </span>
            {identity.user.authMethod === 'wallet'
              ? truncateAddress(identity.user.stellarAddress)
              : (identity.user.displayName ?? truncateCredentialId(identity.user.credentialId))}
          </span>
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-register="label"
            data-tone="destructive"
            disabled={busy !== null}
            onClick={() =>
              void run('sign-out', async () => {
                await signOut();
                return { tone: 'permitted', text: 'Signed out. The session was deleted, not just forgotten.' };
              })
            }
          >
            {busy === 'sign-out' ? 'Ending…' : 'Sign out'}
          </button>
        </div>
      )}

      {notice !== null && (
        <div className="absolute right-[var(--screen-pad)] top-full z-30 mt-1 max-w-[min(26rem,calc(100vw-2rem))]">
          <div className="panel" data-tone={notice.tone}>
            {notice.registered === true && (
              <div className="flex flex-wrap items-center gap-2">
                <StatusLabel name={PASSKEY_LABEL} />
              </div>
            )}
            <p role="status" className="text-[13px] leading-relaxed text-foreground">
              {notice.text}
            </p>
            {notice.registered === true && (
              <p className="text-[12.5px] leading-relaxed text-muted">
                The private half is held by your device and never reaches Limen. This browser now signs
                with this passkey.
              </p>
            )}
            {notice.wallet === true && (
              <p className="text-[12.5px] leading-relaxed text-muted">{WALLET_DISCLOSURE}</p>
            )}
            <button
              type="button"
              className="btn"
              data-variant="quiet"
              data-register="label"
              onClick={() => setNotice(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
