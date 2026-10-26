import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pages,
  sorted,
  normalizedOrigin,
  PcmCapture,
  Client,
  truncate,
  type Task,
} from "../src/core.ts";
test("pages preserve unicode, bound lines, and strip code and Markdown", () => {
  const text = "Türkçe şğİ 🧑 ".repeat(200) + "x".repeat(300);
  const p = pages(text);
  assert.ok(p.length > 3);
  for (const page of p) {
    assert.ok(page.split("\n").length <= 6);
    for (const l of page.split("\n")) assert.ok(Array.from(l).length <= 42);
  }
  assert.equal(
    pages("```js\nsecret code\n```")[0],
    "[Kod ayrıntısı telefonda]",
  );
  assert.equal(truncate("😀".repeat(8), 4), "😀😀😀…");
});
test("active first, then latest activity without mutating source", () => {
  const a = [
    { id: "a", status: "completed", updatedAt: 9 },
    { id: "b", status: "running", updatedAt: 2 },
    { id: "c", status: "waiting_question", updatedAt: 4 },
  ] as Task[];
  assert.deepEqual(
    sorted(a).map((t) => t.id),
    ["c", "b", "a"],
  );
  assert.equal(a[0].id, "a");
});
test("reject insecure, credential-bearing, path and query endpoints", () => {
  for (const u of [
    "http://example.com",
    "https://x.test/path",
    "https://user:pass@x.test",
    "https://x.test/?token=x",
    "javascript:alert(1)",
  ])
    assert.throws(() => normalizedOrigin(u));
  assert.equal(
    normalizedOrigin("https://a.ts.net:9443/"),
    "https://a.ts.net:9443",
  );
  assert.equal(
    normalizedOrigin("http://127.0.0.1:8787"),
    "http://127.0.0.1:8787",
  );
});
test("PCM capture bounded to 30 seconds, copied, exact bytes, too-short rejected", () => {
  assert.throws(() => new PcmCapture().finish());
  const p = new PcmCapture();
  const chunk = new Uint8Array(3200).fill(2);
  p.append(chunk);
  chunk.fill(9);
  assert.equal(Buffer.from(p.finish(), "base64")[0], 2);
  assert.equal(p.append(new Uint8Array(960000)), true);
  assert.equal(Buffer.from(p.finish(), "base64").length, 960000);
  assert.throws(() => p.append(new Uint8Array(1)));
});
test("client does not automatically replay uncertain POST and never sends cookies", async () => {
  let calls = 0;
  const http = async (_: any, init: any) => {
    calls++;
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    throw Error("network lost");
  };
  const c = new Client(
    "https://local.test",
    "fixture-token",
    http as typeof fetch,
  );
  await assert.rejects(c.send("assistant", "hello", "stable-id"));
  assert.equal(calls, 1);
});

test("default browser fetch retains its global receiver", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function () {
    assert.equal(this, globalThis);
    return Response.json({ tasks: [], inputs: [] });
  };
  try {
    await new Client("https://example.test", "fixture").state();
  } finally {
    globalThis.fetch = original;
  }
});
