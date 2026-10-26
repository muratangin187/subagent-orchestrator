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
test("tools stay between messages and late results update their original group", async () => {
  const { workSlots, projectMessages } = await import("../src/timeline.mjs");
  const e = (id, type, payload = {}, activity = []) => ({
    id,
    type,
    payload,
    activity,
    runId: "r",
    created: id * 1000,
  });
  const events = [
    e(1, "run_started"),
    e(2, "assistant_message", { id: "m1", text: "First" }),
    e(3, "tool_started", {}, [{ id: "a", state: "running" }]),
    e(4, "tool_started", {}, [{ id: "b", state: "running" }]),
    e(5, "assistant_message", { id: "m2", text: "Middle" }),
    e(6, "tool_started", {}, [{ id: "c", state: "running" }]),
    e(7, "tool_result", {}, [{ id: "a", state: "completed", output: "late" }]),
    e(8, "assistant_message", { id: "m3", text: "Last" }),
    e(9, "completed"),
  ];
  const slots = workSlots(events, projectMessages(events));
  assert.equal(slots.before.has("2"), false);
  assert.deepEqual(
    slots.before.get("5")[0].items.map((x) => x.id),
    ["a", "b"],
  );
  assert.equal(slots.before.get("5")[0].items[0].output, "late");
  assert.deepEqual(
    slots.before.get("8")[0].items.map((x) => x.id),
    ["c"],
  );
  assert.equal(slots.tail.length, 0);
});
test("live trailing group and streamed message keep their positions after completion", async () => {
  const { workSlots, projectMessages } = await import("../src/timeline.mjs");
  const events = [
    { id: 1, type: "run_started", runId: "r", created: 1, payload: {} },
    {
      id: 2,
      type: "assistant_delta",
      runId: "r",
      created: 2,
      payload: { itemId: "m", text: "Hello" },
    },
    {
      id: 3,
      type: "tool_started",
      runId: "r",
      created: 3,
      payload: {},
      activity: [{ id: "a", state: "running" }],
    },
  ];
  assert.equal(workSlots(events, projectMessages(events)).tail.length, 1);
  events.push({
    id: 4,
    type: "assistant_message",
    runId: "r",
    created: 4,
    payload: { id: "m", text: "Hello" },
  });
  assert.equal(workSlots(events, projectMessages(events)).tail.length, 1);
});
test("message timestamps retain event time and never invent a missing timestamp", async () => {
  const { projectMessages } = await import("../src/timeline.mjs");
  const rows = projectMessages([
    {
      id: 1,
      type: "message_queued",
      created: 1700000000000,
      payload: { message: "Hello" },
    },
    { id: 2, type: "assistant_message", payload: { text: "Reply" } },
  ]);
  assert.equal(rows[0].created, 1700000000000);
  assert.equal(rows[1].created, undefined);
});

test("inline visual remains between commentary and final response", async () => {
  const { projectMessages } = await import("../src/timeline.mjs");
  const messages = projectMessages([
    {
      id: 1,
      runId: "a",
      created: 1,
      type: "assistant_message",
      payload: { id: "first", text: "Preparing" },
    },
    {
      id: 2,
      runId: "a",
      created: 2,
      type: "html_render",
      payload: { id: "visual", title: "Solar system", measurements: [] },
    },
    {
      id: 3,
      runId: "a",
      created: 3,
      type: "assistant_message",
      payload: { id: "last", text: "Ready" },
    },
  ]);
  assert.deepEqual(
    messages.map((m) => m.text),
    ["Preparing", "Solar system", "Ready"],
  );
  assert.equal(messages[1].visual.id, "visual");
});
