const { test } = require("node:test");
const assert = require("node:assert/strict");
test("job hierarchy keeps descendants with parents and handles missing or cyclic links", async () => {
  const { taskTree } = await import("../src/task-tree.mjs");
  const t = (id, parentTaskId, updatedAt = 1) => ({
    id,
    title: id,
    parentTaskId,
    updatedAt,
    status: "running",
  });
  const rows = taskTree(
    [
      t("assistant"),
      t("a", "assistant"),
      t("b", "a", 9),
      t("c", "b", 10),
      t("orphan", "missing"),
      t("loop", "loop"),
    ],
    "assistant",
  );
  assert.deepEqual(
    rows
      .filter((r) => ["a", "b", "c"].includes(r.task.id))
      .map((r) => [r.task.id, r.depth]),
    [
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ],
  );
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.find((r) => r.task.id === "c").path, [
    "Asistan",
    "a",
    "b",
  ]);
});
