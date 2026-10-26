import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Devices, sshArgs } from "../src/devices/registry.js";
import { Engine } from "../src/engine.js";
import { Store } from "../src/store.js";
test("device routing inherits the parent and explicit cross-device selection uses its own cwd", async () => {
  const home = mkdtempSync(join(tmpdir(), "devices-"));
  writeFileSync(
    join(home, "devices.json"),
    JSON.stringify({
      localId: "xps",
      defaultId: "xps",
      coordinatorSshHost: "xps",
      devices: [
        { id: "xps", name: "XPS", cwd: home },
        {
          id: "macbook",
          name: "MacBook",
          cwd: "/remote/work",
          sshHost: "mac",
          command: ["node", "worker"],
        },
      ],
    }),
  );
  const devices = new Devices(home, home),
    store = new Store(":memory:");
  const seen: string[] = [];
  const engine = new Engine(
    store,
    (_p, task) => ({
      run: async () => {
        seen.push(task!.deviceId!);
        return "OK";
      },
      steer: async () => {},
      interrupt: async () => {},
      close: async () => {},
    }),
    4,
    3,
    10000,
    home,
    devices,
  );
  const scope = {
    id: "test",
    cwd: home,
    ceiling: "read-only" as const,
    interactionMode: "default" as const,
  };
  try {
    const parent: any = await engine.call(scope, "delegate_task", {
      task: "parent",
      deviceId: "macbook",
      clientRequestId: "p",
    });
    assert.equal(store.task(parent.taskId).deviceId, "macbook");
    assert.equal(store.task(parent.taskId).cwd, "/remote/work");
    const child: any = await engine.call(
      { ...scope, id: "child:" + parent.taskId, parentTaskId: parent.taskId },
      "delegate_task",
      { task: "child", clientRequestId: "c" },
    );
    assert.equal(store.task(child.taskId).deviceId, "macbook");
    assert.equal(store.task(child.taskId).cwd, "/remote/work");
    const other: any = await engine.call(scope, "delegate_task", {
      task: "xps",
      clientRequestId: "x",
    });
    assert.equal(store.task(other.taskId).deviceId, "xps");
    const localScope = { ...scope, id: "different-project", cwd: tmpdir() };
    const local: any = await engine.call(localScope, "delegate_task", {
      task: "retain MCP project",
    });
    assert.equal(store.task(local.taskId).cwd, tmpdir());
    await assert.rejects(
      engine.call(scope, "delegate_task", {
        task: "unknown",
        deviceId: "missing",
      }),
      /Unknown device/,
    );
    const retry: any = await engine.call(scope, "delegate_task", {
      task: "parent",
      deviceId: "macbook",
      clientRequestId: "p",
    });
    assert.equal(retry.taskId, parent.taskId);
    await assert.rejects(
      engine.call(scope, "delegate_task", {
        task: "parent",
        deviceId: "xps",
        clientRequestId: "p",
      }),
      /different payload/i,
    );
  } finally {
    await engine.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
test("SSH quotes remote argv instead of interpolating shell input", () => {
  assert.match(
    sshArgs("mac", ["node", "a'b;$(touch /tmp/no)"]).at(-1)!,
    /'a'\\''b;\$\(touch \/tmp\/no\)'/,
  );
});
test("remote uncertainty is durable and never schedules an automatic retry", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  const e = new Engine(store, () => ({
    run: async () => {
      calls++;
      throw Error("REMOTE_UNCERTAIN: lost");
    },
    steer: async () => {},
    interrupt: async () => {},
    close: async () => {},
  }));
  const s = {
    id: "test",
    cwd: tmpdir(),
    ceiling: "read-only" as const,
    interactionMode: "default" as const,
  };
  try {
    const t: any = await e.call(s, "delegate_task", { task: "test" });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(store.task(t.taskId).status, "recovery_required");
    assert.equal(calls, 1);
  } finally {
    await e.close();
    store.close();
  }
});
