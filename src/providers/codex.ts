import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { RpcProcess } from "./process.js";
import { OrchestratorError, type Driver, type RunContext } from "../types.js";

function args() {
  const result = ["app-server", "--stdio", "-c", "features.multi_agent=false"];
  // Disable inherited MCP servers so children cannot escape orchestration lineage via another server.
  try {
    const config = parse(
      readFileSync(
        join(
          process.env.CODEX_HOME ?? join(homedir(), ".codex"),
          "config.toml",
        ),
        "utf8",
      ),
    );
    const servers = config.mcp_servers as Record<string, unknown> | undefined;
    for (const name of Object.keys(servers ?? {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(name))
        throw new Error(
          "Unsupported MCP config key; cannot safely disable inherited server",
        );
      result.push("-c", `mcp_servers.${name}.enabled=false`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return result;
}
export class CodexDriver implements Driver {
  private rpc?: RpcProcess;
  private threadId?: string;
  private turnId?: string;
  private stopped = false;
  private rejectRun?: (e: Error) => void;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;
  private ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });
  constructor() {
    void this.ready.catch(() => {});
  }
  async run(ctx: RunContext): Promise<string> {
    if (this.stopped) throw new Error("Cancelled before start");
    const rpc = (this.rpc = new RpcProcess(
      process.env.ORCHESTRATOR_CODEX_BIN ?? "codex",
      args(),
      ctx.task.cwd,
    ));
    let resolveRun!: (s: string) => void;
    const done = new Promise<string>((resolve, reject) => {
      resolveRun = resolve;
      this.rejectRun = reject;
    });
    // Attach a handler before initialization: early provider exits must not become unhandled rejections.
    void done.catch(() => {});
    let final = "";
    rpc.on("failure", (e) => this.rejectRun?.(e));
    rpc.on("notification", (m: any) => {
      if (
        m.params?.threadId &&
        this.threadId &&
        m.params.threadId !== this.threadId
      )
        return;
      const p = m.params;
      if (m.method === "turn/started") this.turnId = p.turn.id;
      if (
        m.method === "item/started" &&
        !["userMessage", "agentMessage"].includes(p.item?.type)
      )
        ctx.event({ type: "tool_started", payload: p.item });
      // Only provider-published summaries, never raw reasoning text.
      if (m.method === "item/reasoning/summaryTextDelta")
        ctx.event({
          type: "reasoning_summary",
          payload: { itemId: p.itemId, text: p.delta },
        });
      if (m.method === "thread/tokenUsage/updated")
        ctx.event({ type: "usage", payload: p.tokenUsage });
      if (m.method === "item/commandExecution/outputDelta")
        ctx.event({
          type: "tool_output",
          payload: { itemId: p.itemId, text: p.delta },
        });
      if (m.method === "item/agentMessage/delta")
        ctx.event({
          type: "assistant_delta",
          payload: { itemId: p.itemId, text: p.delta },
        });
      if (m.method === "item/completed") {
        ctx.event({
          type:
            p.item?.type === "agentMessage" ? "assistant_message" : "tool_item",
          payload: p.item,
        });
        if (p.item?.type === "agentMessage") final = p.item.text ?? final;
      }
      if (m.method === "error")
        ctx.event({ type: "provider_error", payload: p });
      if (m.method === "turn/completed") {
        if (p.turn.status === "completed") resolveRun(final);
        else
          this.rejectRun?.(
            new Error(p.turn.error?.message ?? `Turn ${p.turn.status}`),
          );
      }
    });
    rpc.on("request", (m: any) => {
      ctx.event({
        type: "provider_request",
        payload: { method: m.method, params: m.params },
      });
      void (async () => {
        if (m.method === "item/tool/requestUserInput") {
          const answer = await ctx.question({
            kind: "question",
            questions: m.params.questions,
          });
          rpc.send({ id: m.id, result: { answers: answer } });
        } else if (
          m.method === "item/commandExecution/requestApproval" ||
          m.method === "item/fileChange/requestApproval"
        ) {
          // A child cannot promote itself beyond the configured sandbox, even through a parent answer.
          ctx.event({
            type: "permission_denied",
            payload: {
              method: m.method,
              reason: "No runtime privilege escalation",
            },
          });
          rpc.send({ id: m.id, result: { decision: "decline" } });
        } else if (m.method === "item/permissions/requestApproval")
          rpc.send({ id: m.id, result: { permissions: {}, scope: "turn" } });
        else if (m.method === "mcpServer/elicitation/request") {
          const trustedDelegation =
            ctx.delegation &&
            m.params.serverName === "standalone_children" &&
            m.params._meta?.codex_approval_kind === "mcp_tool_call";
          rpc.send({
            id: m.id,
            result: trustedDelegation
              ? { action: "accept", content: {} }
              : { action: "decline", content: null },
          });
        } else
          rpc.send({
            id: m.id,
            error: { code: -32601, message: "Unsupported server request" },
          });
      })().catch((e) => this.rejectRun?.(e));
    });
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "standalone_orchestrator", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      rpc.send({ method: "initialized", params: {} });
      const readOnly =
        ctx.task.runtimeMode === "read-only" ||
        ctx.task.runtimeMode === "approval-required" ||
        ctx.task.interactionMode === "plan";
      const sandbox = readOnly
        ? "read-only"
        : ctx.task.runtimeMode === "full-access"
          ? "danger-full-access"
          : "workspace-write";
      // Host-controlled opt-in; agents cannot request a higher network ceiling.
      const networkAccess =
        process.env.ORCHESTRATOR_CODEX_NETWORK_ACCESS === "true";
      const params = {
        cwd: ctx.task.cwd,
        model: ctx.task.model,
        sandbox,
        approvalPolicy: "never",
        config: {
          "features.multi_agent": false,
          ...(networkAccess ? { web_search: "live" } : {}),
          ...(ctx.delegation
            ? {
                "mcp_servers.standalone_children.command":
                  ctx.delegation.command,
                "mcp_servers.standalone_children.args": ctx.delegation.args,
                "mcp_servers.standalone_children.enabled": true,
                "mcp_servers.standalone_children.tool_timeout_sec": 75,
                "mcp_servers.standalone_children.default_tools_approval_mode":
                  "approve",
              }
            : {}),
        },
        developerInstructions:
          ctx.task.instructions ??
          "You are a delegated agent. Work only on the supplied brief. Report uncertainties and results honestly. " +
            (ctx.delegation
              ? "You can delegate subtasks using standalone_children MCP tools. That server binds new tasks to you automatically. Use wait_for_task to receive results; relay relevant context changes with send_to_subagent. Use only this MCP for delegation, not native agent tools or shell-spawned agents. Wait for your children before publishing a combined result."
              : "Delegation depth limit reached. Do not spawn further agents."),
      };
      const response = await rpc.request(
        ctx.task.sessionId ? "thread/resume" : "thread/start",
        ctx.task.sessionId
          ? { ...params, threadId: ctx.task.sessionId }
          : params,
      );
      ctx.event({ type: "provider_ready", payload: { provider: "codex" } });
      this.threadId = response.thread.id;
      ctx.session(this.threadId!);
      const sandboxPolicy = readOnly
        ? { type: "readOnly", networkAccess }
        : ctx.task.runtimeMode === "full-access"
          ? { type: "dangerFullAccess" }
          : {
              type: "workspaceWrite",
              writableRoots: [ctx.task.cwd],
              networkAccess,
              excludeTmpdirEnvVar: true,
              excludeSlashTmp: true,
            };
      const started = await rpc.request("turn/start", {
        sandboxPolicy,
        approvalPolicy: "never",
        threadId: this.threadId,
        input: [{ type: "text", text: ctx.run.prompt }],
        model: ctx.task.model,
        effort: ctx.task.effort,
      });
      ctx.event({
        type: "provider_turn_started",
        payload: { turnId: started.turn.id },
      });
      this.turnId = started.turn.id;
      this.resolveReady();
      return await done;
    } catch (e) {
      this.rejectReady(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      await rpc.close();
    }
  }
  async steer(message: string) {
    await this.ready;
    if (!this.rpc || !this.threadId || !this.turnId)
      throw new OrchestratorError(
        "not_ready",
        "Provider turn has not started; retry with a new request ID after observing status",
      );
    await this.rpc.request("turn/steer", {
      threadId: this.threadId,
      expectedTurnId: this.turnId,
      input: [{ type: "text", text: message }],
    });
  }
  async interrupt() {
    if (this.rpc && this.turnId)
      await this.rpc.request("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.turnId,
      });
  }
  async close() {
    this.stopped = true;
    this.rejectReady(new Error("Provider stopped"));
    this.rejectRun?.(new Error("Provider stopped"));
    await this.rpc?.close();
  }
  static async models() {
    const rpc = new RpcProcess(
      process.env.ORCHESTRATOR_CODEX_BIN ?? "codex",
      args(),
    );
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "standalone_orchestrator", version: "0.1.0" },
      });
      rpc.send({ method: "initialized", params: {} });
      return await rpc.request("model/list", { includeHidden: true });
    } finally {
      await rpc.close();
    }
  }
}
