'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Address } from '@/components/Address';
import { LocalKeyBadge } from '@/components/app/LocalKeyBadge';
import { WriteResult } from '@/components/app/WriteResult';
import { Section } from '@/components/Section';
import { StatusLabel, LOCAL_KEY_LABEL } from '@/components/StatusLabel';
import {
  ACCOUNT_WASM_HASH,
  ED25519_VERIFIER,
  RPC_URL,
  WASM_SOURCE,
} from '@/lib/chain-config';
import { fundFromFriendbot, loadChain } from '@/lib/chain-write';
import { NOT_EXPORTABLE } from '@/lib/key-roles';
import { createLocalKeys } from '@/lib/local-key';
import { NETWORK_PASSPHRASE } from '@/lib/network';
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
 * raised from inside `__check_auth` and is undiscoverable from either
 * simulation — measured, not assumed. The fallback of connecting a wallet for
 * identity while this browser's key stays the real owner was declined too:
 * someone who connects a wallet has told you what they believe is about to
 * happen, and a caption correcting them is worse than never offering it.
 *
 * So there is one owner path, the screen states which key owns the account at
 * the moment it is created, and `NO CUSTODY` is not claimed on this screen at
 * all — because it would not be true here. This key can move funds. That is
 * what it is for.
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

  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);

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
    const result = await fundFromFriendbot(publicKey);

    log.note(
      `fund:${role}`,
      result.ok
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
        : { status: 'failed', what, stage: 'submit', message: result.message, code: null },
    );
  };

  const deploy = async () => {
    const keys = signers();
    if (keys === null) {
      setKeyProblem('The keys are no longer in this browser. Generate them again.');
      return;
    }

    let deployed: string | null = null;

    const outcome = await log.run(
      'deploy',
      'Creating the smart account — createCustomContract, with the owner signer as its only signer',
      async () => {
        const chain = await loadChain();

        // Before anything is built. A demonstration where the owner and the
        // agent are the same key demonstrates nothing, and this is the
        // mechanism rather than the intention.
        //
        // `assertTestnet` is deliberately not called here as well. Level 1 of
        // the mainnet gate already makes `NETWORK_PASSPHRASE` a one-member
        // union that cannot hold anything else, and level 2 fires inside
        // `submitAuthorized` and again in `createLocalKeys`. A third call at
        // the call site would read as the fence living here, which would make
        // it deletable from here.
        chain.assertDistinctSigners(keys.owner.rawPublicKey, keys.agent.rawPublicKey);

        const result = await chain.submitAuthorized({
          rpcUrl: RPC_URL,
          passphrase: NETWORK_PASSPHRASE,
          feeSource: keys.owner.publicKey,
          signEnvelope: keys.owner.signEnvelope,
          func: chain.deployAccountFunction({
            accountWasmHash: ACCOUNT_WASM_HASH,
            deployer: keys.owner.publicKey,
            owner: {
              kind: 'external',
              verifier: ED25519_VERIFIER,
              publicKey: keys.owner.rawPublicKey,
            },
          }),
          label: 'deploy',
        });

        // Read out of the transaction's return value, never derived from the
        // deployer and salt. Deriving it would be this repository agreeing with
        // itself about what the network did instead of asking.
        if (result.stage === 'ledger' && result.ok) {
          deployed = chain.deployedContractAddress(result.returnValue);
        }
        return result;
      },
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
              The account contract is OpenZeppelin&rsquo;s multisig smart account example, built from{' '}
              <span className="value">{WASM_SOURCE.tag}</span> and already on testnet. Limen writes
              no Rust and generates none. What is not audited is the code that decides what to
              install.
            </p>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
              <div className="flex flex-col gap-0.5">
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
              <div className="flex flex-col gap-2 border-t border-border-faint pt-4">
                <p className="text-[12.5px] leading-relaxed text-muted">
                  This account will be owned by the key below, and by no other. It is fixed at
                  creation.
                </p>
                <LocalKeyBadge role="OWNER" publicKey={owner} />
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
