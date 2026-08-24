import { rpc } from '@stellar/stellar-sdk';
import { describeContractError } from './dist/index.js';
const server=new rpc.Server('https://soroban-testnet.stellar.org');
const HASH='f50d843159121842d8084be0d0827b4021fef4a1455f3a15900c81d0a09fe995';
const res=await server.getTransaction(HASH);
console.log('status:',res.status);
const out=[];
const scan=v=>{ if(!v||typeof v.switch!=='function')return;
  const k=v.switch().name;
  if(k==='scvError'){const e=v.error(); if(e.switch().name==='sceContract') out.push(e.contractCode());}
  else if(k==='scvVec') for(const i of v.vec()??[]) scan(i);
  else if(k==='scvMap') for(const e of v.map()??[]){scan(e.key());scan(e.val());}};
for(const ev of res.diagnosticEventsXdr??[]){
  try{const b=ev.event().body().v0(); for(const t of b.topics()) scan(t); scan(b.data());}catch{}
}
const codes=[...new Set(out)];
console.log('contract error codes:',codes.length?codes.map(c=>describeContractError(c)).join(', '):'none');
// The diagnostic text, which names where it fired.
const text=(res.diagnosticEventsXdr??[]).map(e=>{try{return JSON.stringify(e.event().body().v0().data());}catch{return '';}}).join(' ');
for(const m of (text.match(/spending|limit|exceeded/gi)??[]).slice(0,3)) console.log('  mentions:',m);
