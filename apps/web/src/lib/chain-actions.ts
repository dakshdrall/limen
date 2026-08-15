/**
 * Every write the product makes, as functions rather than as screens.
 *
 * PLAN-V7 §3.4. `/app/try` is a guided path through the same nine transactions
 * the four reference screens already perform, and there are only two ways to
 * build it: mount those screens on one route, or reach under them. Mounting them
 * gives four screens stacked on a page, which is the thing the guided flow exists
 * to stop. Copying their write logic gives two implementations of the one claim
 * this product makes, and the moment they disagree one of them is lying.
 *
 * So the seam is drawn *under* the UI. Everything here is the write logic lifted
 * out of `NewAccountScreen`, `AccountWriteSteps`, `InstallControl` and
 * `AgentRunSteps` unchanged; those four now call these, and `/app/try` calls
 * these too. The markup and the copy stayed where they were — a reference screen
 * and a guided flow are different registers and should read differently — but
 * neither of them owns a transaction any more.
 *
 * ## The shape, and why it is this shape
 *
 * Every action returns a {@link SubmitResultLike}, so it drops into
 * `WriteLog.run(...)` unchanged and inherits the whole of `use-write`: the
 * synchronous ref guard, the `running` entry with its sentence, the
 * browser-stage-versus-ledger-stage split that `WriteResult` draws differently.
 * None of that is reimplemented here and none of it should be. An action that
 * needed its own error handling would be an action that had escaped the log.
 *
 * ## The two out-parameters, and why they are not return values
 *
 * `deployAccount` and `installBoundary` each produce something besides a
 * submission result: a contract address, a rule id. Both are read out of the
 * transaction's return value, and both are needed by the caller.
 *
 * They are handed back through a callback rather than by widening the return
 * type, because widening it would take these functions out of `log.run`'s
 * signature and every caller would then need its own way of converting a result
 * into an outcome. That is precisely the duplication this module exists to
 * remove. The callback is the same closure-capture the screens were already
 * doing; it is only named now.
 *
 * ## What is deliberately *not* here
 *
 * `fundFromFriendbot` stays in `chain-write.ts`. It is not a transaction this
 * application built, signed and submitted, it does not return a
 * `SubmitResultLike`, and it goes through `WriteLog.track` rather than `run` —
 * the distinction `use-write` is careful about. Pulling it in here to make the
 * module look complete would erase it.
 */

import type { InstallPlan } from '@limen/chain/plan';
import { LOCAL_KEY_LABEL, type LocalKey } from '@/lib/local-key';
import type { SnapshotRule } from '@/lib/account-contract';
import {
  ACCOUNT_WASM_HASH,
  ED25519_VERIFIER,
  RPC_URL,
  SPENDING_LIMIT_POLICY,
  WEBAUTHN_VERIFIER,
} from '@/lib/chain-config';
import type { Ed25519Signer as ChainEd25519Signer } from '@limen/chain/browser';
import { loadChain, type ChainBrowser, type SubmitResultLike } from '@/lib/chain-write';
import { NETWORK_PASSPHRASE } from '@/lib/network';

/**
 * Ledgers of validity given to every signed auth entry. ~10 minutes.
 *
 * One constant now. It was three: `AccountWriteSteps` and `AgentRunSteps` each
 * declared their own `AUTH_VALIDITY_LEDGERS = 200` and `InstallControl` wrote
 * `200` inline. All three agreed, which is the only reason nothing was wrong —
 * and three copies of a number that must agree is a disagreement that has not
 * happened yet.
 */
export const AUTH_VALIDITY_LEDGERS = 200;

/** 100 XLM in stroops, enough to fund several agent runs and their fees. */
export const SEED_AMOUNT = 1_000_000_000n;

/** 0.1 XLM. The flow the boundary is derived from — deliberately small. */
export const OBSERVED_AMOUNT = 1_000_000n;

/**
 * This module names {@link LOCAL_KEY_LABEL} because it imports the key module,
 * and `test/local-key-label.test.ts` requires every such file to — which it
 * caught on the first run after this extraction landed.
 *
 * The rule is doing more work here than in `use-local-keys.ts`, not less. That
 * hook hands a screen a key; this module is where the key is *used* — every
 * signature in the product is produced by one of the functions below. Extracting
 * the write logic out of the screens moved that act from four files that render
 * the label to one file that cannot render anything, and a label that travels
 * with the key everywhere except the place it signs is not travelling with it.
 */
export const CHAIN_ACTION_KEY_LABEL = LOCAL_KEY_LABEL;

/**
 * A passkey standing in as the account's owner signer.
 *
 * PLAN-V7 §5.4. Only the *owner signer* changes: `keys.owner` is still here and
 * still does two jobs a passkey cannot do — it is the transaction's fee source
 * and it signs the envelope. A passkey cannot pay a Stellar fee, so a
 * passkey-owned account still needs a classic key in this browser, and that key
 * still carries `TESTNET ONLY · LOCAL KEY`.
 */
export interface PasskeyOwner {
  /** `key_data` for `Signer::External`: 65-byte point ‖ credential id. */
  keyData: Uint8Array;
  /** Hex of the 65 key bytes, as a context rule reports the signer back. */
  hexPublicKey: string;
  signer: ChainEd25519Signer;
}

/** Both keys, as `useSigners()` hands them over. */
export interface Keys {
  owner: LocalKey;
  agent: LocalKey;
  /**
   * When present, the account's owner signer is this passkey rather than
   * `owner`'s ed25519 key. Absent is the default and the zero-friction path: a
   * reviewer with no passkey must never hit a wall.
   */
  passkey?: PasskeyOwner;
}

/**
 * Which signer owns the account, and which verifier vouches for it.
 *
 * One place, because the alternative is four call sites each deciding, and the
 * failure mode of getting it wrong is an account whose owner is a key that
 * cannot sign for it. The fee source is deliberately *not* part of this: it is
 * always `keys.owner`, on both paths.
 */
function ownerAuth(keys: Keys): {
  verifier: string;
  keyData: Uint8Array;
  signer: ChainEd25519Signer;
} {
  return keys.passkey === undefined
    ? { verifier: ED25519_VERIFIER, keyData: keys.owner.rawPublicKey, signer: keys.owner.signer }
    : { verifier: WEBAUTHN_VERIFIER, keyData: keys.passkey.keyData, signer: keys.passkey.signer };
}

/**
 * The artifacts of the permitted call, which the over-cap attempt and the
 * post-revoke repeat both borrow.
 *
 * Typed off the chain module rather than by importing the SDK's XDR types, so
 * this file names them without pulling the SDK into its own module graph.
 */
type SubmitLedgerResult = Extract<
  Awaited<ReturnType<ChainBrowser['submitAuthorized']>>,
  { stage: 'ledger' }
>;

export interface PermittedCall {
  amount: bigint;
  transactionData: SubmitLedgerResult['transactionData'];
  signedAuth: SubmitLedgerResult['signedAuth'];
}

/* --- creating an account -------------------------------------------------- */

/**
 * Create the smart account. `createCustomContract`, owner signer only.
 *
 * The smart account signs nothing at deploy — `__constructor` runs as part of
 * contract creation — so the only signature the network requires is the fee
 * source's on the envelope. That is why a key generated thirty seconds ago and
 * funded by friendbot is enough, and it is what makes the whole browser path
 * reachable.
 *
 * `assertDistinctSigners` runs before anything is built. A demonstration where
 * the owner and the agent are the same key demonstrates nothing, and this is the
 * mechanism rather than the intention.
 *
 * `assertTestnet` is deliberately not called here either. Level 1 of the mainnet
 * gate already makes `NETWORK_PASSPHRASE` a one-member union that cannot hold
 * anything else, and level 2 fires inside `submitAuthorized` and again in
 * `createLocalKeys`. A third call at this level would read as the fence living
 * here, which would make it deletable from here.
 */
export async function deployAccount({
  keys,
  onDeployed,
}: {
  keys: Keys;
  /**
   * The contract address, read out of the transaction's return value and never
   * derived from the deployer and salt. Deriving it would be this repository
   * agreeing with itself about what the network did instead of asking.
   */
  onDeployed: (contractId: string) => void;
}): Promise<SubmitResultLike> {
  const chain = await loadChain();

  chain.assertDistinctSigners(keys.owner.rawPublicKey, keys.agent.rawPublicKey);

  const result = await chain.submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: keys.owner.publicKey,
    signEnvelope: keys.owner.signEnvelope,
    func: chain.deployAccountFunction({
      accountWasmHash: ACCOUNT_WASM_HASH,
      deployer: keys.owner.publicKey,
      // The owner signer, which is the passkey when there is one. The deployer
      // and fee source stay the classic key either way — the account does not
      // authorize its own creation, so nothing here needs the owner to sign.
      owner: {
        kind: 'external',
        verifier: ownerAuth(keys).verifier,
        publicKey: ownerAuth(keys).keyData,
      },
    }),
    label: 'deploy',
  });

  if (result.stage === 'ledger' && result.ok) {
    onDeployed(chain.deployedContractAddress(result.returnValue));
  }
  return result;
}

/* --- giving it a history -------------------------------------------------- */

/**
 * The owner's classic account paying the smart account. Ordinary `G→C`.
 *
 * No `signAuthEntry`: this is the owner's own classic account paying out,
 * authorized by the envelope signature. The smart account is only the recipient
 * and authorizes nothing — which is exactly why this transaction is *not* the
 * one a boundary gets derived from.
 */
export async function fundSmartAccount({
  keys,
  contractId,
  amount = SEED_AMOUNT,
}: {
  keys: Keys;
  contractId: string;
  amount?: bigint;
}): Promise<SubmitResultLike> {
  const chain = await loadChain();
  return chain.submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: keys.owner.publicKey,
    signEnvelope: keys.owner.signEnvelope,
    func: chain.transferFunction({
      token: chain.nativeTokenId(NETWORK_PASSPHRASE),
      from: keys.owner.publicKey,
      to: contractId,
      amount,
    }),
    label: 'seed',
  });
}

/**
 * The account's own transfer out. `C→G`, under the Default rule.
 *
 * This is the half that makes it the account's transaction rather than the
 * owner's: the smart account is the `from`, so the host calls `__check_auth` on
 * it, and the owner's signature has to arrive as a signed auth entry naming the
 * rule it is signing under.
 *
 * PLAN-V4 §1's point about this one still stands and is the reason it exists:
 * the boundary is derived from a transaction this account actually made, read
 * back off the ledger, never from a shipped fixture and never from the amount
 * this code sent. Callers pass the *hash* forward, not `amount`.
 */
export async function observedTransfer({
  keys,
  contractId,
  defaultRuleId,
  amount = OBSERVED_AMOUNT,
}: {
  keys: Keys;
  contractId: string;
  defaultRuleId: number;
  amount?: bigint;
}): Promise<SubmitResultLike> {
  const chain = await loadChain();
  const { rpc } = await import('@stellar/stellar-sdk');
  const latest = await new rpc.Server(RPC_URL).getLatestLedger();

  return chain.submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: keys.owner.publicKey,
    signEnvelope: keys.owner.signEnvelope,
    func: chain.transferFunction({
      token: chain.nativeTokenId(NETWORK_PASSPHRASE),
      from: contractId,
      to: keys.agent.publicKey,
      amount,
    }),
    signAuthEntry: chain.signAs({
      signer: ownerAuth(keys).signer,
      verifier: ownerAuth(keys).verifier,
      contextRuleIds: [defaultRuleId],
      expirationLedger: latest.sequence + AUTH_VALIDITY_LEDGERS,
      passphrase: NETWORK_PASSPHRASE,
    }),
    label: 'observe',
  });
}

/* --- installing ----------------------------------------------------------- */

/**
 * Write the reviewed plan to the account. `add_context_rule`, owner-signed.
 *
 * One submission per rule, because `add_context_rule` returns the rule it
 * created and the id in that return value is the only trustworthy source for
 * what was installed — batching would save a fee and lose the attribution every
 * later screen depends on. A plan that lowered to more than one rule throws
 * rather than silently installing the first of several.
 *
 * The agent's key is what the rule is installed *for*. It never signs here, and
 * `assertDistinctSigners` runs inside `installFunctions` before a single host
 * function is built: a boundary whose bounded key is the key that installed it
 * is not a boundary.
 */
export async function installBoundary({
  keys,
  accountId,
  plan,
  onInstalled,
}: {
  keys: Keys;
  accountId: string;
  plan: InstallPlan;
  /** The rule id, read out of what `add_context_rule` returned, not assumed. */
  onInstalled: (ruleId: number) => void;
}): Promise<SubmitResultLike> {
  const chain = await loadChain();
  const { rpc } = await import('@stellar/stellar-sdk');
  const server = new rpc.Server(RPC_URL);

  // The account's Default rule, read back rather than assumed to be 0. The
  // owner signs under it, and its id comes from the same on-chain counter every
  // other rule's does.
  const rules = await chain.readAllContextRules(
    { rpcUrl: RPC_URL, simulationSource: keys.owner.publicKey },
    accountId,
  );
  const defaultRule = rules.find((r) => r.contextType === 'Default');
  if (defaultRule === undefined) {
    throw new Error(
      'this account has no Default rule, so there is no rule the owner could sign under',
    );
  }

  const [func, ...rest] = chain.installFunctions(plan, {
    smartAccount: accountId,
    verifier: ED25519_VERIFIER,
    spendingLimitPolicy: SPENDING_LIMIT_POLICY,
    agentPublicKey: keys.agent.rawPublicKey,
    // The account's owner *signer*, which is the passkey when there is one.
    // Only `assertDistinctSigners` reads it, and the key that must not be the
    // agent's is the one the boundary is installed by.
    ownerPublicKey: ownerAuth(keys).keyData,
  });
  if (func === undefined) throw new Error('the plan lowered to no rules');
  if (rest.length > 0) {
    throw new Error(
      `this plan lowered to ${rest.length + 1} context rules, and this screen installs one. Nothing was submitted.`,
    );
  }

  const latest = await server.getLatestLedger();

  const result = await chain.submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: keys.owner.publicKey,
    signEnvelope: keys.owner.signEnvelope,
    func,
    signAuthEntry: chain.signAs({
      signer: ownerAuth(keys).signer,
      verifier: ownerAuth(keys).verifier,
      contextRuleIds: [defaultRule.id],
      expirationLedger: latest.sequence + AUTH_VALIDITY_LEDGERS,
      passphrase: NETWORK_PASSPHRASE,
    }),
    label: 'install',
  });

  if (result.stage === 'ledger' && result.ok) {
    onInstalled(chain.contextRuleIdFrom(result.returnValue));
  }
  return result;
}

/* --- running the agent ---------------------------------------------------- */

/**
 * Everything the five agent steps share, resolved once per click.
 *
 * The auth-entry signers are built here rather than in each step because they
 * must name the same rule and the same expiry across all five — a step that
 * quietly signed under a different rule would produce a refusal that looked like
 * the boundary working and was not.
 *
 * Returns `null` when there is nothing to run against: no keys, no rule, or a
 * rule with no readable cap or contract. Callers check for `null` rather than
 * being handed a context that is missing the parts they need.
 */
export async function prepareRun({
  keys,
  contractId,
  rule,
}: {
  keys: Keys | null;
  contractId: string;
  /**
   * The rule, retained by the caller across the revoke on purpose — the
   * post-revoke step submits under a rule id that no longer exists, which is the
   * only way to produce `ContextRuleNotFound`.
   */
  rule: SnapshotRule | null;
}): Promise<RunContext | null> {
  const cap = rule?.policies[0]?.limit?.limit ?? null;
  const token = rule?.contract ?? null;
  if (keys === null || rule === null || token === null || cap === null) return null;

  const chain = await loadChain();
  const { rpc, xdr } = await import('@stellar/stellar-sdk');
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  const expiry = latest.sequence + AUTH_VALIDITY_LEDGERS;

  const rules = await chain.readAllContextRules(
    { rpcUrl: RPC_URL, simulationSource: keys.owner.publicKey },
    contractId,
  );
  const defaultRule = rules.find((r) => r.contextType === 'Default');

  return {
    chain,
    xdr,
    keys,
    contractId,
    expiry,
    ruleId: rule.id,
    defaultRuleId: defaultRule?.id ?? null,
    agentSigns: chain.signAs({
      signer: keys.agent.signer,
      verifier: ED25519_VERIFIER,
      contextRuleIds: [rule.id],
      expirationLedger: expiry,
      passphrase: NETWORK_PASSPHRASE,
    }),
    ownerSigns:
      defaultRule === undefined
        ? null
        : chain.signAs({
            signer: ownerAuth(keys).signer,
            verifier: ownerAuth(keys).verifier,
            contextRuleIds: [defaultRule.id],
            expirationLedger: expiry,
            passphrase: NETWORK_PASSPHRASE,
          }),
    // Spending less than the cap on purpose: the post-revoke step has to fail
    // because the rule is gone, and if the permitted amount had exhausted the
    // cap it would fail for two reasons at once and prove neither.
    permittedAmount: BigInt(cap) / 2n,
    cap: BigInt(cap),
    token,
    transfer: (amount: bigint) =>
      chain.transferFunction({
        token,
        from: contractId,
        to: keys.owner.publicKey,
        amount,
      }),
  };
}

export interface RunContext {
  chain: ChainBrowser;
  xdr: Awaited<typeof import('@stellar/stellar-sdk')>['xdr'];
  keys: Keys;
  contractId: string;
  expiry: number;
  ruleId: number;
  defaultRuleId: number | null;
  agentSigns: ReturnType<ChainBrowser['signAs']>;
  ownerSigns: ReturnType<ChainBrowser['signAs']> | null;
  permittedAmount: bigint;
  cap: bigint;
  token: string;
  transfer: (amount: bigint) => ReturnType<ChainBrowser['transferFunction']>;
}

/**
 * The agent spends inside the cap. Signed and paid for by the agent.
 *
 * No owner signature is anywhere near this transaction, and the separation is
 * visible in the fee source as well as in the auth entry.
 *
 * The over-cap attempt and the post-revoke repeat are both refused by the
 * network, so neither can produce a footprint of its own. Both borrow this
 * one — the enforcing simulation of the call that *does* work, which is the only
 * thing that lets a refusal reach a ledger and have a hash worth showing.
 */
export async function agentSpends(
  ctx: RunContext,
  { onPermitted }: { onPermitted: (call: PermittedCall) => void },
): Promise<SubmitResultLike> {
  const result = await ctx.chain.submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.agent.publicKey,
    signEnvelope: ctx.keys.agent.signEnvelope,
    func: ctx.transfer(ctx.permittedAmount),
    signAuthEntry: ctx.agentSigns,
    label: 'permitted',
  });

  if (result.stage === 'ledger' && result.ok) {
    onPermitted({
      amount: ctx.permittedAmount,
      transactionData: result.transactionData,
      signedAuth: result.signedAuth,
    });
  }
  return result;
}

/**
 * The agent tries to spend over the cap. Refused *on a ledger*, not in
 * simulation — which costs a fee and is the whole point: an attempt with no hash
 * is this repository's word for what would have happened.
 *
 * The entry the permitted call produces, with one argument changed. The agent
 * signs the modified entry, so this is a real attempt by the agent's key rather
 * than a malformed transaction.
 */
export async function agentSpendsOver(
  ctx: RunContext,
  borrowed: PermittedCall,
  { amount }: { amount: bigint },
): Promise<SubmitResultLike> {
  const permittedFunc = ctx.transfer(borrowed.amount);

  const [recorded] = await ctx.chain.recordAuthEntries({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.agent.publicKey,
    func: permittedFunc,
  });
  if (recorded === undefined) throw new Error('the permitted call produced no auth entry');

  const overEntry = ctx.xdr.SorobanAuthorizationEntry.fromXDR(recorded.toXDR());
  overEntry.rootInvocation().function().contractFn().args()[2] = ctx.chain.i128(amount);

  return ctx.chain.submitWithBorrowedFootprint({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.agent.publicKey,
    signEnvelope: ctx.keys.agent.signEnvelope,
    func: ctx.transfer(amount),
    transactionData: borrowed.transactionData,
    auth: [await ctx.agentSigns(overEntry)],
    label: 'over-limit',
  });
}

/**
 * The agent tries to remove the boundary that binds it.
 *
 * Refused by the contract, not by this application declining to offer a button —
 * `remove_context_rule` requires the account to authorize itself, and the
 * agent's rule is `CallContract(token)`, which does not match a call to the
 * account. The owner's Default rule does. This is the direct answer to *"the
 * agent holds a key, so what stops it?"*
 *
 * The footprint is borrowed from the *owner's* revoke, which simulates cleanly.
 * The agent's own attempt does not, which is the finding.
 */
export async function agentRevokes(
  ctx: RunContext,
  { ownerSigns }: { ownerSigns: NonNullable<RunContext['ownerSigns']> },
): Promise<SubmitResultLike> {
  const revokeFunc = ctx.chain.removeContextRuleFunction(ctx.contractId, ctx.ruleId);

  const footprint = await ctx.chain.enforcingFootprint({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.owner.publicKey,
    func: revokeFunc,
    signAuthEntry: ownerSigns,
  });

  const [entry] = await ctx.chain.recordAuthEntries({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.agent.publicKey,
    func: revokeFunc,
  });
  if (entry === undefined) throw new Error('the revoke call produced no auth entry');

  return ctx.chain.submitWithBorrowedFootprint({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.agent.publicKey,
    signEnvelope: ctx.keys.agent.signEnvelope,
    func: revokeFunc,
    transactionData: footprint,
    auth: [await ctx.agentSigns(entry)],
    label: 'agent-revoke',
  });
}

/** The owner removes the boundary. The same key that installed it. */
export async function ownerRevokes(
  ctx: RunContext,
  { ownerSigns }: { ownerSigns: NonNullable<RunContext['ownerSigns']> },
): Promise<SubmitResultLike> {
  return ctx.chain.submitAuthorized({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.owner.publicKey,
    signEnvelope: ctx.keys.owner.signEnvelope,
    func: ctx.chain.removeContextRuleFunction(ctx.contractId, ctx.ruleId),
    signAuthEntry: ownerSigns,
    label: 'revoke',
  });
}

/**
 * The agent repeats the call that worked.
 *
 * Byte for byte what the permitted step submitted: the same host function, the
 * same borrowed footprint, and the *same signed auth entry*. Nothing about the
 * agent's attempt has changed — the account has. That is what makes the
 * different outcome attributable to the revoke and to nothing else, and it is
 * why neither is rebuilt here.
 *
 * It fails `ContextRuleNotFound#3000`, which is deliberately not in
 * `BOUNDARY_REFUSAL_CODES`. "The boundary refused you" and "the boundary is
 * gone" are different claims — see `verdictFor` in `lib/verdict.ts`.
 */
export async function agentRepeats(
  ctx: RunContext,
  borrowed: PermittedCall,
): Promise<SubmitResultLike> {
  return ctx.chain.submitWithBorrowedFootprint({
    rpcUrl: RPC_URL,
    passphrase: NETWORK_PASSPHRASE,
    feeSource: ctx.keys.agent.publicKey,
    signEnvelope: ctx.keys.agent.signEnvelope,
    func: ctx.transfer(borrowed.amount),
    transactionData: borrowed.transactionData,
    auth: borrowed.signedAuth,
    label: 'post-revoke',
  });
}

/**
 * The message the two borrowing steps fail with when nothing has been borrowed.
 *
 * Shared so the guided flow and the reference screen say the same thing about
 * the same condition, rather than paraphrasing each other.
 */
export const NO_FOOTPRINT_YET =
  'run step 01 first: this attempt is refused by the network, so it cannot produce a footprint of its own and has to borrow one from the call that works';
