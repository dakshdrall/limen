import { readAllContextRules, readSpendingLimit } from './dist/index.js';
const RPC='https://soroban-testnet.stellar.org';
const SA='CBFLENP2CYSUAM5G45B52DQC6HX7VEIQYTKEIROXL4ETD36KZEBXLMYM';
const OWNER='GCLDQBMWF4YARB5USS6SROQIZOK3YH2KX5NMQMWUFYT7TNG2NDE6GQST';
const rules=await readAllContextRules({rpcUrl:RPC,simulationSource:OWNER},SA);
console.log('installed context rules on', SA);
for(const r of rules){
  console.log(JSON.stringify({id:r.id,contextType:r.contextType,contract:r.contract,name:r.name,validUntil:r.validUntilLedger,signers:r.signers,policies:r.policies},null,1));
}
