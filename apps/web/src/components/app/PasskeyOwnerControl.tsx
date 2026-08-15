'use client';

import { useState } from 'react';
import { StatusLabel } from '@/components/StatusLabel';
import { PASSKEY_LABEL } from '@/lib/status-labels';
import { PASSKEY_KEEPS_ACCOUNT, PASSKEY_STILL_LOCAL } from '@/lib/key-roles';
import { createPasskey } from '@/lib/passkey';
import { usePasskeyPublic, usePasskeysAvailable } from '@/lib/use-passkey';

/** Which signer owns the account being created. */
export type OwnerKind = 'local' | 'passkey';

/**
 * Choosing what owns the account, with the browser key as the default.
 *
 * PLAN-V7 §5.4, and the ordering is the requirement rather than a layout
 * preference: **the browser-key path stays the zero-friction default.** A
 * reviewer with no passkey, or on a browser without WebAuthn, must never hit a
 * wall — so the passkey is offered *beside* the default, never in front of it,
 * and choosing nothing is choosing the path that works everywhere.
 *
 * ## Why this component says as much as it does
 *
 * Because the gain is narrower than "passkey" suggests, and the narrow part is
 * the part a person would otherwise get wrong. A passkey cannot pay a Stellar
 * fee and cannot be handed to an agent, so a passkey-owned account still has two
 * local ed25519 keys in this browser doing exactly those jobs — and clearing
 * site data still destroys both. What it fixes is that the *account* is no
 * longer lost with them.
 *
 * `PASSKEY_KEEPS_ACCOUNT` and `PASSKEY_STILL_LOCAL` are constants in
 * `key-roles.ts` rather than prose written here, so this screen and the guided
 * flow state the limit in the same words instead of two paraphrases drifting
 * apart. Both sentences render together, always. The first without the second
 * is the reassurance this project exists not to give.
 */
export function PasskeyOwnerControl({
  value,
  onChange,
  disabled = false,
}: {
  value: OwnerKind;
  onChange: (kind: OwnerKind) => void;
  disabled?: boolean;
}) {
  const passkeyPublic = usePasskeyPublic();
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // `undefined` until the browser has been asked, which is the only answer the
  // server can give honestly. Calling `passkeysAvailable()` during render
  // instead put a React #418 on this screen: the server sent the fallback
  // sentence and a disabled control, the client sent neither.
  //
  // Unknown is treated as available, so the control is offered rather than
  // withheld for the frame before the answer arrives — and if the answer turns
  // out to be no, the sentence appears and the control shuts. The reverse
  // default would flash "this browser does not offer passkeys" at every browser
  // that does.
  const available = usePasskeysAvailable();
  const offerPasskey = available !== false;

  const create = async () => {
    setProblem(null);
    setCreating(true);
    try {
      await createPasskey('Limen testnet account');
    } catch (error) {
      // A cancelled prompt is the ordinary case, not a fault. It reads as one.
      setProblem(
        error instanceof Error
          ? error.message
          : 'The passkey was not created. Nothing was changed.',
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="col-head text-muted-dim">what owns the account</span>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => onChange('local')}
            disabled={disabled}
            aria-pressed={value === 'local'}
            className="btn"
            data-variant={value === 'local' ? 'primary' : 'quiet'}
          >
            This browser’s key
          </button>
          <button
            type="button"
            onClick={() => onChange('passkey')}
            disabled={disabled || !offerPasskey}
            aria-pressed={value === 'passkey'}
            className="btn"
            data-variant={value === 'passkey' ? 'primary' : 'quiet'}
          >
            A passkey
          </button>
        </div>
        {available === false && (
          <p className="text-[12.5px] leading-relaxed text-muted-dim">
            This browser does not offer passkeys, so the browser key is the only owner path here.
            Nothing below is affected — it is the default either way.
          </p>
        )}
      </div>

      {value === 'passkey' && (
        <div className="panel" data-tone="pending">
          <div className="flex flex-wrap items-center gap-3">
            <StatusLabel name={PASSKEY_LABEL} weight="loud" />
          </div>

          {/* Both sentences, together, always. See the component doc. */}
          <p className="measure text-[13px] leading-relaxed text-foreground/90">
            {PASSKEY_KEEPS_ACCOUNT}
          </p>
          <p className="measure text-[12.5px] leading-relaxed text-muted">{PASSKEY_STILL_LOCAL}</p>

          {passkeyPublic === undefined ? (
            <p className="text-[13px] text-muted-dim">Reading what this browser holds…</p>
          ) : passkeyPublic === null ? (
            <button
              type="button"
              onClick={() => void create()}
              disabled={disabled || creating}
              className="btn"
              data-variant="primary"
            >
              {creating ? 'Waiting for your device…' : 'Create a passkey'}
            </button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="col-head text-muted-dim">owner signer</span>
              <span className="value scroll-x text-[12px] text-foreground">{passkeyPublic}</span>
              <p className="text-[12px] leading-relaxed text-muted-dim">
                The 65-byte secp256r1 key your authenticator created. Limen never sees the private
                half, and there is no code path here that could ask for it.
              </p>
            </div>
          )}

          {problem !== null && (
            <p role="alert" className="text-[12.5px] leading-relaxed text-deny">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
