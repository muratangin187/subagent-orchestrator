import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { serve, rpc, socketPath, ensureDaemon } from "../src/transport.js";
const scope = {
  id: "test-parent",
  cwd: tmpdir(),
  ceiling: "read-only",
  interactionMode: "default",
};

test("Unix transport validates input, locks singleton and protects socket permissions", async () => {
  const home = mkdtempSync(join(tmpdir(), "ao-ipc-"));
  const service = await serve(home);
  try {
    assert.equal(statSync(socketPath(home)).mode & 0o777, 0o600);
    assert.equal(statSync(home).mode & 0o777, 0o700);
    assert.equal((await rpc(home, "health")).version, 1);
    await assert.rejects(serve(home), /held by live/);
    await assert.rejects(
      rpc(home, "tool", {
        scope,
        tool: "delegate_task",
        input: { task: "hi", shell: "rm" },
      }),
      /Unrecognized/,
    );
    await assert.rejects(
      rpc(home, "tool", {
        scope,
        tool: "get_task_status",
        input: { taskId: "invalid" },
      }),
      /UUID/,
    );
  } finally {
    await service.close();
    rmSync(home, { recursive: true, force: true });
  }
});
test("real MCP SDK handshake and bridge disconnect preserve the independent daemon", async () => {
  const home = mkdtempSync(join(tmpdir(), "ao-mcp-"));
  await ensureDaemon(home);
  const client = new Client({ name: "integration-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "dist/cli.js",
      "mcp",
      "--home",
      home,
      "--cwd",
      tmpdir(),
      "--parent",
      "integration-parent",
    ],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 12);
    assert.ok(list.tools.some((t) => t.name === "html_preview"));
    assert.ok(list.tools.some((t) => t.name === "html_render"));
    const result = await client.callTool({
      name: "orchestrator_capabilities",
      arguments: {},
    });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result), /read-only/);
    await client.close();
    assert.equal((await rpc(home, "health")).version, 1);
  } finally {
    await client.close();
    await rpc(home, "shutdown");
    await new Promise((r) => setTimeout(r, 100));
    rmSync(home, { recursive: true, force: true });
  }
});
test("two simultaneous bridge startups converge on one daemon", async () => {
  const home = mkdtempSync(join(tmpdir(), "ao-start-"));
  try {
    await Promise.all([ensureDaemon(home), ensureDaemon(home)]);
    const h = await rpc(home, "health");
    assert.ok(h.pid > 0);
    assert.equal((await rpc(home, "health")).pid, h.pid);
  } finally {
    await rpc(home, "shutdown").catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    rmSync(home, { recursive: true, force: true });
  }
});
test("daemon SIGKILL recovery retains completed receipts without spawning providers", async () => {
  const home = mkdtempSync(join(tmpdir(), "ao-kill-"));
  await ensureDaemon(home);
  try {
    await rpc(home, "tool", {
      scope,
      tool: "orchestrator_capabilities",
      input: {},
    });
    const { pid } = await rpc(home, "health");
    process.kill(pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
    await ensureDaemon(home);
    assert.notEqual((await rpc(home, "health")).pid, pid);
    assert.deepEqual(
      (await rpc(home, "tool", { scope, tool: "list_tasks", input: {} })).tasks,
      [],
    );
  } finally {
    await rpc(home, "shutdown").catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    rmSync(home, { recursive: true, force: true });
  }
});
