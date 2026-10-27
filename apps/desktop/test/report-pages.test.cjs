const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createReportPages}=require('../electron/report-pages.cjs');
test('report pages enforce response isolation, exact capability URLs and release',async()=>{
 const pages=createReportPages();const url=pages.add('<script>test()</script>');
 const response=pages.response(url);
 assert.equal(response.status,200);
 assert.match(response.headers.get('Content-Security-Policy'),/sandbox allow-scripts;/);
 assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/allow-same-origin/);
 assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'none'/);
 assert.equal(await response.text(),'<script>test()</script>');
 assert.equal(pages.response(url+'?x').status,404);
 pages.remove(url);assert.equal(pages.response(url).status,404);
});
test('report page storage is bounded and rejects invalid inputs',()=>{
 const pages=createReportPages();assert.throws(()=>pages.add({}));assert.throws(()=>pages.add('x'.repeat(8*1024*1024+1)));
 const urls=Array.from({length:8},()=>pages.add('html'));assert.throws(()=>pages.add('overflow'));
 pages.remove(urls[0]);assert.ok(pages.add('replacement'));
});

test('renderer reload, crash and window destruction release reports without React cleanup',()=>{
 const {EventEmitter}=require('node:events');
 const {bindReportLifetime}=require('../electron/report-pages.cjs');
 const wc=new EventEmitter(); const pages=createReportPages();bindReportLifetime(wc,pages);
 const first=pages.add('keep');
 wc.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false});
 wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});
 assert.equal(pages.response(first).status,200);
 for(const [name,arg] of [['did-start-navigation',{isMainFrame:true,isSameDocument:false}],['render-process-gone',{}],['destroyed',{}]]){
   pages.clear(); const urls=Array.from({length:8},()=>pages.add('html'));
   wc.emit(name,arg);
   for(const url of urls)assert.equal(pages.response(url).status,404);
   assert.ok(pages.add('reopened'));
 }
});
