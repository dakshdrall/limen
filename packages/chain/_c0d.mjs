import { Address, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { authPayload, externalSigner, simulationErrorCode, describeContractError, invokeContract } from './dist/index.js';

const RPC='https://soroban-testnet.stellar.org';
const ROUTER='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const XLM='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC='CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const SA='CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM';
const AGENT='GASX3ZQJUE4SSAJFSAK2FZ55Q6XKXCYQF5HUAMF7ITUVDGNDL6VTH3EJ';
const VERIFIER='CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const AGENT_KEY=new Uint8Array(Buffer.from('257de609a1392901259015a2e7bd87aeab8b102f4f4030bf44e95199a35fab33','hex'));
const OWNER_KEY=new Uint8Array(Buffer.from('963805962f300887b494bd28ba08cb95bc1f4abf5ac832d42e27f9b4da68c9e3','hex'));

const server=new rpc.Server(RPC);
const i128=v=>nativeToScVal(BigInt(v),{type:'i128'});
const deadline=Math.floor(Date.now()/1000)+3600;

const swapFn=(amountIn)=>invokeContract(ROUTER,'swap_exact_tokens_for_tokens',[
  i128(amountIn), i128(0),
  nativeToScVal([new Address(XLM),new Address(USDC)],{type:'address'}),
  new Address(SA).toScVal(), nativeToScVal(deadline,{type:'u64'})]);

async function build(amountIn, auth){
  return new TransactionBuilder(await server.getAccount(AGENT),{fee:'4000000',networkPassphrase:Networks.TESTNET})
    .addOperation(Operation.invokeHostFunction({func:swapFn(amountIn), auth: auth??[]}))
    .setTimeout(120).build();
}
const expiry=(await server.getLatestLedger()).sequence+200;

async function run(label, amountIn, ruleIds, signers){
  const rec=await server.simulateTransaction(await build(amountIn));
  if(rpc.Api.isSimulationError(rec)){ console.log(`\n--- ${label}\n  RECORDING FAILED: ${rec.error.split('\n')[0].slice(0,200)}`); return; }
  const recorded=rec.result?.auth??[];
  const payload=authPayload(signers,ruleIds);
  const attached=recorded.map(e=>{
    const c=xdr.SorobanAuthorizationEntry.fromXDR(e.toXDR());
    const cr=c.credentials().address();
    cr.signatureExpirationLedger(expiry); cr.signature(payload);
    return c;
  });
  const sim=await server.simulateTransaction(await build(amountIn, attached));
  console.log(`\n--- ${label}   ids=[${ruleIds}]`);
  if(rpc.Api.isSimulationError(sim)){
    const code=simulationErrorCode(sim.error);
    console.log('  refused:', code===null?'(no contract error code)':describeContractError(code));
    console.log('  ', sim.error.split('\n')[0].slice(0,200));
  } else console.log('  SUCCEEDED — __check_auth raised no refusal');
}

const owner={signer:externalSigner(VERIFIER,OWNER_KEY),signature:new Uint8Array(0)};
const agent={signer:externalSigner(VERIFIER,AGENT_KEY),signature:new Uint8Array(0)};

console.log('installed: rule 1 = CallContract('+XLM+') spending_limit 1000000 (0.1 XLM)');
console.log('           rule 0 = Default, owner signer, NO policies');
await run('UNDER cap, ids [1] only        ', 500000, [1], [agent]);
await run('UNDER cap, ids [0,1]           ', 500000, [0,1], [owner,agent]);
await run('OVER  cap, ids [0,1]           ', 50000000, [0,1], [owner,agent]);
await run('OVER  cap, ids [1,1]           ', 50000000, [1,1], [agent]);
