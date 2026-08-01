/**
 * Serializes a proposal into the Soroban `ScVal` payload an install call would
 * carry, as base64 XDR.
 *
 * This runs server-side purely to keep the Stellar SDK out of the client
 * bundle. It performs no network IO and signs nothing.
 *
 * Scope: this is the *argument* payload, which is fully derivable from the
 * proposal. The enclosing transaction — sequence number, fee, and the exact
 * entrypoint name — depends on a deployed OpenZeppelin smart account, which
 * this MVP does not deploy. See the Install section of the UI and the "not
 * done yet" section of the README.
 */

import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { PolicyProposal } from '@limen/core';

export const runtime = 'nodejs';

const sym = (value: string) => xdr.ScVal.scvSymbol(value);
const u32 = (value: number) => xdr.ScVal.scvU32(value);
const addr = (value: string) => new Address(value).toScVal();
const vec = (items: xdr.ScVal[]) => xdr.ScVal.scvVec(items);
const i128 = (value: string) => nativeToScVal(BigInt(value), { type: 'i128' });

/** Soroban requires map entries in sorted key order. */
function map(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return xdr.ScVal.scvMap(sorted.map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val })));
}

function policyToScVal(policy: PolicyProposal['policies'][number]): xdr.ScVal {
  if (policy.kind === 'spending_limit') {
    return map([
      ['kind', sym('spending_limit')],
      ['asset', addr(policy.asset)],
      ['limit', i128(policy.limit)],
      ['window_ledgers', u32(policy.windowLedgers)],
    ]);
  }
  return map([
    ['kind', sym('function_allowlist')],
    ['contract_id', addr(policy.contractId)],
    ['functions', vec(policy.functions.map(sym))],
  ]);
}

export function proposalToScVal(proposal: PolicyProposal): xdr.ScVal {
  const rule = proposal.contextRule;

  // Contract addresses are 56 characters, well past Soroban's 32-character
  // symbol limit, so the per-contract function lists are a vec of
  // (address, functions) pairs rather than a map keyed by symbol.
  const allowedFunctions = rule.allowedContracts.map((contractId) =>
    vec([addr(contractId), vec((rule.allowedFunctions[contractId] ?? []).map(sym))]),
  );

  return map([
    [
      'context_rule',
      map([
        ['allowed_contracts', vec(rule.allowedContracts.map(addr))],
        ['allowed_functions', vec(allowedFunctions)],
        ['valid_from_ledger', u32(rule.validFromLedger)],
        ['valid_until_ledger', u32(rule.validUntilLedger)],
      ]),
    ],
    ['policies', vec(proposal.policies.map(policyToScVal))],
  ]);
}

export async function POST(request: Request): Promise<Response> {
  let proposal: PolicyProposal;
  try {
    const body = (await request.json()) as { proposal?: PolicyProposal };
    if (body.proposal === undefined) throw new Error('missing proposal');
    proposal = body.proposal;
  } catch (error) {
    return Response.json(
      { error: `request body must be {"proposal": PolicyProposal}: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }

  try {
    const scval = proposalToScVal(proposal);
    return Response.json({
      xdr: scval.toXDR('base64'),
      smartAccountId: process.env.NEXT_PUBLIC_SMART_ACCOUNT_ID ?? null,
    });
  } catch (error) {
    return Response.json(
      { error: `could not serialize proposal: ${error instanceof Error ? error.message : String(error)}` },
      { status: 422 },
    );
  }
}
