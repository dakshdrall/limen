import { chromium } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';
const out='/tmp/claude-1000/-workspaces-limen/d7d074d8-a79a-4fcd-9982-4a3b2c9866f9/scratchpad';
const base='http://localhost:3000';

// Sign in for real, the way the wallet route does, and reuse the cookie.
const kp=Keypair.random();
const cr=await fetch(base+'/api/auth/challenge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'wallet'})});
const {challenge}=await cr.json();
const r=await fetch(base+'/api/auth/wallet',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({address:kp.publicKey(),challenge,signedMessage:kp.signMessage(challenge).toString('base64')})});
if(!r.ok) throw new Error('sign-in failed '+r.status);
const cookie=r.headers.get('set-cookie').split(';')[0];
console.log('signed in as', kp.publicKey().slice(0,8)+'…');

const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900}});
const [name,value]=cookie.split('=');
await ctx.addCookies([{name,value,domain:'localhost',path:'/'}]);
const p=await ctx.newPage();
p.on('console',m=>{if(m.type()==='error')console.log('  [console error]',m.text().slice(0,160));});

await p.goto(base+'/app/agents/new',{waitUntil:'networkidle'});
await p.screenshot({path:`${out}/step-1-strategy.png`});
console.log('step 1 url:', p.url());
console.log('  textarea present:', await p.locator('#agent-strategy').count());
console.log('  placeholder:', await p.locator('#agent-strategy').getAttribute('placeholder'));

await p.fill('#agent-strategy','buy XLM whenever the price drops 5%, spend at most 20 USDC a day');
await p.click('button:has-text("Draft the limits")');
await p.waitForURL(/\/review$/,{timeout:60000});
await p.waitForLoadState('networkidle');
const agentId=p.url().match(/agents\/([^/]+)\/review/)[1];
console.log('step 2 url:', p.url());
await p.screenshot({path:`${out}/step-2-review.png`});

// Back navigation, then forward again — does the DRAFT survive?
await p.goBack({waitUntil:'networkidle'});
console.log('after back:', p.url());
await p.goto(`${base}/app/agents/${agentId}/review`,{waitUntil:'networkidle'});
const capAfter=await p.locator('input#cap').inputValue().catch(()=>'(no #cap input)');
console.log('DRAFT survived reload — cap field reads:', JSON.stringify(capAfter));
console.log('  "nothing was drafted" banner present:', await p.locator('text=nothing was drafted').count());

await p.goto(`${base}/app/agents/${agentId}`,{waitUntil:'networkidle'});
console.log('detail url:', p.url(), '| status shown:', await p.locator('main').innerText().then(t=>/DRAFT|CONFIGURED|ACTIVE/.exec(t)?.[0]));
await p.screenshot({path:`${out}/step-4-detail.png`});
await b.close();
