import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ensureDaemon, rpc } from "../src/transport.js";
const home = mkdtempSync(join(tmpdir(), "ao-controls-"));
const workspace = join(home, "workspace");
mkdirSync(workspace);
const scope = {
  id: "controls",
  cwd: workspace,
  ceiling: "auto-accept-edits",
  interactionMode: "default",
};
const call = (tool: string, input: unknown) =>
  rpc(home, "tool", { scope, tool, input });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  await ensureDaemon(home);
  const catalog = await rpc(home, "models");
  const model = catalog.data.find((m: any) => m.isDefault).model;
  const task = await call("delegate_task", {
    provider: "codex",
    model,
    runtimeMode: "read-only",
    task: "Run a shell command that sleeps for 8 seconds. After it completes reply ORIGINAL. Do not change files.",
  });
  for (let i = 0; i < 100; i++) {
    const s = await call("get_task_status", { taskId: task.taskId });
    if (s.sessionId) break;
    await sleep(100);
  }
  await call("send_to_subagent", {
    taskId: task.taskId,
    message: "Change the final response: reply STEERED instead of ORIGINAL.",
    mode: "steer",
    clientRequestId: "correction",
  });
  let result = await call("wait_for_task", {
    taskId: task.taskId,
    timeoutMs: 60_000,
  });
  console.log("native steering", result.status, result.resultSummary);
  assert.equal(result.status, "completed");
  assert.match(result.resultSummary, /STEERED/);
  assert.equal(result.runs.length, 1);
  const cancelled = await call("delegate_task", {
    provider: "codex",
    model,
    task: "Run a shell command that sleeps for 20 seconds. Then say DONE.",
    runtimeMode: "read-only",
  });
  for (let i = 0; i < 100; i++) {
    const s = await call("get_task_status", { taskId: cancelled.taskId });
    if (s.sessionId) break;
    await sleep(100);
  }
  await call("cancel_task", { taskId: cancelled.taskId });
  result = await call("wait_for_task", {
    taskId: cancelled.taskId,
    timeoutMs: 5000,
  });
  assert.equal(result.status, "cancelled");
  console.log("active cancellation", result.status);
  for (const provider of ["codex", "claude"]) {
    const edit = await call("delegate_task", {
      provider,
      model: provider === "codex" ? model : undefined,
      task: `Create a file named ${provider}-proof.txt in the working directory containing VERIFIED. Then reply WRITTEN.`,
      runtimeMode: "auto-accept-edits",
    });
    result = await call("wait_for_task", {
      taskId: edit.taskId,
      timeoutMs: 60_000,
    });
    console.log(
      provider,
      "write",
      result.status,
      result.error ?? result.resultSummary,
    );
    assert.equal(result.status, "completed");
    assert.ok(existsSync(join(workspace, provider + "-proof.txt")));
    const denied = await call("delegate_task", {
      provider,
      model: provider === "codex" ? model : undefined,
      task: `Try to create ${provider}-forbidden.txt in the working directory. If permissions prevent this, report that honestly.`,
      runtimeMode: "read-only",
    });
    result = await call("wait_for_task", {
      taskId: denied.taskId,
      timeoutMs: 60_000,
    });
    console.log(provider, "read-only", result.status);
    assert.equal(result.status, "completed");
    assert.equal(
      existsSync(join(workspace, provider + "-forbidden.txt")),
      false,
    );
  }
  console.log("All live control and permission checks passed.");
} finally {
  await rpc(home, "shutdown").catch(() => {});
  await sleep(1000);
  rmSync(home, { recursive: true, force: true });
}
