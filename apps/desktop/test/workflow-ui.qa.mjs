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
 const t=(id,parentTaskId)=>({id,parentTaskId,title:'QA '+id,status:'running',provider:'codex',deviceId:'qa',createdAt:1,updatedAt:1});
 const snapshot={assistantId:'A',tasks:[t('A'),t('one','A'),t('two','A'),t('three','A'),t('nested','two'),t('foreign','B')],devices:[],localDeviceId:'qa',defaultDeviceId:'qa'};
 window.desktop={connection:async()=>({connected:true,origin:'qa-fixture'}),onCommand:()=>()=>{},notify:async()=>{},request:async(path,body)=>{if(body)throw Error('QA fixture prohibits mutations');if(path==='/v1/state')return snapshot;if(path.startsWith('/v1/messages'))return {messages:[],nextOffset:0};return {};}};
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 const inspector=page.locator('aside.inspector');
 await inspector.getByText('3 doğrudan · 4 toplam · 4 aktif (toplam)').waitFor();
 assert.equal(await inspector.locator('.session-choice').count(),3);
 const toggle=inspector.getByLabel('Alt işleri de göster');await toggle.check();
 assert.equal(await inspector.locator('.session-choice').count(),4);
 assert.deepEqual(await inspector.locator('.task-row strong').allTextContents(),['QA one','QA two','QA nested','QA three']);
 await page.screenshot({path:'/tmp/workflow-fixture-expanded.png'});
 await page.reload();await inspector.getByText('3 doğrudan · 4 toplam · 4 aktif (toplam)').waitFor();assert.equal(await toggle.isChecked(),true);
 await inspector.locator('.task-row').filter({hasText:'QA two'}).click();
 await inspector.getByText('1 doğrudan · 1 toplam · 1 aktif (toplam)').waitFor();assert.equal(await toggle.isChecked(),false);
 await page.goBack();await inspector.getByText('3 doğrudan · 4 toplam · 4 aktif (toplam)').waitFor();assert.equal(await toggle.isChecked(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS full desktop renderer fixture: default 3; expanded 4 hierarchical; unrelated excluded; reload persistence; conversation scope; navigation back. No production requests.');
}finally{await browser.close();server.close();}
