import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import type { RunContext } from "../src/types.js";
test("worktree uses captured commit, excludes uncommitted changes and is retained", async () => {
  const root = mkdtempSync(join(tmpdir(), "ao-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  writeFileSync(join(root, "data.txt"), "committed");
  git("add", ".");
  git("commit", "-m", "fixture");
  writeFileSync(join(root, "data.txt"), "dirty parent");
  const store = new Store(":memory:");
  let workspace = "";
  const engine = new Engine(
    store,
    () => ({
      async run(c: RunContext) {
        workspace = c.task.cwd;
        assert.equal(
          readFileSync(join(workspace, "data.txt"), "utf8"),
          "committed",
        );
        writeFileSync(join(workspace, "data.txt"), "child");
        return "done";
      },
      async steer() {},
      async interrupt() {},
      async close() {},
    }),
    1,
    3,
    30_000,
    root,
  );
  const scope = {
    id: "worktree",
    cwd: root,
    ceiling: "auto-accept-edits" as const,
    interactionMode: "default" as const,
  };
  try {
    const t = (await engine.call(scope, "delegate_task", {
      task: "edit",
      isolation: "worktree",
    })) as any;
    const result = (await engine.wait(scope, t.taskId, 5000)) as any;
    assert.equal(result.status, "completed");
    assert.notEqual(workspace, root);
    assert.equal(readFileSync(join(root, "data.txt"), "utf8"), "dirty parent");
    assert.equal(readFileSync(join(workspace, "data.txt"), "utf8"), "child");
    assert.ok(existsSync(workspace));
  } finally {
    await engine.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
