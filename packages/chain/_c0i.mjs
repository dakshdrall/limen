import { Address, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { externalSigner, invokeContract, structMap, simulationErrorCode, describeContractError } from './dist/index.js';
const RPC='https://soroban-testnet.stellar.org';
const ROUTER='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const XLM='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC='CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const SA='CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM';
const AGENT='GASX3ZQJUE4SSAJFSAK2FZ55Q6XKXCYQF5HUAMF7ITUVDGNDL6VTH3EJ';
const V='CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const A=new Uint8Array(Buffer.from('257de609a1392901259015a2e7bd87aeab8b102f4f4030bf44e95199a35fab33','hex'));
const server=new rpc.Server(RPC);
const i128=v=>nativeToScVal(BigInt(v),{type:'i128'});
const dl=Math.floor(Date.now()/1000)+3600;
const fn=a=>invokeContract(ROUTER,'swap_exact_tokens_for_tokens',[i128(a),i128(0),
  nativeToScVal([new Address(XLM),new Address(USDC)],{type:'address'}),new Address(SA).toScVal(),nativeToScVal(dl,{type:'u64'})]);
function pay(sigs,ids){
  const e=sigs.map(({signer,signature})=>new xdr.ScMapEntry({key:signer,val:xdr.ScVal.scvBytes(Buffer.from(signature))}))
    .sort((x,y)=>Buffer.compare(x.key().toXDR(),y.key().toXDR()));
  return structMap([['context_rule_ids',xdr.ScVal.scvVec(ids.map(n=>xdr.ScVal.scvU32(n)))],['signers',xdr.ScVal.scvMap(e)]]);
}
const build=async(a,auth)=>new TransactionBuilder(await server.getAccount(AGENT),{fee:'4000000',networkPassphrase:Networks.TESTNET})
  .addOperation(Operation.invokeHostFunction({func:fn(a),auth:auth??[]})).setTimeout(120).build();
const exp=(await server.getLatestLedger()).sequence+200;
async function run(label,a,ids,sigs){
  const rec=await server.simulateTransaction(await build(a));
  if(rpc.Api.isSimulationError(rec)){console.log(`\n--- ${label}: RECORDING FAILED`);return;}
  const attached=(rec.result?.auth??[]).map(e=>{const c=xdr.SorobanAuthorizationEntry.fromXDR(e.toXDR());
    const cr=c.credentials().address();cr.signatureExpirationLedger(exp);cr.signature(pay(sigs,ids));return c;});
  const sim=await server.simulateTransaction(await build(a,attached));
  const err=sim.error??''; const code=simulationErrorCode(err);
  const reachedVerify=/fn_call, CA3ZVES4|contract call failed", verify/.test(err);
  console.log(`\n--- ${label}  ids=[${ids}]`);
  console.log('  ', code===null
    ? (reachedVerify?'contexts VALIDATED (stopped only at the signature I cannot forge)':'no contract code, and never reached the verifier')
    : 'REFUSED at context validation: '+describeContractError(code));
}
const agent={signer:externalSigner(V,A),signature:new Uint8Array(0)};
console.log('THE QUESTION: can the AGENT alone authorize a swap?');
console.log('rule 1 signers = [agent]; rule 0 (Default) signers = [owner]; agent is NOT in rule 0.\n');
await run('agent only, ids [1,1] (its own rule for both contexts)', 500000, [1,1], [agent]);
await run('agent only, ids [0,1] (borrow Default for the router)  ', 500000, [0,1], [agent]);
await run('agent only, ids [0,0] (Default for both)               ', 500000, [0,0], [agent]);
