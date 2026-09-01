import { describe, expect, it } from 'vitest';
import { emptyDraft } from '@/lib/agent-config';
import { triggerDirection } from '@/lib/trigger-direction';

/**
 * The trap this closes: a strategy sentence and the agent it produces reading
 * opposite ways, with nothing on screen to say so.
 *
 * The assertions are about *which asset is sold*, because that is the fact a
 * reader gets wrong. A test that only checked the sentence was non-empty would
 * pass against the bug.
 */
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';

const withPair = (over: Partial<ReturnType<typeof emptyDraft>> = {}) => ({
  ...emptyDraft(),
  assetLabel: 'XLM',
  assetContractId: XLM,
  outputAssetLabel: 'USDC',
  outputAssetContractId: USDC,
  triggerDropBps: '100',
  triggerAmount: '5',
  ...over,
});

describe('triggerDirection', () => {
  it('names the asset the agent sells, which is the one it spends', () => {
    const direction = triggerDirection(withPair());

    expect(direction).not.toBeNull();
    expect(direction?.sells).toBe('XLM');
    expect(direction?.buys).toBe('USDC');
    expect(direction?.fallMeans).toBe('fewer USDC for one XLM');
    expect(direction?.percent).toBe('1%');
  });

  it('reverses with the pair, because the price does', () => {
    // The same 100 basis points, the other way round: a USDC-spending agent's
    // price is XLM-per-USDC, so a fall is fewer XLM for one USDC — which is
    // XLM getting *more* expensive. Nothing here should read as XLM falling.
    const direction = triggerDirection(
      withPair({
        assetLabel: 'USDC',
        assetContractId: USDC,
        outputAssetLabel: 'XLM',
        outputAssetContractId: XLM,
      }),
    );

    expect(direction?.sells).toBe('USDC');
    expect(direction?.buys).toBe('XLM');
    expect(direction?.fallMeans).toBe('fewer XLM for one USDC');
  });

  it('falls back to the contract when a label was not typed', () => {
    const direction = triggerDirection(withPair({ assetLabel: '  ', outputAssetLabel: '' }));

    // Truncated, but unmistakably the contract on the field above rather than
    // a name invented for it.
    expect(direction?.sells).toContain('CDLZFC');
    expect(direction?.buys).toContain('CB3TLW');
  });

  it('says nothing when there is no pair to measure a price in', () => {
    expect(
      triggerDirection(withPair({ outputAssetLabel: '', outputAssetContractId: '' })),
    ).toBeNull();
  });

  it('says nothing until the fall is a usable number', () => {
    expect(triggerDirection(withPair({ triggerDropBps: '' }))).toBeNull();
    expect(triggerDirection(withPair({ triggerDropBps: '1o0' }))).toBeNull();
    expect(triggerDirection(withPair({ triggerDropBps: '0' }))).toBeNull();
    // 10,000 bps is the price reaching zero, which `validate` refuses too.
    expect(triggerDirection(withPair({ triggerDropBps: '10000' }))).toBeNull();
  });

  it('renders a fractional percentage without inventing precision', () => {
    expect(triggerDirection(withPair({ triggerDropBps: '250' }))?.percent).toBe('2.5%');
    expect(triggerDirection(withPair({ triggerDropBps: '1' }))?.percent).toBe('0.01%');
  });
});
