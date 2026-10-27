import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const helper = (await readFile('apps/desktop/src/attachment-html.mjs','utf8')).replaceAll('export function','function');
  await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
  await page.addScriptTag({content:helper});
  const report = `<h1>Report</h1><div id="rows"></div><button onclick="document.querySelector('#rows').textContent='filtered'">Filter</button><a href="https://linear.app/test">Issue</a><script>document.querySelector('#rows').textContent='12 models';try{parent.document.body.dataset.leak='yes'}catch{};fetch('https://blocked.invalid/secret').catch(()=>{});</script>`;
  await page.evaluate(source => {window.links=[];addEventListener('message', e=>{const link=reportLink(e,document.querySelector('iframe').contentWindow);if(link)window.links.push(link)});document.querySelector('iframe').srcdoc=safeHtmlDocument(source)}, report);
  const frame = page.frameLocator('iframe');
  await frame.getByText('12 models').waitFor();
  await frame.getByRole('button',{name:'Filter'}).click();
  assert.equal(await frame.locator('#rows').textContent(),'filtered');
  assert.equal(await page.evaluate(()=>document.body.dataset.leak),undefined);
  await frame.getByRole('link',{name:'Issue'}).click();
  await page.waitForFunction(()=>window.links.length===1);
  assert.deepEqual(await page.evaluate(()=>window.links),['https://linear.app/test']);
  assert.equal(await frame.locator('h1').textContent(),'Report');
  if(process.env.REPORT_PATH){
    const source=await readFile(process.env.REPORT_PATH,'utf8');
    await page.evaluate(source=>{document.querySelector('iframe').srcdoc=safeHtmlDocument(source)},source);
    await frame.locator('tbody tr').first().waitFor();
    console.log('Real report rows:',await frame.locator('tbody tr').count());
  }
  console.log('PASS local data, filter, external-link request, opaque parent isolation.');
} finally {await browser.close()}
