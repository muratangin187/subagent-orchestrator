import { test } from "node:test";
import assert from "node:assert/strict";
import { activityPatches } from "../src/workspace/activity.js";
const event = (type: string, payload: any) => ({ id: 1, type, payload });
test("Codex tool start, output and failure preserve identity and truthful status", () => {
  const start = activityPatches(
    event("tool_started", {
      id: "cmd",
      type: "commandExecution",
      command: "pwd",
    }),
  )[0]!;
  assert.equal(start.kind, "command");
  assert.equal(start.state, "running");
  assert.equal(start.input, "pwd");
  assert.deepEqual(
    activityPatches(event("tool_output", { itemId: "cmd", text: "out" })),
    [{ id: "cmd", output: "out", append: "output" }],
  );
  const end = activityPatches(
    event("tool_item", {
      id: "cmd",
      type: "commandExecution",
      exitCode: 1,
      aggregatedOutput: "error",
    }),
  )[0]!;
  assert.equal(end.state, "failed");
  assert.equal(end.output, "error");
  assert.equal(end.id, start.id);
});
test("only published reasoning summaries are projected, never raw content", () => {
  const item = activityPatches(
    event("tool_item", {
      id: "r",
      type: "reasoning",
      content: ["private raw"],
      summary: [{ text: "Public summary" }],
    }),
  )[0]!;
  assert.equal(item.output, "Public summary");
  assert.ok(!JSON.stringify(item).includes("private raw"));
  assert.equal(
    activityPatches(event("tool_item", { id: "u", type: "userMessage" }))
      .length,
    0,
  );
});
test("Claude tool use and tool result map to same identity", () => {
  const start = activityPatches(
    event("assistant_message", {
      content: [
        { type: "text", text: "I will read" },
        {
          type: "tool_use",
          id: "t",
          name: "Read",
          input: { file_path: "/tmp/test" },
        },
      ],
    }),
  );
  assert.equal(start.length, 1);
  assert.equal(start[0]!.kind, "read");
  const end = activityPatches(
    event("tool_result", {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t",
          is_error: true,
          content: [{ type: "text", text: "Missing" }],
        },
      ],
    }),
  );
  assert.deepEqual(end, [{ id: "t", state: "failed", output: "Missing" }]);
});
test("large outputs are bounded without dropping the failure state", () => {
  const result = activityPatches(
    event("tool_item", {
      id: "t",
      type: "mcpToolCall",
      tool: "lookup",
      error: "x".repeat(100000),
    }),
  )[0]!;
  assert.equal(result.state, "failed");
  assert.ok(result.output!.length < 25000);
});
