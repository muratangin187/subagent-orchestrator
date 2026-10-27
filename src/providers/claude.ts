import { SESSION_LINK_INSTRUCTIONS } from "../workspace/session-links.js";
import { VISUAL_INSTRUCTIONS } from "../workspace/visuals.js";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { providerEnvironment } from "./process.js";
import { OrchestratorError, type Driver, type RunContext } from "../types.js";
export async function isWithinWorkspace(root: string, path: unknown) {
  if (typeof path !== "string") return false;
  try {
    root = await realpath(root);
  } catch {
    return false;
  }
  let resolved = resolve(root, path);
  try {
    resolved = await realpath(resolved);
  } catch {
    try {
      resolved = resolve(
        await realpath(dirname(resolved)),
        resolved.split(/[\\/]/).at(-1)!,
      );
    } catch {
      return false;
    }
  }
  const r = relative(root, resolved);
  return r !== ".." && !r.startsWith("../") && !isAbsolute(r);
}
export function readClaudeSuccess(message: {
  is_error: boolean;
  result: string;
  api_error_status?: number | null;
}): string {
  if (message.is_error)
    throw new OrchestratorError(
      "provider_error",
      `Claude${message.api_error_status ? " HTTP " + message.api_error_status : ""}: ${message.result}`,
    );
  return message.result;
}
export class ClaudeDriver implements Driver {
  private current?: Query;
  private abort = new AbortController();
  async run(ctx: RunContext): Promise<string> {
    const effort = ctx.task.effort;
    if (effort === "ultra") throw Error("Claude does not support ultra effort");
    const readOnly =
      ctx.task.interactionMode === "plan" ||
      ctx.task.runtimeMode === "read-only" ||
      ctx.task.runtimeMode === "approval-required";
    const full = ctx.task.runtimeMode === "full-access" && !readOnly;
    const tools = [
      "Read",
      "Glob",
      "Grep",
      "AskUserQuestion",
      ...(!readOnly ? ["Write", "Edit"] : []),
      ...(full ? ["Bash", "WebSearch", "WebFetch"] : []),
    ];
    const q = (this.current = query({
      prompt: ctx.run.prompt,
      options: {
        cwd: ctx.task.cwd,
        model: ctx.task.model,
        effort,
        resume: ctx.task.sessionId,
        abortController: this.abort,
        pathToClaudeCodeExecutable:
          process.env.ORCHESTRATOR_CLAUDE_BIN ?? "claude",
        env: providerEnvironment(),
        settingSources: [],
        mcpServers: ctx.delegation
          ? { standalone_children: { type: "stdio", ...ctx.delegation } }
          : {},
        systemPrompt:
          (ctx.task.instructions ??
            "You are a delegated agent. " +
              (ctx.delegation
                ? "You can delegate subtasks using standalone_children MCP tools. The server automatically binds children to your task. Wait for child results before reporting a combined outcome. Use only this MCP for delegation; never native agent tools or shell-spawned agents."
                : "Delegation depth limit reached. Do not spawn further agents.")) +
          (ctx.delegation ? "\n" + VISUAL_INSTRUCTIONS : "") + "\n" + SESSION_LINK_INSTRUCTIONS,
        tools,
        disallowedTools: ["Agent", "Task", "Skill", "EnterWorktree"],
        permissionMode: "default",
        persistSession: true,
        includePartialMessages: true,
        maxTurns: 100,
        canUseTool: async (name, input) => {
          if (ctx.delegation && name.startsWith("mcp__standalone_children__"))
            return { behavior: "allow", updatedInput: input };
          if (name === "AskUserQuestion") {
            const answer = await ctx.question({ kind: "question", ...input });
            return {
              behavior: "allow",
              updatedInput: { ...input, answers: answer },
            };
          }
          if (["Read", "Glob", "Grep"].includes(name))
            return { behavior: "allow", updatedInput: input };
          if (
            !readOnly &&
            ["Write", "Edit"].includes(name) &&
            (full || (await isWithinWorkspace(ctx.task.cwd, input.file_path)))
          )
            return { behavior: "allow", updatedInput: input };
          if (full && ["Bash", "WebSearch", "WebFetch"].includes(name))
            return { behavior: "allow", updatedInput: input };
          ctx.event({ type: "permission_denied", payload: { tool: name } });
          return {
            behavior: "deny",
            message: "Tool exceeds delegated permission ceiling",
          };
        },
      },
    }));
    let final = "";
    let streamMessageId = "";
    try {
      for await (const message of q) {
        if ("session_id" in message && typeof message.session_id === "string")
          ctx.session(message.session_id);
        if (message.type === "assistant") {
          ctx.event({ type: "assistant_message", payload: message.message });
          const content = message.message.content;
          final =
            content
              .filter((b) => b.type === "text")
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("\n") || final;
        } else if (message.type === "user")
          ctx.event({ type: "tool_result", payload: message.message });
        else if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "message_start")
            streamMessageId = event.message.id;
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "thinking_delta"
          )
            ctx.event({
              type: "reasoning_summary",
              payload: {
                itemId: streamMessageId + ":thinking:" + event.index,
                text: event.delta.thinking,
              },
            });
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "tool_use"
          )
            ctx.event({
              type: "tool_started",
              payload: {
                id: event.content_block.id,
                type: "mcpToolCall",
                tool: event.content_block.name,
              },
            });
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          )
            ctx.event({
              type: "assistant_delta",
              payload: { itemId: streamMessageId, text: event.delta.text },
            });
        } else if (message.type === "result") {
          if (message.subtype === "success")
            return readClaudeSuccess(message) || final;
          throw new Error(
            `Claude ${message.subtype}: ${message.errors.join("; ")}`,
          );
        }
      }
      throw new Error("Claude stream ended without a result");
    } finally {
      q.close();
    }
  }
  async steer(): Promise<void> {
    throw new OrchestratorError(
      "unsupported",
      "Use queue or interrupt_and_restart for Claude",
    );
  }
  async interrupt() {
    await this.current?.interrupt();
  }
  async close() {
    this.abort.abort();
    this.current?.close();
  }
}
