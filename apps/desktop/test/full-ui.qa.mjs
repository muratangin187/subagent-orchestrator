// Exercise the packaged renderer with synthetic data; never touches a real coordinator.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const stage=process.argv[2] || 'after';
const output=`/tmp/aw-full-ui-${stage}`; await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try {const path=req.url==='/'?'index.html':req.url.slice(1);const b=await readFile('apps/desktop/dist/'+path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true}); const results=[];
try {
 for(const theme of ['light','dark']) {
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=await readFile('apps/desktop/test/design-ui.qa.mjs','utf8');
 const init=fixture.slice(fixture.indexOf(' const task='),fixture.indexOf('\n });'));
 await page.addInitScript({content:`(()=>{${init}\nwindow.desktop.copyText=async()=>{};window.desktop.onCommand=cb=>{window.qaCommand=cb;return ()=>{};};localStorage.setItem('workspace.appearance',JSON.stringify({mode:'${theme}',accent:'sage'}));})();`});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Çalışma özeti',{exact:true}).waitFor();
 async function shot(name){await page.screenshot({path:`${output}/${theme}-${name}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow`);results.push(`${theme}/${name}`);}
 async function close(){await page.keyboard.press('Escape');}
 await shot('conversation');
 await page.getByRole('button',{name:'Sohbetler',exact:true}).click();await shot('sessions');
 await page.getByPlaceholder(/oturumlarında ara|Oturumlarda ara/).fill('bulunmayan');await shot('sessions-empty-search');await close();
 await page.getByRole('button',{name:'İşler',exact:true}).first().click();await shot('jobs');
 if(stage==='after'){await page.getByRole('textbox',{name:'İş ara',exact:true}).fill('bulunmayan');await page.getByText('Aramana uygun iş bulunamadı.').waitFor();await shot('jobs-empty-search');}
 await close();
 await page.getByRole('button',{name:'Yeni oturum',exact:true}).click();await shot('new-session');await close();
 await page.getByRole('button',{name:'Ayarlar',exact:true}).first().click();await shot('settings');await close();
 await page.getByRole('button',{name:'Model ve düşünme seviyesi'}).click();await shot('model');
 await page.getByPlaceholder('Model ara…').fill('bulunmayan');await shot('model-empty-search');
 if(stage==='after'){await page.getByText('Bu aramada model bulunamadı.').waitFor();await close();assert.equal(await page.getByRole('dialog',{name:'Model seç',exact:true}).count(),0);}else{await page.getByRole('button',{name:'Kapat',exact:true}).click();}
 await page.getByRole('button',{name:'Sesli asistan',exact:true}).click();await shot('voice-idle');await page.getByRole('button',{name:'Sesli asistanı kapat'}).click();
 await page.getByRole('button',{name:'Sağlayıcıların kalan kotası'}).click();await shot('quota-unknown');await close();
 await page.getByRole('button',{name:'Kaynakları karşılaştır ve raporu güncelle — sağda aç'}).click();await shot('split');
 await page.getByRole('button',{name:'Sağ sohbeti kapat'}).click();
 await page.setViewportSize({width:850,height:650});await shot('compact');
 await page.getByRole('button',{name:'Ayarlar',exact:true}).first().click();await shot('compact-settings');await close();
 assert.deepEqual(errors,[]);await page.close();
 }
 if(stage==='after') for(const state of ['disconnected','empty','loading','offline','question','attachment']) {
 const page=await browser.newPage({viewport:{width:1100,height:760}});
 const fixture=await readFile('apps/desktop/test/design-ui.qa.mjs','utf8');
 const init=fixture.slice(fixture.indexOf(' const task='),fixture.indexOf('\n });'));
 await page.addInitScript({content:`(()=>{${init}
 const mode='${state}'; const original=window.desktop.request;
 if(mode==='disconnected')window.desktop.connection=async()=>({connected:false});
 if(mode==='empty')snapshot.tasks=[];
 if(mode==='question')snapshot.tasks[0].question={id:'q',prompt:{questions:[{id:'answer',question:'Hangi sonucu önce inceleyelim?',options:[{label:'Masaüstü'},{label:'Mobil'}]}]}};
 if(mode==='attachment')messages[0].payload.attachments=[{id:'qa-md',name:'inceleme.md'}];
 window.desktop.request=async(path,body)=>{
 if(path.startsWith('/v1/messages')&&mode==='loading')return new Promise(()=>{});
 if(path.startsWith('/v1/messages')&&mode==='offline')throw Error('Test bağlantı hatası');
 if(path.startsWith('/v1/messages')&&mode==='empty')return {messages:[],nextOffset:0};
 if(path.startsWith('/v1/attachments/'))return {id:'qa-md',name:'inceleme.md',content:btoa('# Review\\n\\nA small test document.')};
 return original(path,body);};
 window.desktop.copyText=async()=>{};
 })();`});
 await page.goto('http://127.0.0.1:'+server.address().port);
 if(state==='disconnected')await page.getByText('Çalışma alanına bağlan',{exact:true}).waitFor();
 else if(state==='empty')await page.locator('.chat-empty').waitFor();
 else if(state==='loading')await page.locator('.conversation').waitFor();
 else if(state==='offline')await page.getByRole('alert').first().waitFor();
 else if(state==='question')await page.getByText('Hangi sonucu önce inceleyelim?').waitFor();
 else {await page.getByRole('button',{name:'inceleme.md',exact:true}).click();await page.getByRole('button',{name:'Ham metin',exact:true}).click();}
 await page.screenshot({path:`${output}/state-${state}.png`});results.push(state);await page.close();
 }
 await writeFile(output+'/coverage.json',JSON.stringify(results,null,2));console.log('PASS '+results.length+' screen/theme states: '+output);
} finally {await browser.close();server.close();}
