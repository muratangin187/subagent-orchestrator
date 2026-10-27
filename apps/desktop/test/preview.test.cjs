const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const vm = require("node:vm");

test("HTML retains local report data and controls but blocks embedded documents and network", async () => {
  global.DOMParser = new JSDOM("").window.DOMParser;
  const { safeHtmlDocument, reportLink } = await import("../src/attachment-html.mjs");
  const output = safeHtmlDocument(`<h1>Rapor</h1><script>document.body.dataset.ready='yes'</script><button onclick="this.textContent='ok'">Filter</button><script src="https://bad.test/x.js"></script><iframe srcdoc="x"></iframe><meta http-equiv="refresh" content="0;url=https://bad.test"><base href="https://bad.test"><a href="https://linear.app/test">link</a>`);
  const document = new JSDOM(output).window.document;
  assert.equal(document.querySelector('button').textContent, 'Filter');
  assert.match(document.documentElement.textContent, /dataset.ready/);
  assert.equal(document.querySelectorAll('iframe,base,script[src]').length, 0);
  assert.equal(document.querySelectorAll('meta[http-equiv]').length, 1);
  assert.match(document.querySelector('meta[http-equiv]').content, /connect-src 'none'/);
  const frame = {};
  assert.equal(reportLink({source:frame,data:{type:'report-link',url:'https://linear.app/test'}},frame), 'https://linear.app/test');
  for (const url of ['javascript:alert(1)','file:///etc/passwd','https://user:pass@site.test']) assert.equal(reportLink({source:frame,data:{type:'report-link',url}},frame),null);
  assert.equal(reportLink({source:{},data:{type:'report-link',url:'https://site.test'}},frame),null);
});

test("audio worklet clamps PCM and never echoes microphone to speakers", () => {
  let Capture;
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../src/capture.js"), "utf8"),
    {
      AudioWorkletProcessor: class {
        port = {
          postMessage: (buffer) => {
            this.result = new Int16Array(buffer);
          },
        };
      },
      registerProcessor: (_, type) => {
        Capture = type;
      },
      Int16Array,
      Math,
    },
  );
  const processor = new Capture();
  const output = new Float32Array(5).fill(1);
  assert.equal(
    processor.process([[new Float32Array([-2, -1, 0, 1, 2])]], [[output]]),
    true,
  );
  assert.deepEqual([...processor.result], [-32767, -32767, 0, 32767, 32767]);
  assert.deepEqual([...output], [0, 0, 0, 0, 0]);
});
