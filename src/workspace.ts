import { execFileSync, execFile } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import type { Task } from "./types.js";
export function resolveCommit(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export async function prepareWorkspace(task: Task) {
  if (task.isolation !== "worktree") return;
  if (existsSync(task.cwd)) {
    const current = resolveCommit(task.cwd);
    if (current !== task.baseCommit && !task.sessionId)
      throw new Error("Existing worktree does not match captured base commit");
    return;
  }
  mkdirSync(dirname(task.cwd), { recursive: true, mode: 0o700 });
  await promisify(execFile)(
    "git",
    ["worktree", "add", "--detach", task.cwd, task.baseCommit!],
    { cwd: task.sourceCwd, timeout: 30_000 },
  );
}
export function worktreePath(root: string, id: string) {
  return join(root, "worktrees", id);
}
