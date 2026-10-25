import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ensureDaemon, rpc } from "../src/transport.js";
import type { Scope } from "../src/types.js";
const home = mkdtempSync(join(tmpdir(), "ao-live-"));
const workspace = join(home, "workspace");
const { mkdirSync } = await import("node:fs");
mkdirSync(workspace);
writeFileSync(
  join(workspace, "fixture.json"),
  JSON.stringify({
    students: [
      { name: "Ada", score: 37 },
      { name: "Ece", score: 48 },
    ],
    note: "Türkçe veri 🧪",
  }),
);
const scope: Scope = {
  id: "live-test",
  cwd: workspace,
  ceiling: "read-only",
  interactionMode: "default",
};
async function call(tool: string, input: unknown) {
  return rpc(home, "tool", { scope, tool, input });
}
const evidence: unknown[] = [];
try {
  await ensureDaemon(home);
  for (const provider of ["codex", "claude"]) {
    const catalog =
      provider === "codex" ? await rpc(home, "models") : undefined;
    const model =
      provider === "codex"
        ? catalog.data.find((m: any) => m.isDefault)?.model
        : undefined;
    const t = await call("delegate_task", {
      provider,
      model,
      task: "Read fixture.json in the working directory. Compute the sum of scores. Reply exactly SUM=85 if that is the sum. Do not modify files.",
      clientRequestId: `${provider}-initial`,
    });
    let result = await call("wait_for_task", {
      taskId: t.taskId,
      timeoutMs: 60_000,
    });
    if (result.timedOut)
      result = await call("wait_for_task", {
        taskId: t.taskId,
        timeoutMs: 60_000,
      });
    console.log(
      provider,
      "first",
      result.status,
      result.resultSummary ?? result.error,
    );
    assert.equal(result.status, "completed");
    assert.match(result.resultSummary, /SUM=85/);
    const sessionId = result.sessionId;
    await call("send_to_subagent", {
      taskId: t.taskId,
      message:
        "What was the computed sum in the previous turn? Reply exactly PREVIOUS=85.",
      mode: "queue",
      clientRequestId: `${provider}-followup`,
    });
    for (let i = 0; i < 50; i++) {
      result = await call("get_task_status", { taskId: t.taskId });
      if (result.runs.length === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    result = await call("wait_for_task", {
      taskId: t.taskId,
      timeoutMs: 60_000,
    });
    console.log(
      provider,
      "followup",
      result.status,
      result.resultSummary ?? result.error,
    );
    assert.equal(result.status, "completed");
    assert.match(result.resultSummary, /PREVIOUS=85/);
    assert.equal(result.sessionId, sessionId);
    assert.match(result.runs[0].result, /SUM=85/);
    const transcript = await call("get_subagent_messages", {
      taskId: t.taskId,
    });
    assert.ok(transcript.messages.length > 3);
    evidence.push({
      provider,
      first: "SUM=85",
      followup: "PREVIOUS=85",
      sameNativeSession: true,
      events: transcript.messages.length,
      status: result.status,
    });
  }
  assert.equal(
    JSON.parse(readFileSync(join(workspace, "fixture.json"), "utf8")).students
      .length,
    2,
  );
  console.log(JSON.stringify({ passed: true, evidence }, null, 2));
} finally {
  await rpc(home, "shutdown").catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(home, { recursive: true, force: true });
}
