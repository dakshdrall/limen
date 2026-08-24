import { Address, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { externalSigner, simulationErrorCode, describeContractError, invokeContract, structMap } from './dist/index.js';

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
const swapFn=a=>invokeContract(ROUTER,'swap_exact_tokens_for_tokens',[
  i128(a), i128(0), nativeToScVal([new Address(XLM),new Address(USDC)],{type:'address'}),
  new Address(SA).toScVal(), nativeToScVal(deadline,{type:'u64'})]);

// Soroban Maps require keys in sorted XDR order. authPayload does not sort the
// signers map, which is fine for one signer and InvalidInput for two.
function sortedAuthPayload(sigs, ruleIds){
  const entries=sigs.map(({signer,signature})=>new xdr.ScMapEntry({key:signer,val:xdr.ScVal.scvBytes(Buffer.from(signature))}))
    .sort((a,b)=>Buffer.compare(a.key().toXDR(),b.key().toXDR()));
  return structMap([
    ['context_rule_ids', xdr.ScVal.scvVec(ruleIds.map(n=>xdr.ScVal.scvU32(n)))],
    ['signers', xdr.ScVal.scvMap(entries)],
  ]);
}
const build=async(a,auth)=>new TransactionBuilder(await server.getAccount(AGENT),{fee:'4000000',networkPassphrase:Networks.TESTNET})
  .addOperation(Operation.invokeHostFunction({func:swapFn(a),auth:auth??[]})).setTimeout(120).build();
const expiry=(await server.getLatestLedger()).sequence+200;

async function run(label,a,ids,sigs){
  const rec=await server.simulateTransaction(await build(a));
  if(rpc.Api.isSimulationError(rec)){console.log(`\n--- ${label}\n  RECORDING FAILED`);return;}
  const payload=sortedAuthPayload(sigs,ids);
  const attached=(rec.result?.auth??[]).map(e=>{
    const c=xdr.SorobanAuthorizationEntry.fromXDR(e.toXDR());
    const cr=c.credentials().address(); cr.signatureExpirationLedger(expiry); cr.signature(payload); return c;});
  const sim=await server.simulateTransaction(await build(a,attached));
  console.log(`\n--- ${label}  ids=[${ids}]`);
  if(rpc.Api.isSimulationError(sim)){
    const code=simulationErrorCode(sim.error);
    console.log('  refused:', code===null?'(no contract error code)':describeContractError(code));
    console.log('  ', sim.error.split('\n')[0].slice(0,180));
  } else console.log('  SUCCEEDED — __check_auth raised no refusal');
}
const owner={signer:externalSigner(VERIFIER,OWNER_KEY),signature:new Uint8Array(0)};
const agent={signer:externalSigner(VERIFIER,AGENT_KEY),signature:new Uint8Array(0)};
await run('UNDER cap 0.05 XLM, Default+XLM rule', 500000, [0,1], [owner,agent]);
await run('OVER  cap 5.00 XLM, Default+XLM rule', 50000000, [0,1], [owner,agent]);
