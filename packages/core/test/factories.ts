import type { ObservedTransaction } from '../src/index.js';

export const SOURCE = 'GSOURCEACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const RECIPIENT = 'GRECIPIENTACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const USDC = 'CUSDCTOKENCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const XLM = 'CXLMTOKENCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const ROUTER = 'CROUTERCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const OBSERVED_LEDGER = 51_234;

/** 50 USDC at 7 decimals, moved once, through the token contract. */
export function singleTransfer(): ObservedTransaction {
  return {
    hash: 'a'.repeat(64),
    network: 'simulated',
    ledger: OBSERVED_LEDGER,
    source: SOURCE,
    invocations: [
      {
        contractId: USDC,
        functionName: 'transfer',
        args: [SOURCE, RECIPIENT, '500000000'],
      },
    ],
    // One invocation, so there is only one call these movements can belong to.
    attribution: 'exact',
    movements: [{ asset: USDC, from: SOURCE, to: RECIPIENT, amount: '500000000' }],
  };
}

/** Two contracts, two functions — proves observed breadth is permitted breadth. */
export function twoInvocations(): ObservedTransaction {
  return {
    hash: 'b'.repeat(64),
    network: 'simulated',
    ledger: OBSERVED_LEDGER,
    source: SOURCE,
    invocations: [
      {
        contractId: USDC,
        functionName: 'approve',
        args: [SOURCE, ROUTER, '500000000'],
      },
      {
        contractId: ROUTER,
        functionName: 'swap',
        args: [USDC, XLM, '500000000'],
      },
    ],
    // Two invocations: the meta does not say which call emitted which transfer.
    attribution: 'transaction-level',
    movements: [
      { asset: USDC, from: SOURCE, to: ROUTER, amount: '500000000' },
      { asset: XLM, from: ROUTER, to: SOURCE, amount: '1200000000' },
    ],
  };
}

/**
 * Sends 1000 out and receives 1000 of the SAME asset back. Gross outflow is
 * 1000; net is 0. Used to prove the cap is never netted.
 */
export function roundTrip(): ObservedTransaction {
  return {
    hash: 'c'.repeat(64),
    network: 'simulated',
    ledger: OBSERVED_LEDGER,
    source: SOURCE,
    invocations: [
      {
        contractId: ROUTER,
        functionName: 'round_trip',
        args: [],
      },
    ],
    attribution: 'exact',
    movements: [
      { asset: USDC, from: SOURCE, to: ROUTER, amount: '1000' },
      { asset: USDC, from: ROUTER, to: SOURCE, amount: '1000' },
    ],
  };
}

/** N distinct contracts, each with one function — used to trip the 5-policy cap. */
export function manyContracts(count: number): ObservedTransaction {
  return {
    hash: 'd'.repeat(64),
    network: 'simulated',
    ledger: OBSERVED_LEDGER,
    source: SOURCE,
    invocations: Array.from({ length: count }, (_, i) => ({
      contractId: `CCONTRACT${String(i).padStart(2, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      functionName: 'ping',
      args: [],
    })),
    attribution: count === 1 ? 'exact' : 'transaction-level',
    movements: [],
  };
}

/**
 * N assets moving out of the source in one call, so the derived proposal is
 * N spending limits + 1 allowlist. Used to trip the 5-policy cap on a flow
 * that spends, rather than on one that only pings.
 */
export function manyAssets(count: number): ObservedTransaction {
  return {
    hash: 'e'.repeat(64),
    network: 'simulated',
    ledger: OBSERVED_LEDGER,
    source: SOURCE,
    invocations: [{ contractId: ROUTER, functionName: 'multi_send', args: [] }],
    attribution: 'exact',
    movements: Array.from({ length: count }, (_, i) => ({
      asset: `CASSET${String(i).padStart(2, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      from: SOURCE,
      to: RECIPIENT,
      amount: '1000',
    })),
  };
}
