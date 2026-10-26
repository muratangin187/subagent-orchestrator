import type { Devices } from "./devices/registry.js";
import { classifyFailure } from "./providers/failure.js";
import { fileURLToPath } from "node:url";
import { providerCapabilities } from "./providers/capabilities.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { resolveCommit, prepareWorkspace, worktreePath } from "./workspace.js";
import { Store } from "./store.js";
import { schemas, type Tool, type DelegateInput } from "./schema.js";
import {
  OrchestratorError,
  rank,
  terminal,
  errorText,
  type Task,
  type Run,
  type Scope,
  type Driver,
  type DriverFactory,
} from "./types.js";

interface Active {
  driver: Driver;
  runId: string;
  finished: Promise<void>;
  resolve: () => void;
  question?: {
    id: string;
    resolve: (answer: Record<string, unknown>) => void;
    reject: (e: Error) => void;
  };
}
export class Engine {
  private active = new Map<string, Active>();
  private changes = new EventEmitter();
  private closing = false;
  private scheduled = false;
  constructor(
    readonly store: Store,
    private factory: DriverFactory,
    readonly maxConcurrency = 4,
    readonly maxDepth = 3,
    private runTimeoutMs = 30 * 60_000,
    private workspaceRoot?: string,
    readonly devices?: Devices,
  ) {
    this.changes.setMaxListeners(0);
  }
  recover() {
    this.store.transaction(() => {
      for (const t of this.store.tasks()) {
        if (
          ["running", "waiting_question", "waiting_children"].includes(t.status)
        ) {
          const r = this.store.run(t.runId);
          r.status = "recovery_required";
          r.error =
            "Service stopped during provider execution. Inspect transcript and send an explicit continuation; no work was replayed.";
          r.finishedAt = Date.now();
          this.store.saveRun(r);
          for (const c of this.store
            .commands("queued")
            .filter((c) => c.taskId === t.id))
            this.store.command(c.id, t.id, "held", c.data);
          t.status = r.status;
          t.error = r.error;
          delete t.question;
          this.store.saveTask(t);
          this.store.event(t, "recovery_required", { reason: r.error });
          this.store.notify(t);
        }
      }
      for (const cmd of this.store.commands("dispatching"))
        this.store.command(cmd.id, cmd.taskId, "uncertain", cmd.data);
    });
    this.schedule();
  }
  private owned(scope: Scope, id: string) {
    const t = this.store.task(id);
    let allowed =
      t.owner === scope.id || (!scope.parentTaskId && t.rootOwner === scope.id);
    if (scope.parentTaskId) {
      let ancestor = t.parentTaskId;
      for (let i = 0; i < this.maxDepth && ancestor; i++) {
        if (ancestor === scope.parentTaskId) {
          allowed = true;
          break;
        }
        ancestor = this.store.task(ancestor).parentTaskId;
      }
    }
    if (!allowed)
      throw new OrchestratorError(
        "not_found",
        "Task not found in this parent scope",
      );
    return t;
  }
  private touch(t: Task) {
    t.updatedAt = Date.now();
    this.store.saveTask(t);
    this.changes.emit(t.id);
  }
  status(scope: Scope, id: string) {
    const t = this.owned(scope, id);
    const runs = this.store.runs(id);
    return {
      ...t,
      runs: runs.map(({ prompt, ...r }) => r),
      children: this.store
        .tasks()
        .filter((c) => c.parentTaskId === id)
        .map((c) => ({ taskId: c.id, status: c.status, provider: c.provider })),
      hasPendingQuestion: !!t.question,
      hasPendingChildren: this.store
        .tasks()
        .some((c) => c.parentTaskId === id && !terminal(c.status)),
      pendingMessages: this.store
        .commands("queued")
        .filter((c) => c.taskId === id).length,
      deliveryIssues: [
        ...this.store.commands("uncertain"),
        ...this.store.commands("held"),
      ].filter((c) => c.taskId === id),
    };
  }
  async call(scope: Scope, tool: Tool, input: unknown): Promise<unknown> {
    if (scope.parentTaskId) {
      const parent = this.store.task(scope.parentTaskId);
      if (
        parent.conversationKind === "assistant" &&
        (tool === "wait_for_task" ||
          (tool === "delegate_task" && (input as any)?.mode === "wait"))
      )
        throw new OrchestratorError(
          "async_only",
          "Assistant must delegate async and end its turn. Child events are delivered automatically.",
        );
      if (scope.id !== `child:${parent.id}`)
        throw new OrchestratorError(
          "invalid_scope",
          "Child scope does not match its bound parent task",
        );
      scope = {
        id: scope.id,
        parentTaskId: parent.id,
        cwd: parent.cwd,
        ceiling: parent.runtimeMode,
        interactionMode: parent.interactionMode,
      };
      if (parent.cancelled)
        throw new OrchestratorError("cancelled", "Parent task was cancelled");
    }
    this.store.register(scope);
    const args = schemas[tool].parse(input);
    switch (tool) {
      case "delegate_task": {
        const a = schemas.delegate_task.parse(args);
        if (scope.parentTaskId) {
          if (a.parentTaskId && a.parentTaskId !== scope.parentTaskId)
            throw new OrchestratorError(
              "invalid_parent",
              "Child can only delegate under its own task",
            );
          a.parentTaskId = scope.parentTaskId;
        }
        const receipt = this.delegate(scope, a);
        this.schedule();
        return a.mode === "wait"
          ? this.waitAsParent(scope, receipt.taskId, a.timeoutMs, receipt.runId)
          : {
              ...receipt,
              ...this.status(scope, receipt.taskId),
              taskId: receipt.taskId,
            };
      }
      case "get_task_status":
        return this.status(scope, schemas.get_task_status.parse(args).taskId);
      case "list_tasks": {
        const a = schemas.list_tasks.parse(args);
        return this.store.list(scope.id, a.limit, a.before);
      }
      case "get_subagent_messages": {
        const a = schemas.get_subagent_messages.parse(args);
        this.owned(scope, a.taskId);
        return this.store.events(a.taskId, a.sinceOffset, a.limit);
      }
      case "wait_for_task": {
        const a = schemas.wait_for_task.parse(args);
        return this.waitAsParent(scope, a.taskId, a.timeoutMs, a.runId);
      }
      case "get_notifications": {
        const a = schemas.get_notifications.parse(args);
        return this.store.notifications(scope.id, a.sinceOffset, a.limit);
      }
      case "send_to_subagent": {
        const a = schemas.send_to_subagent.parse(args);
        this.owned(scope, a.taskId);
        const result = this.store.receipt(
          scope.id,
          tool,
          a.clientRequestId,
          a,
          () => {
            const t = this.store.task(a.taskId);
            if (t.cancelled)
              throw new OrchestratorError(
                "cancelled",
                "Cancelled tasks cannot be resumed. Delegate a new task.",
              );
            if (t.question && a.mode !== "interrupt_and_restart")
              throw new OrchestratorError(
                "pending_question",
                "Use answer_subagent with the current questionId",
              );
            if (a.mode === "steer" && t.provider !== "codex")
              throw new OrchestratorError(
                "unsupported",
                "Claude supports queue and interrupt_and_restart, not native steering",
              );
            const pending = this.store
              .commands("queued")
              .filter((c) => c.taskId === t.id).length;
            if (pending >= 100)
              throw new OrchestratorError(
                "queue_full",
                "Task already has 100 pending messages",
              );
            const commandId = randomUUID();
            this.store.command(commandId, t.id, "queued", {
              message: a.message,
              mode: a.mode,
            });
            this.store.event(t, "message_queued", {
              commandId,
              message: a.message,
              mode: a.mode,
            });
            return { taskId: t.id, commandId, accepted: true };
          },
        );
        this.schedule();
        return result;
      }
      case "cancel_task": {
        const a = schemas.cancel_task.parse(args);
        this.owned(scope, a.taskId);
        const result = this.store.receipt(
          scope.id,
          tool,
          a.clientRequestId,
          a,
          () => {
            const ids = new Set([a.taskId]);
            const tasks = this.store.tasks();
            for (let i = 0; i <= this.maxDepth; i++)
              for (const t of tasks)
                if (t.parentTaskId && ids.has(t.parentTaskId)) ids.add(t.id);
            for (const id of ids) {
              const t = this.store.task(id);
              t.cancelled = true;
              if (!terminal(t.status)) {
                const r = this.store.run(t.runId);
                r.status = "cancelled";
                r.finishedAt = Date.now();
                this.store.saveRun(r);
                t.status = "cancelled";
                delete t.question;
              }
              this.touch(t);
              this.store.event(t, "cancelled", {});
              this.store.notify(t);
              for (const c of this.store
                .commands("queued")
                .filter((c) => c.taskId === id))
                this.store.command(c.id, id, "cancelled", c.data);
            }
            return { taskId: a.taskId, cancelledTaskIds: [...ids] };
          },
        );
        for (const id of result.cancelledTaskIds) {
          const active = this.active.get(id);
          active?.question?.reject(new Error("Cancelled"));
          if (active) void active.driver.close().catch(() => {});
        }
        return result;
      }
      case "answer_subagent": {
        const a = schemas.answer_subagent.parse(args);
        this.owned(scope, a.taskId);
        const result = this.store.receipt(
          scope.id,
          tool,
          a.clientRequestId,
          a,
          () => {
            const t = this.store.task(a.taskId);
            const active = this.active.get(t.id);
            if (
              t.question?.id !== a.questionId ||
              active?.question?.id !== a.questionId
            )
              throw new OrchestratorError(
                "stale_question",
                "Question is no longer active",
              );
            const answerSchema =
              t.provider === "codex"
                ? z.record(
                    z.string(),
                    z
                      .object({
                        answers: z.array(z.string().max(64000)).min(1),
                      })
                      .strict(),
                  )
                : z.record(z.string(), z.string().max(64000));
            answerSchema.parse(a.answer);
            if (Buffer.byteLength(JSON.stringify(a.answer)) > 64000)
              throw new OrchestratorError(
                "invalid_input",
                "Answer exceeds 64 KiB",
              );
            this.store.event(t, "question_answered", {
              questionId: a.questionId,
              answer: a.answer,
            });
            delete t.question;
            t.status = "running";
            this.touch(t);
            return { taskId: t.id, questionId: a.questionId, accepted: true };
          },
        );
        const q = this.active.get(a.taskId)?.question;
        if (q?.id === a.questionId) {
          q.resolve(a.answer);
          delete this.active.get(a.taskId)!.question;
        }
        return result;
      }
      case "orchestrator_capabilities":
        return {
          version: 1,
          scope,
          providers: await providerCapabilities(),
          ...this.devices?.public(),
          maxConcurrencyPerDepth: this.maxConcurrency,
          maxProviderSessions: this.maxConcurrency * this.maxDepth,
          maxDepth: this.maxDepth,
          notifications: "durable cursor polling; wait_for_task",
          parentContext: "explicit messages only",
          recovery: "uncertain runs require explicit continuation",
          nestedDelegation:
            "scoped child MCP; children can delegate their own descendants",
        };
    }
  }
  private delegate(scope: Scope, a: DelegateInput) {
    return this.store.receipt(
      scope.id,
      "delegate_task",
      a.clientRequestId,
      a,
      () => {
        const parent = a.parentTaskId
          ? scope.parentTaskId === a.parentTaskId
            ? this.store.task(a.parentTaskId)
            : this.owned(scope, a.parentTaskId)
          : undefined;
        if (parent?.cancelled)
          throw new OrchestratorError("cancelled", "Parent task was cancelled");
        const depth = parent ? parent.depth + 1 : 1;
        if (depth > this.maxDepth)
          throw new OrchestratorError(
            "depth_exceeded",
            "Maximum delegation depth exceeded",
          );
        const provider = a.provider ?? parent?.provider ?? "codex";
        const model =
          a.model ?? (provider === parent?.provider ? parent.model : undefined);
        const effort =
          a.effort ??
          (provider === parent?.provider ? parent.effort : undefined);
        const ceiling = parent?.runtimeMode ?? scope.ceiling;
        const runtimeMode =
          a.runtimeMode === "inherit" ? ceiling : a.runtimeMode;
        const interactionMode =
          a.interactionMode === "inherit"
            ? (parent?.interactionMode ?? scope.interactionMode)
            : a.interactionMode;
        if (
          rank(runtimeMode) > rank(ceiling) ||
          ((parent?.interactionMode ?? scope.interactionMode) === "plan" &&
            interactionMode !== "plan")
        )
          throw new OrchestratorError(
            "privilege_escalation",
            "Child cannot exceed its parent permission ceiling",
          );
        if (
          this.store.tasks().filter((t) => !terminal(t.status)).length >= 1000
        )
          throw new OrchestratorError(
            "queue_full",
            "Global task queue is full",
          );
        const id = randomUUID(),
          runId = randomUUID(),
          now = Date.now();
        if (a.isolation === "worktree" && !this.workspaceRoot)
          throw new OrchestratorError(
            "unsupported",
            "Worktree root is not configured",
          );
        const deviceId =
          a.deviceId ?? parent?.deviceId ?? this.devices?.config.defaultId;
        const device = deviceId ? this.devices?.get(deviceId) : undefined;
        if (a.deviceId && !this.devices)
          throw Error("Device routing is not configured");
        const remote = this.devices?.remote(deviceId);
        const sourceCwd =
          a.cwd ??
          (parent && parent.deviceId === deviceId
            ? parent.cwd
            : !a.deviceId && !remote
              ? scope.cwd
              : (device?.cwd ?? scope.cwd));
        const baseCommit =
          a.isolation === "worktree" && !remote
            ? resolveCommit(sourceCwd)
            : undefined;
        const t: Task = {
          deviceId,
          isolation: a.isolation,
          sourceCwd,
          baseCommit,
          id,
          runId,
          owner: scope.id,
          rootOwner: parent?.rootOwner ?? parent?.owner ?? scope.id,
          parentTaskId: a.parentTaskId,
          depth,
          provider,
          model,
          effort,
          title: a.title ?? a.task.slice(0, 100),
          role: a.role,
          cwd:
            a.isolation === "worktree"
              ? worktreePath(
                  remote ? device!.cwd + "/.orchestrator" : this.workspaceRoot!,
                  id,
                )
              : sourceCwd,
          runtimeMode,
          interactionMode,
          status: "pending",
          createdAt: now,
          updatedAt: now,
          cancelled: false,
        };
        const r: Run = {
          id: runId,
          taskId: id,
          ordinal: 1,
          status: "pending",
          prompt: a.task,
          createdAt: now,
        };
        this.store.saveTask(t);
        this.store.saveRun(r);
        this.store.event(t, "task_created", { task: a.task });
        return { taskId: id, runId };
      },
    );
  }
  private childWaits = new Map<string, number>();
  private async waitAsParent(
    scope: Scope,
    id: string,
    timeoutMs: number,
    runId?: string,
  ) {
    this.owned(scope, id);
    const parentId = scope.parentTaskId;
    if (!parentId) return this.wait(scope, id, timeoutMs, runId);
    this.childWaits.set(parentId, (this.childWaits.get(parentId) ?? 0) + 1);
    const parent = this.store.task(parentId);
    if (parent.status === "running") {
      parent.status = "waiting_children";
      const run = this.store.run(parent.runId);
      run.status = "waiting_children";
      this.store.transaction(() => {
        this.store.saveRun(run);
        this.touch(parent);
        this.store.event(parent, "waiting_children", { taskId: id });
      });
      this.schedule();
    }
    try {
      return await this.wait(scope, id, timeoutMs, runId);
    } finally {
      const remaining = (this.childWaits.get(parentId) ?? 1) - 1;
      if (remaining) this.childWaits.set(parentId, remaining);
      else {
        this.childWaits.delete(parentId);
        const current = this.store.task(parentId);
        if (current.status === "waiting_children") {
          current.status = "running";
          const run = this.store.run(current.runId);
          run.status = "running";
          this.store.transaction(() => {
            this.store.saveRun(run);
            this.touch(current);
          });
        }
      }
    }
  }
  async wait(scope: Scope, id: string, timeoutMs: number, runId?: string) {
    this.owned(scope, id);
    const target = runId ?? this.store.task(id).runId;
    if (this.store.run(target).taskId !== id)
      throw new OrchestratorError("not_found", "Run not found in task");
    const settled = () =>
      this.closing ||
      terminal(this.store.run(target).status) ||
      this.store.run(target).status === "waiting_question";
    if (!settled() && timeoutMs > 0)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.changes.off(id, check);
          resolve();
        };
        const check = () => {
          if (settled()) done();
        };
        const timer = setTimeout(done, timeoutMs);
        this.changes.on(id, check);
        check();
      });
    return {
      ...this.status(scope, id),
      taskId: id,
      waitedRun: this.store.run(target),
      timedOut: !settled(),
    };
  }
  private schedule() {
    if (this.closing || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.pump().catch((e) => console.error("Scheduler:", errorText(e)));
    });
  }
  private processing = new Set<string>();
  private async pump() {
    if (this.closing) return;
    for (const cmd of this.store.commands("queued")) {
      if (this.processing.has(cmd.taskId)) continue;
      const t = this.store.task(cmd.taskId);
      if (t.cancelled || t.status === "recovery_required") continue;
      const active = this.active.get(t.id);
      if (
        active &&
        (cmd.data.mode === "queue" ||
          (cmd.data.mode === "auto" && t.provider !== "codex"))
      )
        continue;
      if (!active && !terminal(t.status)) continue;
      this.processing.add(t.id);
      void this.processCommand(cmd).finally(() => {
        this.processing.delete(t.id);
        this.schedule();
      });
    }
    for (const t of this.store.tasks()) {
      if (
        [...this.active.keys()].filter(
          (id) => this.store.task(id).depth === t.depth,
        ).length >= this.maxConcurrency
      )
        continue;
      if (
        t.runtimeMode !== "read-only" &&
        [...this.active.keys()].some((id) => {
          const other = this.store.task(id);
          return other.cwd === t.cwd && other.status !== "waiting_children";
        })
      )
        continue;
      if (
        t.status === "pending" &&
        !t.cancelled &&
        !this.active.has(t.id) &&
        !this.processing.has(t.id)
      )
        this.start(t);
    }
    // Explicit follow-ups are also the recovery acknowledgement.
    for (const cmd of this.store.commands("queued"))
      if (
        this.store.task(cmd.taskId).status === "recovery_required" &&
        !this.processing.has(cmd.taskId)
      ) {
        this.processing.add(cmd.taskId);
        void this.processCommand(cmd).finally(() => {
          this.processing.delete(cmd.taskId);
          this.schedule();
        });
      }
  }
  private async processCommand(cmd: {
    id: string;
    taskId: string;
    data: { message: string; mode: string };
  }) {
    this.store.command(cmd.id, cmd.taskId, "dispatching", cmd.data);
    try {
      const active = this.active.get(cmd.taskId);
      if (active && cmd.data.mode !== "interrupt_and_restart") {
        await active.driver.steer(cmd.data.message);
        this.store.event(this.store.task(cmd.taskId), "steered", {
          commandId: cmd.id,
          message: cmd.data.message,
        });
      } else {
        if (active) {
          active.question?.reject(new Error("Interrupted"));
          await active.driver.interrupt();
          await active.driver.close();
          await active.finished;
        }
        const t = this.store.task(cmd.taskId);
        if (t.cancelled) {
          this.store.command(cmd.id, t.id, "cancelled", cmd.data);
          return;
        }
        const r: Run = {
          id: randomUUID(),
          taskId: t.id,
          ordinal: this.store.runs(t.id).length + 1,
          status: "pending",
          prompt: cmd.data.message,
          createdAt: Date.now(),
        };
        this.store.transaction(() => {
          t.runId = r.id;
          t.status = "pending";
          delete t.question;
          delete t.error;
          delete t.failure;
          delete t.resultSummary;
          this.store.saveRun(r);
          this.touch(t);
          this.store.event(t, "user_message", {
            message: cmd.data.message,
            commandId: cmd.id,
          });
          this.store.command(cmd.id, t.id, "completed", cmd.data);
        });
      }
      this.store.command(cmd.id, cmd.taskId, "completed", cmd.data);
    } catch (e) {
      this.store.command(cmd.id, cmd.taskId, "uncertain", {
        ...cmd.data,
        error: errorText(e),
      });
      const t = this.store.task(cmd.taskId);
      this.store.event(t, "command_failed", {
        commandId: cmd.id,
        error: errorText(e),
      });
      this.store.notify({
        ...t,
        error: `Message delivery failed or uncertain: ${errorText(e)}`,
      });
    }
  }
  private start(task: Task) {
    const driver = this.factory(task.provider, task);
    let resolve!: () => void;
    const finished = new Promise<void>((r) => (resolve = r));
    const active: Active = { driver, runId: task.runId, finished, resolve };
    this.active.set(task.id, active);
    task.status = "running";
    const run = this.store.run(task.runId);
    run.status = "running";
    this.store.transaction(() => {
      this.store.saveRun(run);
      this.touch(task);
      this.store.event(task, "run_started", {});
    });
    const timer = setTimeout(() => {
      void driver.close().catch(() => {});
    }, this.runTimeoutMs);
    void (async () => {
      try {
        if (!this.devices?.remote(task.deviceId)) await prepareWorkspace(task);
        if (this.store.task(task.id).cancelled) throw new Error("Cancelled");
        const result = await driver.run({
          task,
          run,
          delegation:
            this.workspaceRoot && task.depth < this.maxDepth
              ? {
                  command: process.execPath,
                  args: [
                    fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
                    "mcp",
                    "--home",
                    this.workspaceRoot,
                    "--cwd",
                    task.cwd,
                    "--parent",
                    `child:${task.id}`,
                    "--task",
                    task.id,
                  ],
                }
              : undefined,
          session: (id) => {
            const t = this.store.task(task.id);
            t.sessionId = id;
            this.touch(t);
          },
          event: (e) => {
            if (e.type === "device_workspace") {
              const current = this.store.task(task.id);
              Object.assign(current, e.payload);
              this.store.saveTask(current);
            }
            this.store.event(this.store.task(task.id), e.type, e.payload);
          },
          question: (prompt) =>
            new Promise((resolve, reject) => {
              const t = this.store.task(task.id);
              if (t.cancelled) {
                reject(new Error("Cancelled"));
                return;
              }
              const id = randomUUID();
              active.question = {
                id,
                resolve: (answer) => {
                  const r = this.store.run(run.id);
                  r.status = "running";
                  this.store.saveRun(r);
                  resolve(answer);
                },
                reject,
              };
              t.question = { id, prompt };
              t.status = "waiting_question";
              const r = this.store.run(run.id);
              r.status = "waiting_question";
              this.store.transaction(() => {
                this.store.saveRun(r);
                this.touch(t);
                this.store.event(t, "question", { id, prompt });
                this.store.notify(t);
              });
            }),
        });
        this.finish(task.id, run.id, "completed", result);
      } catch (e) {
        this.finish(
          task.id,
          run.id,
          errorText(e).startsWith("REMOTE_UNCERTAIN:")
            ? "recovery_required"
            : "failed",
          undefined,
          errorText(e),
        );
      } finally {
        clearTimeout(timer);
        await driver.close().catch(() => {});
        this.active.delete(task.id);
        resolve();
        this.schedule();
      }
    })();
  }
  private finish(
    id: string,
    runId: string,
    status: "completed" | "failed" | "recovery_required",
    result?: string,
    error?: string,
  ) {
    const t = this.store.task(id),
      r = this.store.run(runId);
    if (terminal(r.status)) return;
    if (result && result.length > 128_000)
      result =
        result.slice(0, 128_000) +
        "\n[Result truncated at 128000 characters; inspect native provider transcript for full content.]";
    r.status = status;
    r.result = result;
    r.error = error;
    r.failure = classifyFailure(t.provider, error);
    r.finishedAt = Date.now();
    t.status = status;
    if (result !== undefined) t.resultSummary = result;
    t.error = error;
    t.failure = r.failure;
    delete t.question;
    this.store.transaction(() => {
      this.store.saveRun(r);
      this.touch(t);
      if (t.failure) {
        for (const cmd of this.store
          .commands("queued")
          .filter((c) => c.taskId === t.id))
          this.store.command(cmd.id, t.id, "held", cmd.data);
      }
      this.store.event(t, status, { result, error, failure: t.failure });
      this.store.notify(t);
    });
  }
  async close() {
    this.closing = true;
    for (const t of this.store.tasks()) this.changes.emit(t.id);
    for (const a of this.active.values()) {
      a.question?.reject(new Error("Service stopping"));
      await a.driver.close().catch(() => {});
    }
    await Promise.all([...this.active.values()].map((a) => a.finished));
  }
}
