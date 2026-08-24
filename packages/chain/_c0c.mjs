import { Address, Contract, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { authPayload, externalSigner, simulationErrorCode, describeContractError } from './dist/index.js';

const RPC='https://soroban-testnet.stellar.org';
const ROUTER='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const XLM='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC='CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const SA='CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM';
const AGENT='GASX3ZQJUE4SSAJFSAK2FZ55Q6XKXCYQF5HUAMF7ITUVDGNDL6VTH3EJ';
const VERIFIER='CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const AGENT_KEY=Buffer.from('257de609a1392901259015a2e7bd87aeab8b102f4f4030bf44e95199a35fab33','hex');
const OWNER_KEY=Buffer.from('963805962f300887b494bd28ba08cb95bc1f4abf5ac832d42e27f9b4da68c9e3','hex');

const server=new rpc.Server(RPC);
const acct=await server.getAccount(AGENT);
const i128=v=>nativeToScVal(BigInt(v),{type:'i128'});
const deadline=Math.floor(Date.now()/1000)+3600;
const CAP=1000000n; // 0.1 XLM, the installed limit

function swapFunc(amountIn){
  return new Contract(ROUTER).call('swap_exact_tokens_for_tokens',
    i128(amountIn), i128(0),
    nativeToScVal([new Address(XLM),new Address(USDC)],{type:'address'}),
    new Address(SA).toScVal(), nativeToScVal(deadline,{type:'u64'}));
}
async function record(amountIn){
  const tx=new TransactionBuilder(acct,{fee:'2000000',networkPassphrase:Networks.TESTNET})
    .addOperation(swapFunc(amountIn)).setTimeout(120).build();
  const sim=await server.simulateTransaction(tx);
  if(rpc.Api.isSimulationError(sim)) throw new Error('recording failed: '+sim.error.slice(0,200));
  return sim.result?.auth??[];
}
const expiry=(await server.getLatestLedger()).sequence+200;

async function enforcing(label, amountIn, ruleIds){
  const recorded=await record(amountIn);
  const payload=authPayload([
    {signer:externalSigner(VERIFIER,new Uint8Array(OWNER_KEY)),signature:new Uint8Array(0)},
    {signer:externalSigner(VERIFIER,new Uint8Array(AGENT_KEY)),signature:new Uint8Array(0)},
  ], ruleIds);
  const attached=recorded.map(e=>{
    const c=xdr.SorobanAuthorizationEntry.fromXDR(e.toXDR());
    const cr=c.credentials().address();
    cr.signatureExpirationLedger(expiry); cr.signature(payload);
    return c;
  });
  const tx=new TransactionBuilder(await server.getAccount(AGENT),{fee:'2000000',networkPassphrase:Networks.TESTNET})
    .addOperation(Operation.invokeHostFunction({func:swapFunc(amountIn).body().invokeHostFunctionOp().hostFunction(),auth:attached}))
    .setTimeout(120).build();
  const sim=await server.simulateTransaction(tx);
  const code=rpc.Api.isSimulationError(sim)?simulationErrorCode(sim.error):null;
  console.log(`\n--- ${label}  context_rule_ids=[${ruleIds}]`);
  if(rpc.Api.isSimulationError(sim)){
    console.log('  FAILED  decoded:', code===null?'no contract code':describeContractError(code));
    console.log('  first line:', sim.error.split('\n')[0].slice(0,220));
  } else console.log('  SUCCEEDED (no __check_auth refusal)');
}

console.log('installed cap: 1000000 (0.1 XLM, 7dp) on', XLM);
await enforcing('UNDER cap 0.05 XLM, ids [1]        (one id, two contexts)', 500000, [1]);
await enforcing('UNDER cap 0.05 XLM, ids [0,1]      (Default for router, XLM rule for transfer)', 500000, [0,1]);
await enforcing('OVER  cap 5.00 XLM, ids [0,1]      (does the cap trap?)', 50000000, [0,1]);
