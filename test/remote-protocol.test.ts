import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteDriver } from "../src/devices/remote.js";
import { deviceQuery } from "../src/devices/query.js";
test("SSH protocol flush, provider error, lost result and malformed response", async () => {
  const home = mkdtempSync(join(tmpdir(), "ssh-protocol-")),
    old = process.env.PATH;
  const device = {
    id: "worker",
    name: "Test",
    cwd: home,
    sshHost: "fake",
    command: ["node", "worker"],
  };
  process.env.PATH = home + ":" + old;
  const fake = (source: string) =>
    writeFileSync(join(home, "ssh"), "#!" + process.execPath + "\n" + source, {
      mode: 0o700,
    });
  const context: any = {
    task: {},
    run: {},
    event: () => {},
    session: () => {},
    question: async () => ({}),
  };
  try {
    fake(
      `process.stdin.once('data',()=>process.stdout.write(JSON.stringify({type:'result',result:'flushed'})+'\\n',()=>process.exit(0)));`,
    );
    const ok = new RemoteDriver(device, "coordinator", home);
    assert.equal(await ok.run(context), "flushed");
    await ok.close();
    assert.equal(await deviceQuery(device, { op: "health" }), "flushed");
    fake(
      `process.stdin.once('data',()=>process.stdout.write(JSON.stringify({type:'error',error:'provider denied'})+'\\n',()=>process.exit(0)));`,
    );
    const denied = new RemoteDriver(device, "coordinator", home);
    await assert.rejects(denied.run(context), /provider denied/);
    await denied.close();
    fake(`process.stdin.once('data',()=>process.exit(0));`);
    const lost = new RemoteDriver(device, "coordinator", home);
    await assert.rejects(lost.run(context), /REMOTE_UNCERTAIN/);
    await lost.close();
    fake(
      `process.stdin.once('data',()=>process.stdout.write('not-json\\n',()=>process.exit(0)));`,
    );
    const malformed = new RemoteDriver(device, "coordinator", home);
    await assert.rejects(malformed.run(context), /REMOTE_UNCERTAIN/);
    await malformed.close();
    await assert.rejects(
      deviceQuery(device, { op: "health" }),
      /Invalid device response/,
    );
  } finally {
    process.env.PATH = old;
    rmSync(home, { recursive: true, force: true });
  }
});
