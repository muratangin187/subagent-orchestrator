import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.SIMULATOR_URL ?? "http://127.0.0.1:9898";
const out = new URL("../.local/qa/", import.meta.url);
mkdirSync(out, { recursive: true });
let cursor = -1;
async function logs() {
  const r = await fetch(base + "/api/console?since_id=" + Math.max(0, cursor));
  return (await r.json()).entries;
}
async function until(fragment) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const entries = await logs();
    const match = entries.find(
      (e) => e.id > cursor && e.message.includes(fragment),
    );
    if (match) {
      cursor = match.id;
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("No simulator evidence: " + fragment);
}
async function action(action) {
  const r = await fetch(base + "/api/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  assert.ok(r.ok);
  await new Promise((r) => setTimeout(r, 150));
}
async function screenshot(name) {
  const r = await fetch(base + "/api/screenshot/glasses");
  assert.ok(r.ok);
  writeFileSync(
    new URL(name + ".png", out),
    Buffer.from(await r.arrayBuffer()),
  );
}
await until("AGENT_G2_READY");
await until("QA_STATE");
await screenshot("home");
await action("down");
await action("down");
await action("click");
await until("G2_VIEW jobs");
await screenshot("jobs");
await action("click");
await until("G2_VIEW chat");
await screenshot("chat");
await action("up");
await screenshot("chat-previous");
await action("double_click");
await until("G2_VIEW jobs");
await action("double_click");
await until("G2_VIEW home");
await action("down");
await action("down");
await action("down");
await action("click");
await until("G2_VIEW sessions");
await screenshot("sessions");
await action("double_click");
await until("G2_VIEW home");
await action("double_click");
await screenshot("system-exit");
const entries = await (await fetch(base + "/api/console")).json();
assert.equal(
  entries.entries.filter((e) =>
    ["error", "unhandledrejection"].includes(e.level),
  ).length,
  0,
);
writeFileSync(new URL("console.json", out), JSON.stringify(entries, null, 2));
console.log(
  "PASS: home, jobs, chat paging, back stack, sessions, root exit; framebuffer artifacts saved.",
);
