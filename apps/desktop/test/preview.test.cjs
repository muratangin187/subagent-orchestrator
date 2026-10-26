const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const vm = require("node:vm");

test("HTML keeps layout while removing active content and navigation", async () => {
  const dom = new JSDOM("");
  global.window = dom.window;
  const { safeHtmlDocument } = await import("../src/attachment-html.mjs");
  const output = safeHtmlDocument(
    `<style>h1{color:green}</style><h1>Rapor</h1><script>alert(1)</script><iframe srcdoc="x"></iframe><meta http-equiv="refresh" content="0;url=https://bad.test"><base href="https://bad.test"><a href="https://bad.test">link</a><img src="x" onerror="alert(1)"><form action="https://bad.test"><input></form>`,
  );
  const document = new JSDOM(output).window.document;
  assert.equal(document.querySelector("h1").textContent, "Rapor");
  assert.equal(document.querySelector("style").textContent, "h1{color:green}");
  assert.equal(
    document.querySelectorAll("script,iframe,base,form,input,[href],[onerror]")
      .length,
    0,
  );
  const policies = document.querySelectorAll("meta[http-equiv]");
  assert.equal(policies.length, 1);
  assert.match(policies[0].content, /default-src 'none'/);
  assert.match(policies[0].content, /form-action 'none'/);
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
