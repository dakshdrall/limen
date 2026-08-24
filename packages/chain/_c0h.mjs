import { Address, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { externalSigner, invokeContract, structMap, simulationErrorCode, describeContractError } from './dist/index.js';
const RPC='https://soroban-testnet.stellar.org';
const XLM='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const SA='CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM';
const AGENT='GASX3ZQJUE4SSAJFSAK2FZ55Q6XKXCYQF5HUAMF7ITUVDGNDL6VTH3EJ';
const OWNER='GCLDQBMWF4YARB5USS6SROQIZOK3YH2KX5NMQMWUFYT7TNG2NDE6GQST';
const V='CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const A=new Uint8Array(Buffer.from('257de609a1392901259015a2e7bd87aeab8b102f4f4030bf44e95199a35fab33','hex'));
const O=new Uint8Array(Buffer.from('963805962f300887b494bd28ba08cb95bc1f4abf5ac832d42e27f9b4da68c9e3','hex'));
const server=new rpc.Server(RPC);
const i128=v=>nativeToScVal(BigInt(v),{type:'i128'});
// CONTROL: a plain transfer, the exact call the spending limit is built to bound.
const fn=a=>invokeContract(XLM,'transfer',[new Address(SA).toScVal(),new Address(OWNER).toScVal(),i128(a)]);
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
  if(rpc.Api.isSimulationError(rec)){console.log(`\n--- ${label}\n  RECORDING FAILED: ${rec.error.split('\n')[0].slice(0,140)}`);return;}
  const attached=(rec.result?.auth??[]).map(e=>{const c=xdr.SorobanAuthorizationEntry.fromXDR(e.toXDR());
    const cr=c.credentials().address();cr.signatureExpirationLedger(exp);cr.signature(pay(sigs,ids));return c;});
  const sim=await server.simulateTransaction(await build(a,attached));
  const err=sim.error??''; const code=simulationErrorCode(err);
  const reachedVerify=/fn_call, CA3ZVES4|contract call failed", verify/.test(err);
  console.log(`\n--- ${label}  ids=[${ids}]`);
  console.log('  contract code :', code===null?'none':describeContractError(code));
  console.log('  reached verify:', reachedVerify?'YES (policies passed; only the signature is missing)':'NO — refused before the signature');
}
const owner={signer:externalSigner(V,O),signature:new Uint8Array(0)};
const agent={signer:externalSigner(V,A),signature:new Uint8Array(0)};
console.log('CONTROL — a bare token.transfer, which the spending limit exists to bound.');
console.log('cap = 1000000 (0.1 XLM)');
await run('transfer UNDER cap 0.05 XLM, rule 1', 500000,   [1], [agent]);
await run('transfer OVER  cap 5.00 XLM, rule 1', 50000000, [1], [agent]);
await run('transfer OVER  cap 5.00 XLM, Default rule 0', 50000000, [0], [owner]);
