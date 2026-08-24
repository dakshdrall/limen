import { chromium } from '@playwright/test';
const out='/tmp/claude-1000/-workspaces-limen/d7d074d8-a79a-4fcd-9982-4a3b2c9866f9/scratchpad';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1280,height:900}});
for(const [route,name] of [['/','site-landing'],['/docs','site-docs'],['/app/agents/new','app-new-agent'],['/app/agents','app-agents']]){
  await p.goto('http://localhost:3000'+route,{waitUntil:'networkidle'});
  const bg=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  const fg=await p.evaluate(()=>getComputedStyle(document.body).color);
  const hdr=await p.evaluate(()=>{const h=document.querySelector('header');return h?getComputedStyle(h).backgroundColor:'none';});
  console.log(route.padEnd(18),'body bg',bg.padEnd(22),'fg',fg.padEnd(20),'header',hdr);
  await p.screenshot({path:`${out}/${name}.png`,fullPage:false});
}
await b.close();
