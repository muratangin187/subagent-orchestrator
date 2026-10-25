import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ensureDaemon, rpc } from "../src/transport.js";
const home = mkdtempSync(join(tmpdir(), "ao-nested-live-"));
const workspace = join(home, "workspace");
mkdirSync(workspace);
const scope = {
  id: "nested-live",
  cwd: workspace,
  ceiling: "read-only",
  interactionMode: "default",
};
const call = (tool: string, input: unknown) =>
  rpc(home, "tool", { scope, tool, input });
try {
  await ensureDaemon(home);
  const catalog = await rpc(home, "models");
  const model = catalog.data.find((m: any) => m.isDefault).model;
  for (const provider of ["codex", "claude"]) {
    const childProvider = provider === "codex" ? "claude" : "codex";
    const task = await call("delegate_task", {
      provider,
      model: provider === "codex" ? model : undefined,
      task: `This is a nested orchestration integration test. You MUST use the standalone_children MCP delegate_task tool to create exactly one ${childProvider} child${childProvider === "codex" ? ` with model ${model}` : ""}. Its brief is: Compute 17+28 and reply CHILD=45. Use mode wait, timeoutMs 45000 and clientRequestId nested-check. If it times out, use wait_for_task. Do not answer the arithmetic yourself. Read the child result, then reply exactly PARENT_RECEIVED=45. Do not change files.`,
    });
    let result;
    for (let i = 0; i < 4; i++) {
      result = await call("wait_for_task", {
        taskId: task.taskId,
        timeoutMs: 60_000,
      });
      if (!result.timedOut) break;
    }
    console.log(
      provider,
      "parent",
      result.status,
      result.resultSummary ?? result.error,
      JSON.stringify(result.children),
    );
    if (!result.children.length) {
      const transcript = await call("get_subagent_messages", {
        taskId: task.taskId,
      });
      console.log(
        JSON.stringify(
          transcript.messages.filter((m: any) =>
            ["tool_item", "provider_request", "permission_denied"].includes(
              m.type,
            ),
          ),
          null,
          2,
        ),
      );
    }
    assert.equal(result.status, "completed");
    assert.match(result.resultSummary, /PARENT_RECEIVED=45/);
    assert.equal(result.children.length, 1);
    const child = await call("get_task_status", {
      taskId: result.children[0].taskId,
    });
    assert.equal(child.provider, childProvider);
    assert.equal(child.depth, 2);
    assert.equal(child.status, "completed");
    assert.match(child.resultSummary, /CHILD=45/);
    console.log(
      "verified real provider nesting",
      provider,
      "->",
      childProvider,
    );
  }
} finally {
  await rpc(home, "shutdown").catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(home, { recursive: true, force: true });
}
