import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isWithinWorkspace,
  readClaudeSuccess,
} from "../src/providers/claude.js";
test("Claude write paths reject traversal, symlink escape and missing ancestors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ao-path-"));
  const root = join(dir, "workspace");
  const outside = join(dir, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(root, "a"), "a");
  symlinkSync(outside, join(root, "escape"));
  try {
    assert.equal(await isWithinWorkspace(root, "a"), true);
    assert.equal(await isWithinWorkspace(root, "new.txt"), true);
    assert.equal(await isWithinWorkspace(root, "../outside/file"), false);
    assert.equal(await isWithinWorkspace(root, "escape/file"), false);
    assert.equal(await isWithinWorkspace(root, "missing/parent/file"), false);
    assert.equal(await isWithinWorkspace(root, 42), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real Claude success-subtype quota frames are failures, not successful answers", () => {
  const captured = {
    is_error: true,
    result: "You've hit your session limit · resets 9:40pm (Europe/Istanbul)",
  };
  assert.throws(() => readClaudeSuccess(captured), /session limit/);
  assert.throws(
    () =>
      readClaudeSuccess({
        is_error: true,
        result: "Authentication failed",
        api_error_status: 401,
      }),
    /HTTP 401/,
  );
  assert.equal(readClaudeSuccess({ is_error: false, result: "Done" }), "Done");
});
