import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLimits } from "../src/providers/limits.js";
test("Codex windows preserve utilization, reset and named buckets without duplicate fallback", () => {
  const r = normalizeLimits("codex", {
    rateLimits: { primary: { usedPercent: 1 } },
    rateLimitsByLimitId: {
      codex: {
        primary: {
          usedPercent: 25,
          windowDurationMins: 300,
          resetsAt: 1800000000,
        },
        secondary: { usedPercent: 105, windowDurationMins: 10080 },
      },
    },
  });
  assert.equal(r.windows.length, 2);
  assert.equal(r.windows[0]!.usedPercent, 25);
  assert.equal(r.windows[0]!.resetsAt, 1800000000000);
  assert.equal(r.windows[1]!.usedPercent, 100);
});
test("Claude missing/null limits are not reported as zero; model windows are supported", () => {
  const r = normalizeLimits("claude", {
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 0, resets_at: "2026-10-27T12:00:00Z" },
      seven_day: { utilization: null },
      model_scoped: [
        { display_name: "Opus", utilization: 50, resets_at: null },
      ],
    },
  });
  assert.equal(r.windows.length, 2);
  assert.equal(r.windows[0]!.usedPercent, 0);
  assert.equal(r.windows[1]!.label, "Opus · Haftalık");
  assert.equal(r.windows[1]!.resetsAt, undefined);
  assert.match(normalizeLimits("claude", {}).error!, /sunulmuyor/);
  assert.equal(
    normalizeLimits("codex", { rateLimits: { primary: { usedPercent: NaN } } })
      .windows.length,
    0,
  );
});
