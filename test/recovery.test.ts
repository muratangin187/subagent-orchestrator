import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { rpc } from "../src/transport.js";
const pause = () => new Promise((r) => setTimeout(r, 50));
test("active process crash has no automatic replay; explicit continuation preserves native ID", async () => {
  const home = mkdtempSync(join(tmpdir(), "ao-recover-"));
  const log = join(home, "provider.jsonl");
  writeFileSync(log, "");
  const env = {
    ...process.env,
    ORCHESTRATOR_CODEX_BIN: resolve("test/fixtures/codex.cjs"),
    AO_FIXTURE_LOG: log,
  };
  const start = async () => {
    const child = spawn(
      process.execPath,
      ["dist/cli.js", "daemon", "--home", home],
      { env, stdio: "ignore" },
    );
    for (let i = 0; i < 100; i++) {
      await pause();
      try {
        await rpc(home, "health");
        return child;
      } catch {}
    }
    throw new Error("daemon startup failed");
  };
  const scope = {
    id: "recovery-parent",
    cwd: home,
    ceiling: "read-only",
    interactionMode: "default",
  };
  const call = (tool: string, input: unknown) =>
    rpc(home, "tool", { scope, tool, input });
  let child = await start();
  try {
    const task = await call("delegate_task", {
      task: "hang",
      clientRequestId: "stable",
    });
    let state;
    for (let i = 0; i < 100; i++) {
      state = await call("get_task_status", { taskId: task.taskId });
      if (state.sessionId && readFileSync(log, "utf8").trim()) break;
      await pause();
    }
    assert.ok(state.sessionId);
    const native = state.sessionId;
    await call("send_to_subagent", {
      taskId: task.taskId,
      message: "queued before crash",
      mode: "queue",
    });
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    child = await start();
    state = await call("get_task_status", { taskId: task.taskId });
    assert.equal(state.status, "recovery_required");
    assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1);
    const retry = await call("delegate_task", {
      task: "hang",
      clientRequestId: "stable",
    });
    assert.equal(retry.taskId, task.taskId);
    await call("send_to_subagent", {
      taskId: task.taskId,
      message: "continue explicitly",
      mode: "queue",
    });
    for (let i = 0; i < 100; i++) {
      state = await call("get_task_status", { taskId: task.taskId });
      if (state.status === "completed") break;
      await pause();
    }
    assert.equal(state.status, "completed");
    assert.equal(state.sessionId, native);
    assert.equal(state.runs[0].status, "recovery_required");
    assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
  } finally {
    await rpc(home, "shutdown").catch(() => {});
    await pause();
    if (child.exitCode === null) child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
