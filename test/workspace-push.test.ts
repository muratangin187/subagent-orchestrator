import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { WorkspaceController } from "../src/workspace/controller.js";
import { PushDispatcher, pushEnvelope } from "../src/workspace/push.js";

test("FCM payload contains only fixed copy and opaque event ID", () => {
  const p = pushEnvelope("device-token", "42");
  assert.deepEqual(p.message.data, { eventId: "42" });
  assert.deepEqual(Object.keys(p.message), [
    "token",
    "notification",
    "data",
    "android",
  ]);
  assert.equal(p.message.android.notification.tag, "workspace-update");
});

test("push retries durable notification without disclosing task data and skips history on pairing", async () => {
  const home = mkdtempSync(join(tmpdir(), "push-test-"));
  const store = new Store(join(home, "state.sqlite"));
  const engine = new Engine(
    store,
    () => {
      throw Error("No provider should run");
    },
    4,
    3,
    60000,
    home,
  );
  const c = new WorkspaceController(engine, store, home, "read-only");
  const record = (id: string) =>
    store.db.prepare("INSERT INTO notifications(owner,data) VALUES(?,?)").run(
      c.scope.id,
      JSON.stringify({
        taskId: id,
        status: "completed",
        summary: "PRIVATE RESULT",
      }),
    );
  record("historic");
  // Fixture only task identity is relevant to dispatch; no provider calls.
  c.snapshot = () =>
    ({ tasks: [{ id: "root", parentTaskId: undefined }] }) as any;
  const calls: unknown[] = [];
  let fail = true;
  const p = new PushDispatcher(c, async (...args) => {
    calls.push(args);
    if (fail) throw Error("network");
  });
  try {
    p.register("token");
    assert.equal(c.get("push:cursor"), "1");
    record("root");
    await p.tick();
    assert.equal(c.get("push:cursor"), "1");
    assert.equal(c.get("push:status"), "retrying");
    fail = false;
    p.register("rotated-token");
    await p.tick();
    assert.deepEqual(calls, [
      ["token", "2"],
      ["rotated-token", "2"],
    ]);
    assert.equal(c.get("push:cursor"), "2");
    await p.tick();
    assert.equal(calls.length, 2);
    assert(!JSON.stringify(calls).includes("PRIVATE"));
  } finally {
    await p.stop();
    await c.stop();
    await engine.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
