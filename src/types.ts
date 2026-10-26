export type Provider = "codex" | "claude";
export type RuntimeMode =
  "read-only" | "approval-required" | "auto-accept-edits" | "full-access";
export type Status =
  | "pending"
  | "running"
  | "waiting_question"
  | "waiting_children"
  | "completed"
  | "failed"
  | "cancelled"
  | "recovery_required";
export type SendMode = "auto" | "steer" | "queue" | "interrupt_and_restart";
export interface Scope {
  parentTaskId?: string;
  id: string;
  cwd: string;
  ceiling: RuntimeMode;
  interactionMode: "plan" | "default";
}
export interface ProviderFailure {
  kind: "usage_limit" | "rate_limit";
  provider: Provider;
  resetHint?: string;
  automaticRetry: false;
  action: "Wait for provider availability, then send an explicit continuation. Report this failure to the user.";
}
export interface ModelSelection {
  provider: Provider;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
}
export interface Task {
  deviceId?: string;
  conversationKind?: "assistant" | "session";
  instructions?: string;
  id: string;
  owner: string;
  rootOwner?: string;
  parentTaskId?: string;
  depth: number;
  provider: Provider;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  title: string;
  role: string;
  cwd: string;
  isolation?: "shared" | "worktree";
  sourceCwd?: string;
  baseCommit?: string;
  runtimeMode: RuntimeMode;
  interactionMode: "plan" | "default";
  sessionId?: string;
  status: Status;
  runId: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  failure?: ProviderFailure;
  resultSummary?: string;
  question?: { id: string; prompt: unknown };
  cancelled: boolean;
}
export interface Run {
  id: string;
  taskId: string;
  ordinal: number;
  status: Status;
  prompt: string;
  createdAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
  failure?: ProviderFailure;
}
export interface ProviderEvent {
  type: string;
  payload: unknown;
}
export interface RunContext {
  delegation?: { command: string; args: string[] };
  task: Task;
  run: Run;
  session(id: string): void;
  event(event: ProviderEvent): void;
  question(prompt: unknown): Promise<Record<string, unknown>>;
}
export interface Driver {
  run(context: RunContext): Promise<string>;
  steer(message: string): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
export type DriverFactory = (provider: Provider, task?: Task) => Driver;
export class OrchestratorError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}
export const terminal = (status: Status) =>
  ["completed", "failed", "cancelled", "recovery_required"].includes(status);
export const rank = (mode: RuntimeMode) =>
  ({
    "read-only": 0,
    "approval-required": 1,
    "auto-accept-edits": 2,
    "full-access": 3,
  })[mode];
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
