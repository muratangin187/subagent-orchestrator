#!/usr/bin/env node
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { defaultHome, ensureDaemon, rpc, serve } from "./transport.js";
import { startMcp } from "./mcp.js";
import { runtime } from "./schema.js";
import { errorText } from "./types.js";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    home: { type: "string" },
    cwd: { type: "string" },
    parent: { type: "string" },
    task: { type: "string" },
    ceiling: { type: "string" },
    plan: { type: "boolean" },
    help: { type: "boolean" },
    port: { type: "string" },
    model: { type: "string" },
    target: { type: "string" },
  },
});
const home = resolve(values.home ?? defaultHome());
async function main() {
  const command = positionals[0] ?? "help";
  if (command === "help" || values.help) {
    console.log(`agent-orchestrator <command> [options]
  mcp       Stdio MCP bridge; starts background service automatically
  workspace Start the Android API and persistent assistant (use a separate --home)
  daemon    Run service in foreground (for systemd/launchd or diagnostics)
  status    Inspect service health
  stop      Stop this instance and its provider processes
  doctor    Check Node and installed provider CLIs
  models    Query live Codex model catalog
  config    Print portable VS Code, Claude Code and Codex configuration examples
Options: --home DIR --cwd DIR --parent SESSION_ID --ceiling MODE --plan
Default ceiling: read-only. Set --parent to a unique stable ID to reconnect later.
Unix/macOS/Linux supported; use WSL2 on Windows.`);
    return;
  }
  if (command === "device-worker") {
    await (await import("./devices/worker.js")).worker();
    return;
  }
  if (command === "workspace-proxy") { const server=await (await import("./workspace/proxy.js")).startProxy(values.target!,Number(values.port??8787)); process.on("SIGTERM",()=>server.close(()=>process.exit(0))); return; }
  if (command === "doctor") {
    const exec = promisify(execFile);
    const providers = await Promise.all(
      ["codex", "claude"].map(async (provider) => {
        try {
          const { stdout } = await exec(provider, ["--version"], {
            timeout: 5000,
          });
          return { provider, available: true, version: stdout.trim() };
        } catch (e) {
          return { provider, available: false, error: errorText(e) };
        }
      }),
    );
    console.log(
      JSON.stringify(
        { node: process.version, platform: process.platform, providers },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "daemon" || command === "workspace") {
    const port = Number(values.port ?? 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error("Invalid port");
    const service = await serve(
      home,
      command === "workspace"
        ? {
            cwd: realpathSync(values.cwd ?? process.cwd()),
            ceiling: runtime.parse(values.ceiling ?? "read-only"),
            port,
            model: values.model,
          }
        : undefined,
    );
    console.error(`Orchestrator ready: ${home}`);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void service.close().then(() => process.exit(0));
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    return;
  }
  if (command === "status" || command === "stop") {
    console.log(
      JSON.stringify(
        await rpc(home, command === "status" ? "health" : "shutdown"),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "models") {
    await ensureDaemon(home);
    console.log(JSON.stringify(await rpc(home, "models"), null, 2));
    return;
  }
  if (command === "config") {
    const args = [
      "mcp",
      "--cwd",
      realpathSync(values.cwd ?? process.cwd()),
      "--ceiling",
      runtime.parse(values.ceiling ?? "read-only"),
    ];
    if (values.parent) args.push("--parent", values.parent);
    console.log(
      JSON.stringify(
        {
          vscode: {
            servers: {
              subagent_orchestrator: {
                type: "stdio",
                command: "agent-orchestrator",
                args,
              },
            },
          },
          claude: {
            mcpServers: {
              subagent_orchestrator: { command: "agent-orchestrator", args },
            },
          },
          codex: {
            mcp_servers: {
              subagent_orchestrator: { command: "agent-orchestrator", args },
            },
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "mcp") {
    const server = await startMcp(home, {
      parentTaskId: values.task,
      id: values.parent ?? process.env.ORCHESTRATOR_PARENT_ID ?? randomUUID(),
      cwd: realpathSync(values.cwd ?? process.cwd()),
      ceiling: runtime.parse(
        values.ceiling ?? process.env.ORCHESTRATOR_CEILING ?? "read-only",
      ),
      interactionMode: values.plan ? "plan" : "default",
    });
    process.on(
      "SIGTERM",
      () => void server.close().then(() => process.exit(0)),
    );
    process.on("SIGINT", () => void server.close().then(() => process.exit(0)));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
void main().catch((e) => {
  console.error(errorText(e));
  process.exitCode = 1;
});
