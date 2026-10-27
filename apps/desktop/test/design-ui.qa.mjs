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
 await page.addInitScript(()=>{
 const task=(id,parentTaskId,title,status='completed')=>({id,parentTaskId,title,status,provider:'codex',model:'gpt-6.1-sol',deviceId:'qa',createdAt:Date.now()-600000,updatedAt:Date.now()-60000});
 const snapshot={assistantId:'A',tasks:[task('A',null,'Asistan'),task('research','A','Kaynakları karşılaştır ve raporu güncelle','running'),{...task('review','A','Mobil uygulama incelemesi'),resultDelivery:{state:'response_failed'}},task('done','A','Masaüstü performans kontrolü')],queuedMessages:[{id:'q',taskId:'A',text:'Raporu paylaşmadan önce mobil kontrolleri de tamamla.'}],devices:[],localDeviceId:'qa'};
 const messages=[{id:1,type:'message_queued',created:1700000000000,payload:{message:'Bugünkü işleri toparlayıp kalan noktaları gösterir misin?'}},{id:2,type:'assistant_message',created:1700000001000,payload:{text:'## Çalışma özeti\n\nMasaüstü düzenlemesi hazır. Mobilde iki akışın kontrolü sürüyor.\n\n- **Tamamlandı:** Sohbet görünümü ve klavye kullanımı.\n- **Devam ediyor:** Dosya ekleme ve sonuçların açılması.\n\n### Sıradaki adım\n\nKontroller bitince sonuçları tek raporda birleştireceğim.'}}];
 window.desktop={connection:async()=>({connected:true,origin:'design-fixture'}),onCommand:()=>()=>{},notify:async()=>{},request:async(path,body)=>{if(body)throw Error('Fixture prohibits mutations');if(path==='/v1/state')return snapshot;if(path.startsWith('/v1/messages'))return {messages:path.includes('after=')?[]:messages,nextOffset:2,olderCursor:null};if(path.startsWith('/v1/models'))return {models:[{provider:'codex',model:'gpt-6.1-sol',label:'Sol 6.1',efforts:['low','medium','high']}]};return {};}};
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByText('Çalışma özeti',{exact:true}).waitFor();
 for(const [width,theme] of [[1440,'light'],[1440,'dark'],[850,'light']]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.screenshot({path:`/tmp/aw-design-${width}-${theme}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
  assert.equal(await page.getByRole('button',{name:'Sonucu aç',exact:true}).count(),0);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Kaynakları karşılaştır ve raporu güncelle — sağda aç'}).click();
 await page.locator('[data-pane="right"] textarea').waitFor();
 await page.locator('[data-pane="right"] textarea').fill('Yalnızca bu işin taslağı');
 assert.equal(await page.locator('[data-pane="left"] textarea').inputValue(),'');
 await page.screenshot({path:'/tmp/aw-design-split.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS light/dark/narrow/split conversation layouts; independent drafts; no production mutations');
}finally{await browser.close();server.close();}
