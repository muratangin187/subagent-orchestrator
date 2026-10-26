const { test } = require("node:test");
const assert = require("node:assert/strict");
test("message acceptance does not show stale completed turn; new run clears local delivery", async () => {
  const { chatStatus } = await import("../src/chat-status.mjs");
  const base = {
    connected: true,
    offline: false,
    task: { runId: "old", status: "completed" },
    delivery: { phase: "accepted", previousRunId: "old" },
  };
  assert.equal(chatStatus(base).animated, true);
  assert.equal(chatStatus({ ...base, task: { runId: "new", status: "pending" } }).label, "Mesaj sırada…");
  assert.equal(
    chatStatus({ ...base, task: { runId: "new", status: "completed" } }).label,
    "Yanıt tamamlandı",
  );
  assert.equal(chatStatus({ ...base, offline: true }).kind, "warning");
  assert.equal(
    chatStatus({
      ...base,
      delivery: { phase: "uncertain", previousRunId: "old" },
    }).label,
    "Gönderim doğrulanamadı",
  );
  assert.equal(
    chatStatus({
      ...base,
      delivery: undefined,
      task: { status: "recovery_required" },
    }).animated,
    undefined,
  );
  assert.equal(
    chatStatus({ ...base, delivery: undefined, activeChildren: 2 }).animated,
    true,
  );
});
