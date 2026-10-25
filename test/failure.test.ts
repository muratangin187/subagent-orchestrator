import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure } from "../src/providers/failure.js";
test("provider limits distinguish quota, throttling and unrelated failures", () => {
  assert.equal(
    classifyFailure(
      "codex",
      '{"error":{"type":"usage_limit_reached","message":"Usage exceeded"}}',
    )?.kind,
    "usage_limit",
  );
  assert.equal(
    classifyFailure("claude", "HTTP 429: too many requests")?.kind,
    "rate_limit",
  );
  assert.equal(classifyFailure("claude", "HTTP 429")?.resetHint, undefined);
  assert.equal(
    classifyFailure("codex", "model_not_found: model not supported"),
    undefined,
  );
  assert.equal(classifyFailure("claude", "Connection reset"), undefined);
});
