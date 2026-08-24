import { Address, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';

const RPC='https://soroban-testnet.stellar.org';
const ROUTER='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const XLM='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC='CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const SMART_ACCOUNT='CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM';
const AGENT='GASX3ZQJUE4SSAJFSAK2FZ55Q6XKXCYQF5HUAMF7ITUVDGNDL6VTH3EJ';

const server=new rpc.Server(RPC);

console.log('=== (d) addresses, verified live on testnet ===');
for(const [n,id] of [['router',ROUTER],['XLM (token the rule covers)',XLM],['USDC',USDC],['smart account',SMART_ACCOUNT]]){
  try{
    const e=await server.getLedgerEntries(xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
      contract:new Address(id).toScAddress(), key:xdr.ScVal.scvLedgerKeyContractInstance(),
      durability:xdr.ContractDataDurability.persistent()})));
    console.log(`  ${n.padEnd(30)} ${id}  ${e.entries.length>0?'EXISTS':'NOT FOUND'}`);
  }catch(err){console.log(`  ${n.padEnd(30)} ${id}  probe failed: ${err.message}`);}
}

const acct=await server.getAccount(AGENT);
const i128=v=>nativeToScVal(BigInt(v),{type:'i128'});
const deadline=Math.floor(Date.now()/1000)+3600;

function buildSwap(amountIn){
  return new TransactionBuilder(acct,{fee:'1000000',networkPassphrase:Networks.TESTNET})
    .addOperation(new Contract(ROUTER).call('swap_exact_tokens_for_tokens',
      i128(amountIn),
      i128(0),
      nativeToScVal([new Address(XLM),new Address(USDC)],{type:'address'}),
      new Address(SMART_ACCOUNT).toScVal(),
      nativeToScVal(deadline,{type:'u64'}),
    ))
    .setTimeout(60).build();
}

for(const [label,amount] of [['UNDER cap (0.05 XLM = 500000)',500000],['OVER cap (5 XLM = 50000000)',50000000]]){
  console.log(`\n=== simulate: ${label} ===`);
  const sim=await server.simulateTransaction(buildSwap(amount));
  if(rpc.Api.isSimulationError(sim)){
    console.log('  SIMULATION ERROR:', sim.error.slice(0,400));
    continue;
  }
  const auth=sim.result?.auth??[];
  console.log('  auth entries returned:', auth.length);
  auth.forEach((entry,i)=>{
    const c=entry.credentials();
    const kind=c.switch().name;
    const addr = kind==='sorobanCredentialsAddress' ? Address.fromScAddress(c.address().address()).toString() : '(source account)';
    console.log(`  [${i}] credentials=${kind} address=${addr}`);
    const walk=(inv,depth)=>{
      const f=inv.function();
      if(f.switch().name==='sorobanAuthorizedFunctionTypeContractFn'){
        const a=f.contractFn();
        console.log(`      ${'  '.repeat(depth)}- ${Address.fromScAddress(a.contractAddress()).toString()} :: ${a.functionName().toString()}`);
      } else {
        console.log(`      ${'  '.repeat(depth)}- (create contract)`);
      }
      inv.subInvocations().forEach(s=>walk(s,depth+1));
    };
    walk(entry.rootInvocation(),0);
  });
}
