/**
 * C0 close-out, end to end: does the spending limit trap an over-cap Soroswap
 * swap once a venue rule sits beside the token rule?
 *
 * Deploys a fresh account whose signer keys this process holds, installs both
 * rules, runs a real under-cap swap, then forces an over-cap one onto a ledger
 * so its refusal carries a hash rather than being Limen's report of one.
 *
 * Routing is deliberately NOT done here. Choosing a path is the Route API's job
 * (POST /quote, which needs a registered key); the path is the direct XLM/USDC
 * pair because the claim under test is authorization, not price.
 */
import { Address, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { addContextRuleFunction, contextRuleIdFrom, deployAccountFunction, deployedContractAddress,
  invokeContract, signAs, submitAuthorized, transferFunction, describeContractError,
  readAllContextRules } from './dist/index.js';
import manifest from './src/wasm/manifest.json' with { type: 'json' };

const RPC='https://soroban-testnet.stellar.org', P=Networks.TESTNET;
const ROUTER='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const XLM='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC='CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const VERIFIER='CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const POLICY='CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE';
const CAP=10_000_000n, UNDER=3_000_000n, OVER=50_000_000n, SEED=300_000_000n;

const server=new rpc.Server(RPC);
const wrap=k=>({publicKey:k.publicKey(),rawPublicKey:()=>k.rawPublicKey(),
  sign:async d=>new Uint8Array(k.sign(Buffer.from(d))),signEnvelope:async t=>{t.sign(k);return t;},kp:k});
const ownerKp=Keypair.random(), agentKp=Keypair.random();
const owner=wrap(ownerKp), agent=wrap(agentKp);
const ok=(r,l)=>{if(!r.ok){console.log(`${l} FAILED: ${(r.error??'').split('\n')[0].slice(0,200)}`);process.exit(1);}return r;};
console.log('owner:',owner.publicKey,'\nagent:',agent.publicKey);
for(const pk of [owner.publicKey,agent.publicKey]) await fetch(`https://friendbot.stellar.org?addr=${pk}`);

const dep=ok(await submitAuthorized({rpcUrl:RPC,passphrase:P,feeSource:owner.publicKey,signEnvelope:owner.signEnvelope,
  label:'deploy',func:deployAccountFunction({accountWasmHash:manifest.contracts.account.wasmHash,
    deployer:owner.publicKey,owner:{kind:'external',verifier:VERIFIER,publicKey:owner.rawPublicKey()}})}),'deploy');
const SA=deployedContractAddress(dep.returnValue);
console.log('smart account:',SA,'\ndeploy tx:',dep.hash);
ok(await submitAuthorized({rpcUrl:RPC,passphrase:P,feeSource:owner.publicKey,signEnvelope:owner.signEnvelope,
  label:'seed',func:transferFunction({token:XLM,from:owner.publicKey,to:SA,amount:SEED})}),'seed');

const ctx={smartAccount:SA,verifier:VERIFIER,spendingLimitPolicy:POLICY,
  agentPublicKey:agent.rawPublicKey(),ownerPublicKey:owner.rawPublicKey()};
const install=async(rule,l)=>contextRuleIdFrom(ok(await submitAuthorized({rpcUrl:RPC,passphrase:P,
  feeSource:owner.publicKey,signEnvelope:owner.signEnvelope,label:l,func:addContextRuleFunction(rule,ctx),
  signAuthEntry:signAs({signer:owner,verifier:VERIFIER,contextRuleIds:[0],
    expirationLedger:(await server.getLatestLedger()).sequence+200,passphrase:P})}),l).returnValue);
const TOK=await install({contract:XLM,name:'limen-tok',validUntilLedger:null,
  policies:[{kind:'spending_limit',asset:XLM,limit:CAP.toString(),windowLedgers:17280}]},'token rule');
const VEN=await install({contract:ROUTER,name:'limen-venue',validUntilLedger:null,policies:[]},'venue rule');
console.log(`rules: token=${TOK} cap=${CAP}  venue=${VEN} policies=0`);
for(const r of await readAllContextRules({rpcUrl:RPC,simulationSource:owner.publicKey},SA))
  console.log(`  rule ${r.id} ${r.contextType} ${r.contract??''} policies=${r.policies.length}`);

const dl=Math.floor(Date.now()/1000)+3600;
const swapFn=a=>invokeContract(ROUTER,'swap_exact_tokens_for_tokens',[
  nativeToScVal(a,{type:'i128'}),nativeToScVal(0n,{type:'i128'}),
  nativeToScVal([new Address(XLM),new Address(USDC)],{type:'address'}),
  new Address(SA).toScVal(),nativeToScVal(dl,{type:'u64'})]);
const exp=(await server.getLatestLedger()).sequence+200;
const sign=signAs({signer:agent,verifier:VERIFIER,contextRuleIds:[VEN,TOK],expirationLedger:exp,passphrase:P});

console.log(`\n=== UNDER cap: ${UNDER} vs cap ${CAP} ===`);
const under=await submitAuthorized({rpcUrl:RPC,passphrase:P,feeSource:agent.publicKey,
  signEnvelope:agent.signEnvelope,label:'under',func:swapFn(UNDER),signAuthEntry:sign});
console.log(under.ok?`  SUCCEEDED  hash: ${under.hash}`:`  refused: ${(under.error??'').split('\n')[0].slice(0,160)}`);

console.log(`\n=== OVER cap: ${OVER} vs cap ${CAP} — forced onto a ledger ===`);
const build=async(fn,auth,data)=>{const b=new TransactionBuilder(await server.getAccount(agent.publicKey),
  {fee:'9000000',networkPassphrase:P}).addOperation(Operation.invokeHostFunction({func:fn,auth:auth??[]})).setTimeout(180);
  if(data)b.setSorobanData(data); return b.build();};
const rec=await server.simulateTransaction(await build(swapFn(UNDER)));
if(rpc.Api.isSimulationError(rec)){console.log('baseline recording failed:',rec.error.slice(0,200));process.exit(1);}
const enf=await server.simulateTransaction(await build(swapFn(UNDER),
  [await sign(xdr.SorobanAuthorizationEntry.fromXDR(rec.result.auth[0].toXDR()))]));
if(rpc.Api.isSimulationError(enf)){console.log('baseline enforcing failed:',enf.error.slice(0,200));process.exit(1);}
const over=xdr.SorobanAuthorizationEntry.fromXDR(rec.result.auth[0].toXDR());
over.rootInvocation().function().contractFn().args()[0]=nativeToScVal(OVER,{type:'i128'});
over.rootInvocation().subInvocations()[0].function().contractFn().args()[2]=nativeToScVal(OVER,{type:'i128'});
const tx=await build(swapFn(OVER),[await sign(over)],enf.transactionData.build());
tx.sign(agentKp);
const sent=await server.sendTransaction(tx);
let res; for(let i=0;i<40;i++){res=await server.getTransaction(sent.hash);
  if(res.status!=='NOT_FOUND')break; await new Promise(s=>setTimeout(s,1500));}
const found=[]; const walk=v=>{if(v==null||typeof v!=='object')return;
  if(v._switch?.name==='scErrorTypeContract'&&typeof v._value==='number')found.push(v._value);
  for(const q of Object.values(v)) walk(q);};
try{walk(res.resultMetaXdr??res);}catch{}
console.log('  hash        :',sent.hash);
console.log('  status      :',res.status);
console.log('  contract err:',[...new Set(found)].map(describeContractError).join(', ')||'none decoded');
console.log('  explorer    : https://stellar.expert/explorer/testnet/tx/'+sent.hash);
console.log('\nSA='+SA+' TOKEN_RULE='+TOK+' VENUE_RULE='+VEN);
