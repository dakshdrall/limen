'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Address } from '@/components/Address';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { PasskeyOwnerControl, type OwnerKind } from '@/components/app/PasskeyOwnerControl';
import { WriteResult } from '@/components/app/WriteResult';
import { Section } from '@/components/Section';
import { StatusLabel } from '@/components/StatusLabel';
import { LOCAL_KEY_LABEL, PASSKEY_LABEL } from '@limen/shared/status-labels';
import { usePasskeySigner } from '@/lib/use-passkey';
import { ACCOUNT_WASM_HASH, ED25519_VERIFIER, WASM_SOURCE } from '@/lib/chain-config';
import { deployAccount } from '@/lib/chain-actions';
import { fundFromFriendbot } from '@/lib/chain-write';
import { NOT_EXPORTABLE } from '@limen/shared/key-roles';
import { createLocalKeys } from '@/lib/local-key';
import { rememberAccount } from '@/lib/store';
import { useLocalKeyPublics, useSigners } from '@/lib/use-local-keys';
import { useWriteLog } from '@/lib/use-write';

/**
 * Creating a smart account, from a browser, with no wallet.
 *
 * This screen is the answer to "can a stranger use this?", and it is reachable
 * because of one fact about the contract: **the smart account signs nothing at
 * deploy.** `__constructor` runs as part of contract creation, so the only
 * signature the network requires is the fee source's on the envelope. There is
 * no chicken and egg — the account does not authorize its own existence — which
 * is why a key generated thirty seconds ago and funded by friendbot is enough.
 *
 * ## No wallet button, and why the screen says so
 *
 * PLAN-V4 gate G4, answered against the wallet path. A connected wallet could
 * only ever be a `Delegated` signer, whose nested authorization requirement is
 * raised from inside `__check_auth` and is undiscoverable from either simulation
 * — measured, not assumed. The fallback of connecting a wallet for identity
 * while this browser's key stays the real owner was declined too: someone who
 * connects a wallet has told you what they believe is about to happen, and a
 * caption correcting them is worse than never offering it.
 *
 * So there is one owner path, the screen states which key owns the account at
 * the moment it is created, and no custody label is claimed on this screen at
 * all — because the one that existed when this was written would not have been
 * true here. This key can move funds. That is what it is for.
 *
 * `NO CUSTODY` was retired in V8 M1. Its replacement `NO OWNER CUSTODY` would be
 * true here, and is still not rendered; the page header records why.
 *
 * ## Two keys, and the fence that makes it a mechanism
 *
 * The owner and the agent are generated together, because a demonstration where
 * both are the same key demonstrates nothing. `assertDistinctSigners` runs
 * before the deploy is built, so "we were careful" is not what is holding it up.
 */
export function NewAccountScreen() {
  const router = useRouter();
  const publics = useLocalKeyPublics();
  const signers = useSigners();
  const log = useWriteLog();

  const passkeySigner = usePasskeySigner();

  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [ownerKind, setOwnerKind] = useState<OwnerKind>('local');

  /**
   * The keys the deploy signs with, including the passkey when one owns.
   *
   * `keys.owner` is present on both paths and does the same two jobs either
   * way: it is the fee source and it signs the envelope. Only the *owner
   * signer* moves. See `chain-actions.ts`'s `ownerAuth`.
   */
  const keysForDeploy = () => {
    const base = signers();
    if (base === null) return null;
    if (ownerKind === 'local') return base;
    const passkey = passkeySigner();
    if (passkey === undefined) return null;
    return {
      ...base,
      passkey: {
        keyData: passkey.keyData,
        hexPublicKey: passkey.hexPublicKey,
        signer: passkey.signer,
      },
    };
  };

  const owner = publics?.OWNER;
  const agent = publics?.AGENT;
  const haveKeys = owner !== undefined && agent !== undefined;

  const generate = () => {
    const created = createLocalKeys();
    if (created === undefined) {
      // Private mode, or a full quota. A key that could not be stored is not a
      // key this browser has, and deploying an account owned by one that
      // vanishes on reload is the unrecoverable case reached silently.
      setKeyProblem(
        'This browser refused to store the keys — private mode, or a full storage quota. Without storage the owner key would vanish on reload and the account would be stranded, so nothing was created.',
      );
      return;
    }
    setKeyProblem(null);
  };

  const fund = async (role: 'OWNER' | 'AGENT', publicKey: string) => {
    const what = `Friendbot funding the ${role === 'OWNER' ? 'owner' : 'agent'}’s classic account`;

    // `track`, not `note`. Friendbot is still not a submission — nothing here
    // is built or signed by this application, and the outcome is assembled
    // below rather than converted from a submit result — but it is a call that
    // takes a second, and the control has to be shut for the length of it. It
    // was not: `note` recorded a finished outcome, so `busy` never went up, the
    // button stayed live through its own call, and a second click bought a
    // second friendbot request that answers "already exists" and is reported as
    // success. `e2e/funding-control.spec.ts` holds the request open and clicks
    // again.
    await log.track(`fund:${role}`, what, async () => {
      const result = await fundFromFriendbot(publicKey);
      return result.ok
        ? {
            status: 'onLedger',
            what,
            // Friendbot does not always hand back a hash, and an already-funded
            // account never does. Empty says "we did not learn one" — the row
            // renders without a link rather than with one that 404s.
            hash: result.hash ?? '',
            ok: true,
            codes: [],
            opResult: 'friendbot',
            ledgerStatus: 'SUCCESS',
          }
        : { status: 'failed', what, stage: 'submit', message: result.message, code: null };
    });
  };

  const deploy = async () => {
    const keys = keysForDeploy();
    if (keys === null) {
      setKeyProblem(
        ownerKind === 'passkey'
          ? 'The keys or the passkey are no longer available in this browser. Set them up again above.'
          : 'The keys are no longer in this browser. Generate them again.',
      );
      return;
    }

    let deployed: string | null = null;

    const outcome = await log.run(
      'deploy',
      'Creating the smart account — createCustomContract, with the owner signer as its only signer',
      () =>
        deployAccount({
          keys,
          onDeployed: (contract) => {
            deployed = contract;
          },
        }),
    );

    if (outcome?.status === 'onLedger' && outcome.ok && deployed !== null) {
      setContractId(deployed);
      rememberAccount(deployed, outcome.hash);
    }
  };

  return (
    <div className="flex flex-col gap-14">
      <Section
        index={1}
        title="Generate the two keys"
        subtitle="An owner key and an agent key, both created in this browser. The owner installs boundaries; the agent is what the boundary is installed against."
      >
        <div className="flex flex-col gap-5">
          {publics === undefined ? (
            <p className="text-[13px] text-muted-dim">Reading what this browser holds…</p>
          ) : haveKeys ? (
            <div className="panel">
              <div className="flex flex-col gap-4">
                <LocalKeyBadge role="OWNER" publicKey={owner} weight="loud" showDisposability />
                <LocalKeyBadge role="AGENT" publicKey={agent} />
              </div>
            </div>
          ) : (
            <div className="panel" data-tone="pending">
              <div className="flex items-center gap-3">
                <span className="eyebrow text-muted-dim">nothing generated yet</span>
                <StatusLabel name={LOCAL_KEY_LABEL} weight="loud" />
              </div>
              <p className="measure text-[13px] leading-relaxed text-foreground/90">
                Two disposable ed25519 keypairs, generated here and kept in this browser&rsquo;s
                storage. They are not a wallet and they never reach a Limen server.
              </p>
              <p className="measure text-[12.5px] leading-relaxed text-muted">{NOT_EXPORTABLE}</p>
              <button type="button" onClick={generate} className="btn" data-variant="primary">
                Generate keys
              </button>
            </div>
          )}

          {/* Offered beside the default, never in front of it. The two local
              keys above are created on both paths — a passkey replaces the
              owner *signer*, not the keys that pay fees and act as the agent. */}
          <PasskeyOwnerControl
            value={ownerKind}
            onChange={setOwnerKind}
            disabled={log.busy || contractId !== null}
          />

          {keyProblem !== null && (
            <p role="alert" className="text-[12.5px] leading-relaxed text-deny">
              {keyProblem}
            </p>
          )}
        </div>
      </Section>

      <Section
        index={2}
        title="Fund them from friendbot"
        subtitle="Both accounts pay their own fees. The agent holding its own funded account is what keeps any owner signature away from the agent's transactions later."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={!haveKeys || log.busy}
              onClick={() => void fund('OWNER', owner!)}
              className="btn"
              data-variant="secondary"
            >
              Fund the owner
            </button>
            <button
              type="button"
              disabled={!haveKeys || log.busy}
              onClick={() => void fund('AGENT', agent!)}
              className="btn"
              data-variant="secondary"
            >
              Fund the agent
            </button>
          </div>
          <WriteResult state={log.stateOf('fund:OWNER')} />
          <WriteResult state={log.stateOf('fund:AGENT')} />
          <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
            Friendbot is called from this page, not through a Limen route. No Limen server is in
            this write path at all, which also means no Limen rate limit applies to it — friendbot
            and the public RPC apply their own.
          </p>
        </div>
      </Section>

      <Section
        index={3}
        title="Deploy the smart account"
        subtitle="createCustomContract, with the account wasm already uploaded to testnet and the owner key as its only signer."
        emphasis
      >
        <div className="flex flex-col gap-5">
          <div className="panel">
            <div className="flex flex-wrap items-center gap-3">
              <StatusLabel name="NOT AUDITED" weight="loud" />
              <StatusLabel name="COMPOSITION ONLY" />
            </div>
            <p className="measure text-[13px] leading-relaxed text-foreground/90">
              The account contract is OpenZeppelin&rsquo;s multisig smart account example, built
              from <span className="value">{WASM_SOURCE.tag}</span>{' '}
              and already on testnet. Limen writes no Rust and generates none. What is not audited
              is the code that decides what to install.
            </p>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
              {/* `min-w-0`: the `scroll-x` on the value below cannot do
                  anything while its flex parent is sized to the content. A
                  64-character hash has no break opportunity, so the item's
                  `min-width: auto` resolved to 440px and pushed the document
                  sideways at 390px — the box scrolls only once it is allowed to
                  be narrower than what is in it. */}
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="col-head text-muted-dim">account wasm hash</dt>
                <dd className="value scroll-x text-[12px] text-foreground">{ACCOUNT_WASM_HASH}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="col-head text-muted-dim">ed25519 verifier</dt>
                <dd className="text-[12px]">
                  <Address value={ED25519_VERIFIER} tone="dim" />
                </dd>
              </div>
            </dl>

            {haveKeys && (
              // `border-border-subtle`. See `AccountWriteSteps`: this divider
              // asked for `border-border-faint`, which is not a token this
              // palette has ever defined, so it emitted nothing and the rule was
              // never drawn.
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
                <p className="text-[12.5px] leading-relaxed text-muted">
                  This account will be owned by the signer below, and by no other. It is fixed at
                  creation.
                </p>
                {ownerKind === 'passkey' ? (
                  // The owner is the passkey; the OWNER key below it is still
                  // here and still pays the fee. Showing both is the honest
                  // rendering — showing only the passkey would imply this
                  // account needs no local key, which is not true of any
                  // account on testnet.
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                        owner
                      </span>
                      <StatusLabel name={PASSKEY_LABEL} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="col-head text-muted-dim">pays the fee for this deploy</span>
                      <LocalKeyBadge role="OWNER" publicKey={owner} />
                    </div>
                  </div>
                ) : (
                  <LocalKeyBadge role="OWNER" publicKey={owner} />
                )}
              </div>
            )}

            <button
              type="button"
              disabled={!haveKeys || log.busy || contractId !== null}
              onClick={() => void deploy()}
              className="btn"
              data-variant="primary"
            >
              {contractId === null ? 'Deploy the account' : 'Deployed'}
            </button>
          </div>

          <WriteResult state={log.stateOf('deploy')} />

          {contractId !== null && (
            <div className="panel" data-tone="permitted">
              <span className="eyebrow text-permit">the account exists</span>
              <dl className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <dt className="col-head text-muted-dim">smart account</dt>
                  <dd className="text-[13px]">
                    <Address value={contractId} />
                  </dd>
                </div>
              </dl>
              <p className="measure text-[12.5px] leading-relaxed text-muted">
                Read out of the creation transaction&rsquo;s return value rather than derived from
                the deployer and salt — this application asks the network what it did instead of
                agreeing with itself about it.
              </p>
              <button
                type="button"
                onClick={() => router.push(`/app/accounts/${contractId}`)}
                className="btn"
                data-variant="primary"
              >
                Open the account
              </button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
