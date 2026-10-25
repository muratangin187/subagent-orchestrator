import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { schemas, type Tool } from "./schema.js";
import { ensureDaemon, rpc } from "./transport.js";
import { errorText, type Scope } from "./types.js";
const descriptions: Record<Tool, string> = {
  delegate_task:
    "Create a durable child session on Claude Code or Codex. Use a stable clientRequestId on retries. async returns immediately; wait times out without cancellation. Supply a self-contained brief; parent history is not copied.",
  send_to_subagent:
    "Continue the same child session. queue runs after current work; steer is Codex-only; interrupt_and_restart interrupts the current turn, then resumes the native session. Previous run results remain immutable. Call this when parent context changes.",
  get_task_status:
    "Read current task state, immutable run results and pending questions.",
  get_subagent_messages:
    "Read incremental normalized transcript events. Persist nextOffset; offsets are monotonic event IDs, not byte positions.",
  wait_for_task:
    "Wait at most 60 seconds for a specific run, completion or a pending question. A timeout never cancels work.",
  cancel_task:
    "Cancel task and parent-coordinated descendants; retain published results and transcripts. Cancelled tasks cannot resume.",
  list_tasks: "List tasks owned by this configured parent scope.",
  answer_subagent:
    "Answer the current question using its exact questionId. Codex answers map question IDs to {answers:[text]}; Claude answers map question text to answer text. This does not grant broader permissions.",
  get_notifications:
    "Read durable completion/failure/question notifications by cursor. For failure.kind usage_limit or rate_limit, report the provider and resetHint to the user; do not automatically retry. Check these while doing other work; standard MCP cannot wake every host automatically.",
  orchestrator_capabilities:
    "Read permissions, supported providers and exact steering/recovery semantics. Models are supplied by exact provider model ID; use the CLI models command for the live Codex catalog.",
};
export async function startMcp(home: string, scope: Scope) {
  await ensureDaemon(home);
  const server = new McpServer(
    { name: "standalone-agent-orchestrator", version: "0.1.0" },
    {
      instructions:
        "Use stable clientRequestId values for mutations. Check get_notifications when returning from independent work. Relay changes with send_to_subagent. Do not assume automatic parent transcript access or automatic wake-up. Read capabilities before delegation. Report usage_limit/rate_limit failures to the user, including resetHint when present. Do not retry until provider availability is restored; queued messages are held.",
    },
  );
  for (const name of Object.keys(schemas) as Tool[])
    server.registerTool(
      name,
      { description: descriptions[name], inputSchema: schemas[name].shape },
      async (args: unknown) => {
        try {
          const result = await rpc(home, "tool", {
            scope,
            tool: name,
            input: args,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  code: (e as { code?: string }).code ?? "error",
                  message: errorText(e),
                }),
              },
            ],
          };
        }
      },
    );
  await server.connect(new StdioServerTransport());
  return server;
}
