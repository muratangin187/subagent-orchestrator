import { z } from "zod";
const key = z.string().min(1).max(200);
const text = z.string().trim().min(1).max(64_000);
export const runtime = z.enum([
  "read-only",
  "approval-required",
  "auto-accept-edits",
  "full-access",
]);
const taskId = z.string().uuid();
const request = { clientRequestId: key.optional() };
export const delegateSchema = z
  .object({
    isolation: z.enum(["shared", "worktree"]).default("shared"),
    task: text,
    provider: z.enum(["claude", "codex"]).optional(),
    model: key.optional(),
    effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    title: z.string().max(200).optional(),
    role: z
      .enum([
        "implementation",
        "research",
        "review",
        "design",
        "test",
        "general",
      ])
      .default("general"),
    mode: z.enum(["async", "wait"]).default("async"),
    timeoutMs: z.number().int().min(0).max(60_000).default(30_000),
    runtimeMode: runtime.or(z.literal("inherit")).default("inherit"),
    interactionMode: z.enum(["inherit", "plan", "default"]).default("inherit"),
    parentTaskId: taskId.optional(),
    ...request,
  })
  .strict();
export const schemas = {
  delegate_task: delegateSchema,
  send_to_subagent: z
    .object({
      taskId,
      message: text,
      mode: z
        .enum(["auto", "steer", "queue", "interrupt_and_restart"])
        .default("auto"),
      ...request,
    })
    .strict(),
  get_task_status: z.object({ taskId }).strict(),
  get_subagent_messages: z
    .object({
      taskId,
      sinceOffset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(100),
    })
    .strict(),
  wait_for_task: z
    .object({
      taskId,
      runId: z.string().uuid().optional(),
      timeoutMs: z.number().int().min(0).max(60_000).default(30_000),
    })
    .strict(),
  cancel_task: z.object({ taskId, ...request }).strict(),
  list_tasks: z
    .object({
      limit: z.number().int().min(1).max(200).default(100),
      before: z.number().int().positive().optional(),
    })
    .strict(),
  answer_subagent: z
    .object({
      taskId,
      questionId: z.string().uuid(),
      answer: z.record(z.string(), z.unknown()),
      ...request,
    })
    .strict(),
  get_notifications: z
    .object({
      sinceOffset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(100),
    })
    .strict(),
  orchestrator_capabilities: z.object({}).strict(),
};
export type Tool = keyof typeof schemas;
export type DelegateInput = z.infer<typeof delegateSchema>;
