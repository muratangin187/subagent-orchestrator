const { test } = require("node:test");
const assert = require("node:assert/strict");
test("opening beside pins assistant left and preserves voice; closing keeps the main session", async () => {
  const { initialLayout, updateLayout } =
    await import("../src/split-layout.mjs");
  let layout = updateLayout(initialLayout, {
    type: "select",
    pane: "left",
    id: "session-a",
  });
  layout = updateLayout(layout, { type: "voice", open: true });
  layout = updateLayout(layout, { type: "split", id: "session-b" });
  assert.deepEqual(layout, {
    left: "assistant",
    right: "session-b",
    voice: true,
  });
  assert.deepEqual(
    updateLayout(layout, { type: "split", id: "assistant" }),
    layout,
  );
  layout = updateLayout(layout, {
    type: "select",
    pane: "right",
    id: "session-c",
  });
  assert.equal(layout.left, "assistant");
  assert.equal(layout.right, "session-c");
  assert.deepEqual(updateLayout(layout, { type: "close" }), {
    left: "assistant",
    right: null,
    voice: true,
  });
  assert.deepEqual(initialLayout, {
    left: "assistant",
    right: null,
    voice: false,
  });
});
test("divider clamps each pane to its usable width and recovers after window resize", async () => {
  const { splitRatio } = await import("../src/split-layout.mjs");
  assert.equal(splitRatio(0.2, 2000), 0.2);
  assert.equal(splitRatio(0.1, 1000), 0.34);
  assert(Math.abs(splitRatio(0.9, 1000) - 0.66) < 1e-10);
  assert.equal(splitRatio(0.9, 500), 0.5);
  assert.equal(splitRatio(NaN, 2000), 0.5);
  assert.equal(splitRatio(0.3, 0), 0.5);
});
