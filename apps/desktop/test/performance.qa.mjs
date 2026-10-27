import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try {const path=req.url==='/'?'index.html':req.url.slice(1); const b=await readFile('apps/desktop/dist/'+path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await page.addInitScript(({count})=>{
   window.__polls=0;
   window.__extraEvents=[];
   const events=Array.from({length:count},(_,i)=>({id:i+1,runId:'run-'+i,type:'assistant_message',created:1700000000000+i,payload:{text:'### Sonuç '+i+'\n\nBu bir performans testidir. **Kontrol edildi.**\n\n- Birinci bulgu\n- İkinci bulgu\n\n| Alan | Sonuç |\n|---|---|\n| Test | Geçti |'}}));
   const snapshot={assistantId:'A',tasks:[{id:'A',title:'Asistan',status:'completed',provider:'codex',createdAt:1,updatedAt:2}],devices:[]};
   window.desktop={connection:async()=>({connected:true,origin:'performance-fixture'}),onCommand:()=>()=>{},notify:async()=>{},request:async(path,body)=>{
     if(body)throw Error('No mutations');
     if(path==='/v1/state')return snapshot;
     if(path.startsWith('/v1/messages')){
       window.__polls++;
       const after=Number(new URL(path,'http://qa').searchParams.get('after')||0);
       const batch=[...events,...window.__extraEvents].filter(e=>e.id>after).slice(0,200);
       if(!batch.length && window.__append){batch.push({id:count+1,runId:'new',type:'assistant_message',created:1700000999999,payload:{text:'Yeni sonuç güncellendi'}});window.__append=false;}
       return {messages:batch,nextOffset:batch.at(-1)?.id||after,olderCursor:null};
     }
     return {};
   }};
 },{count:Number(process.env.PERF_MESSAGES||800)});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const count=Number(process.env.PERF_MESSAGES||800);
 for(let loaded=200;loaded<count;loaded+=200){
   await page.getByText('Sonuç '+(loaded-1),{exact:true}).waitFor();
   await page.clock.fastForward(4100);
 }
 await page.getByText('Sonuç '+(count-1),{exact:true}).waitFor();
 await page.evaluate(()=>{window.__mutations=0;window.__observer=new MutationObserver(xs=>window.__mutations+=xs.length);window.__observer.observe(document.querySelector('.messages')||document.querySelector('main'),{subtree:true,childList:true,characterData:true});});
 const timings=[];
 for(let i=0;i<8;i++){
   const start=Date.now();await page.getByRole('textbox',{name:'Mesaj',exact:true}).fill('Taslak '+i);timings.push(Date.now()-start);
 }
 const metrics=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,polls:window.__polls,mutations:window.__mutations}));
 console.log(JSON.stringify({timings,...metrics}));
 assert.ok(timings.slice(2).every(ms=>ms<100),'Typing must remain responsive (<100ms) in an aged conversation');
 const before=await page.locator('article.message').count();
 for(let i=0;i<20;i++){
   const polls=await page.evaluate(()=>window.__polls);
   await page.clock.fastForward(4100);
   await page.waitForFunction(n=>window.__polls>n,polls);
 }
 assert.equal(await page.locator('article.message').count(),before);
 await page.evaluate(()=>window.__append=true);
 await page.clock.fastForward(4100);
 await page.getByText('Yeni sonuç güncellendi',{exact:true}).waitFor();
 assert.equal(await page.locator('article.message').count(),before+1);
 for(const [offset,type,text] of [[2,'assistant_delta','Canlı'],[3,'assistant_delta',' yanıt'],[4,'assistant_message','Canlı yanıt tamamlandı']]){
   await page.evaluate(({count,offset,type,text})=>window.__extraEvents.push({id:count+offset,runId:'stream',type,created:1700000999999+offset,payload:{itemId:'reply',id:'reply',text}}),{count,offset,type,text});
   await page.clock.fastForward(4100);
   await page.getByText(offset===2?'Canlı':offset===3?'Canlı yanıt':'Canlı yanıt tamamlandı',{exact:true}).waitFor();
 }
 assert.equal(await page.locator('article.message').count(),before+2);
 assert.deepEqual(errors,[]);

}finally{await browser.close();server.close();}
