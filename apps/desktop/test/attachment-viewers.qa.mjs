import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Minimal two-page PDF, generated locally without external assets or credentials.
function pdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> >>'];
 let out='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=out.length;
 out+=`xref\n0 5\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(out).toString('base64');
}
const files=[{id:'pdf',name:'inceleme.pdf',content:pdf()},{id:'badpdf',name:'bozuk.pdf',content:Buffer.from('not a pdf').toString('base64')},{id:'md',name:'inceleme.md',content:Buffer.from('# İnceleme\n\n| Durum | Sonuç |\n|---|---|\n| QA | Tamam |').toString('base64')},{id:'txt',name:'notlar.txt',content:Buffer.from('UzunMetin'.repeat(1000)).toString('base64')},{id:'image',name:'gorsel.png',content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII='}];
const server=createServer(async(req,res)=>{try{const name=req.url==='/'?'index.html':req.url.slice(1);res.setHeader('Content-Type',/\.m?js$/.test(name)?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile('apps/desktop/dist/'+name));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});await mkdir('/tmp/aw-viewer-qa',{recursive:true});
try {
 for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width:1000,height:760}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({files,theme})=>{
 localStorage.setItem('workspace.appearance',JSON.stringify({mode:theme,accent:'petrol'}));
 window.desktop={connection:async()=>({connected:true,origin:'viewer-fixture'}),onCommand:()=>()=>{},notify:async()=>{},copyText:async t=>{window.qaCopied=t;},saveAttachment:async()=>false,openAttachment:async()=>{},request:async(path,body)=>{
 if(body)throw Error('No mutations');
 if(path==='/v1/state')return {assistantId:'a',tasks:[],inputs:[],devices:[]};
 if(path.startsWith('/v1/messages'))return {messages:path.includes('after=')?[]:[{id:1,type:'message_queued',payload:{message:'Viewer QA',attachments:files.map(({id,name})=>({id,name}))}}],nextOffset:1};
 if(path.startsWith('/v1/attachments/'))return files.find(f=>path.endsWith('/'+f.id));
 return {};}};
 },{files,theme});
 await page.goto('http://127.0.0.1:'+server.address().port);
 for(const file of files){
 await page.getByRole('button',{name:file.name,exact:true}).click();const dialog=page.getByRole('dialog',{name:'Dosya önizleme'});await dialog.waitFor();
 if(file.id==='pdf'){await page.waitForFunction(()=>document.querySelector('canvas')?.width>0 && !document.body.textContent.includes('PDF yükleniyor'));await dialog.getByRole('button',{name:'Sonraki sayfa'}).click();await dialog.getByText('2 / 2',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Sonraki sayfa'}).isDisabled(),true);await dialog.getByText('PDF yükleniyor…',{exact:true}).waitFor({state:'hidden'});assert.equal(await dialog.getByRole('alert').count(),0);}
 if(file.id==='badpdf')await dialog.getByRole('alert').waitFor();
 if(file.id==='md'){await dialog.getByRole('button',{name:'Ham metin'}).click();await dialog.getByRole('button',{name:'Kopyala',exact:true}).click();assert.match(await page.evaluate(()=>window.qaCopied),/İnceleme/);await dialog.getByRole('button',{name:'Önizleme',exact:true}).click();}
 if(file.id==='image')await page.waitForFunction(()=>document.querySelector('.image-preview')?.complete && document.querySelector('.image-preview')?.naturalWidth>0);
 await page.screenshot({path:`/tmp/aw-viewer-qa/${theme}-${file.id}.png`});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 }
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS PDF paging, malformed PDF, Markdown source/copy, long text and image in both themes');
}finally{await browser.close();server.close();}
