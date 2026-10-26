const { test } = require("node:test");
const assert = require("node:assert/strict");
test("stream updates replace with exact raw completed text without duplicates across runs", async () => {
  const { projectMessages, runTimes, duration, activity } =
    await import("../src/timeline.mjs");
  const e = (id, type, payload = {}, runId = "a", created = id * 1000) => ({
    id,
    type,
    payload,
    runId,
    created,
  });
  const events = [
    e(1, "run_started"),
    e(2, "assistant_delta", { itemId: "m", text: "**Hi" }),
    e(3, "assistant_delta", { itemId: "m", text: "**" }),
  ];
  assert.equal(projectMessages(events)[0].text, "**Hi**");
  events.push(
    e(4, "assistant_message", { id: "m", text: "**Hi**" }),
    e(5, "completed"),
  );
  assert.deepEqual(
    projectMessages(events).map((x) => x.text),
    ["**Hi**"],
  );
  events.push(
    e(6, "run_started", {}, "b"),
    e(7, "assistant_delta", { itemId: "m", text: "new" }, "b"),
  );
  assert.deepEqual(
    projectMessages(events).map((x) => x.text),
    ["**Hi**", "new"],
  );
  assert.deepEqual(runTimes(events), {
    a: { start: 1000, end: 5000 },
    b: { start: 6000 },
  });
  assert.equal(duration(615000), "10m 15s");
  assert.equal(duration(-100), "0m 0s");
  assert.deepEqual(
    activity(
      [
        e(1, "tool_started", {
          id: "cmd",
          type: "commandExecution",
          command: "pwd",
        }),
        e(2, "tool_item", {
          id: "cmd",
          type: "commandExecution",
          command: "pwd",
        }),
      ],
      "a",
    ).tools,
    [{ label: "pwd", done: true }],
  );
});
test("work groups merge item patches, preserve output and mark unconfirmed tools interrupted", async () => {
  const { workGroups } = await import("../src/timeline.mjs");
  const events = [
    { id: 1, runId: "r", created: 100, type: "run_started" },
    {
      id: 2,
      runId: "r",
      created: 200,
      type: "tool_started",
      activity: [
        {
          id: "c",
          kind: "command",
          title: "Komut",
          state: "running",
          input: "pwd",
        },
      ],
    },
    {
      id: 3,
      runId: "r",
      created: 300,
      type: "tool_output",
      activity: [{ id: "c", append: "output", output: "hello" }],
    },
    {
      id: 4,
      runId: "r",
      created: 400,
      type: "tool_output",
      activity: [{ id: "c", append: "output", output: " world" }],
    },
    { id: 5, runId: "r", created: 500, type: "completed" },
  ];
  const group = workGroups(events).r;
  assert.equal(group.items.length, 1);
  assert.equal(group.items[0].input, "pwd");
  assert.equal(group.items[0].output, "hello world");
  assert.equal(group.items[0].state, "interrupted");
  assert.equal(group.end, 500);
});
