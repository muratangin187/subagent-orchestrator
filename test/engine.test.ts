import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import type { Driver, RunContext, Scope } from "../src/types.js";
const scope: Scope = {
  id: "parent-a",
  cwd: tmpdir(),
  ceiling: "read-only",
  interactionMode: "default",
};
const tick = () => new Promise((r) => setTimeout(r, 15));
class Fake implements Driver {
  context?: RunContext;
  resumedSession?: string;
  resolve?: (s: string) => void;
  reject?: (e: Error) => void;
  steers: string[] = [];
  run(ctx: RunContext) {
    this.resumedSession = ctx.task.sessionId;
    this.context = ctx;
    ctx.session("native-session");
    return new Promise<string>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  async steer(message: string) {
    this.steers.push(message);
  }
  async interrupt() {
    this.reject?.(new Error("Interrupted"));
  }
  async close() {
    this.reject?.(new Error("Stopped"));
  }
}
function setup(concurrency = 4) {
  const store = new Store(":memory:");
  const drivers: Fake[] = [];
  const engine = new Engine(
    store,
    () => {
      const f = new Fake();
      drivers.push(f);
      return f;
    },
    concurrency,
  );
  return {
    store,
    engine,
    drivers,
    async close() {
      await engine.close();
      store.close();
    },
  };
}
async function delegate(engine: Engine, extra: Record<string, unknown> = {}) {
  return (await engine.call(scope, "delegate_task", {
    task: "Test brief",
    ...extra,
  })) as any;
}

test("idempotency is atomic, scoped and rejects payload conflicts", async () => {
  const s = setup();
  try {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        delegate(s.engine, { clientRequestId: "same" }),
      ),
    );
    assert.equal(new Set(results.map((r) => r.taskId)).size, 1);
    const deadline = Date.now() + 5000;
    while (s.drivers.length === 0 && Date.now() < deadline) await tick();
    assert.equal(s.drivers.length, 1);
    await assert.rejects(
      delegate(s.engine, { clientRequestId: "same", task: "different" }),
      /different payload/,
    );
    const b = (await s.engine.call(
      { ...scope, id: "parent-b" },
      "delegate_task",
      { task: "Other", clientRequestId: "same" },
    )) as any;
    assert.notEqual(b.taskId, results[0].taskId);
    await assert.rejects(
      s.engine.call({ ...scope, id: "parent-b" }, "get_task_status", {
        taskId: results[0].taskId,
      }),
      /not found/,
    );
  } finally {
    await s.close();
  }
});
test("wait timeout leaves child alive; terminal result is immutable after follow-up", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine);
    await tick();
    const w = (await s.engine.wait(scope, t.taskId, 5)) as any;
    assert.equal(w.timedOut, true);
    assert.equal(w.status, "running");
    s.drivers[0]!.resolve!("first result");
    await tick();
    const first = s.store.run(t.runId);
    assert.equal(first.result, "first result");
    await s.engine.call(scope, "send_to_subagent", {
      taskId: t.taskId,
      message: "Continue",
      mode: "queue",
      clientRequestId: "next",
    });
    await tick();
    assert.equal(s.drivers.length, 2);
    assert.equal(s.drivers[1]!.context!.task.sessionId, "native-session");
    s.drivers[1]!.resolve!("second result");
    await tick();
    assert.deepEqual(s.store.run(t.runId), first);
    const old = (await s.engine.wait(scope, t.taskId, 1, t.runId)) as any;
    assert.equal(old.waitedRun.result, "first result");
    assert.equal(s.store.runs(t.taskId).length, 2);
  } finally {
    await s.close();
  }
});
test("queues remain FIFO and duplicate sends do not duplicate turns", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine);
    await tick();
    for (const message of ["one", "two"])
      await s.engine.call(scope, "send_to_subagent", {
        taskId: t.taskId,
        message,
        mode: "queue",
        clientRequestId: message,
      });
    await s.engine.call(scope, "send_to_subagent", {
      taskId: t.taskId,
      message: "one",
      mode: "queue",
      clientRequestId: "one",
    });
    await tick();
    assert.equal(s.drivers.length, 1);
    s.drivers[0]!.resolve!("done");
    await tick();
    assert.equal(s.drivers[1]!.context!.run.prompt, "one");
    s.drivers[1]!.resolve!("done");
    await tick();
    assert.equal(s.drivers[2]!.context!.run.prompt, "two");
  } finally {
    await s.close();
  }
});
test("steering does not create a new run", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine);
    await tick();
    await s.engine.call(scope, "send_to_subagent", {
      taskId: t.taskId,
      message: "Correction",
      mode: "steer",
    });
    await tick();
    assert.deepEqual(s.drivers[0]!.steers, ["Correction"]);
    assert.equal(s.store.runs(t.taskId).length, 1);
  } finally {
    await s.close();
  }
});
test("pending question ends wait, answer is scoped and stale answer fails", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine);
    await tick();
    const question = s.drivers[0]!.context!.question({ text: "Which file?" });
    const w = (await s.engine.wait(scope, t.taskId, 500)) as any;
    assert.equal(w.hasPendingQuestion, true);
    assert.equal(w.timedOut, false);
    await s.engine.call(scope, "answer_subagent", {
      taskId: t.taskId,
      questionId: w.question.id,
      answer: { file: { answers: ["a"] } },
      clientRequestId: "answer",
    });
    assert.deepEqual(await question, { file: { answers: ["a"] } });
    await s.engine.call(scope, "answer_subagent", {
      taskId: t.taskId,
      questionId: w.question.id,
      answer: { file: { answers: ["a"] } },
      clientRequestId: "answer",
    });
    await assert.rejects(
      s.engine.call(scope, "answer_subagent", {
        taskId: t.taskId,
        questionId: w.question.id,
        answer: { file: { answers: ["b"] } },
      }),
      /no longer active/,
    );
  } finally {
    await s.close();
  }
});
test("privilege ceilings and plan mode cannot be escalated", async () => {
  const s = setup();
  try {
    await assert.rejects(
      delegate(s.engine, { runtimeMode: "full-access" }),
      /ceiling/,
    );
    await assert.rejects(
      s.engine.call(
        {
          ...scope,
          id: "plan",
          ceiling: "full-access",
          interactionMode: "plan",
        },
        "delegate_task",
        { task: "hi", interactionMode: "default" },
      ),
      /ceiling/,
    );
    await assert.rejects(
      s.engine.call({ ...scope, ceiling: "full-access" }, "delegate_task", {
        task: "hi",
      }),
      /already bound/,
    );
  } finally {
    await s.close();
  }
});
test("cancel cascades, suppresses queued work and ignores late success", async () => {
  const s = setup();
  try {
    const parent = await delegate(s.engine);
    const child = await delegate(s.engine, { parentTaskId: parent.taskId });
    await tick();
    await s.engine.call(scope, "send_to_subagent", {
      taskId: child.taskId,
      message: "later",
      mode: "queue",
    });
    await s.engine.call(scope, "cancel_task", { taskId: parent.taskId });
    s.drivers[0]!.resolve!("late");
    await tick();
    assert.equal(s.store.task(child.taskId).status, "cancelled");
    assert.equal(s.store.run(parent.runId).result, undefined);
    assert.equal(s.drivers.length, 2);
    await assert.rejects(
      s.engine.call(scope, "send_to_subagent", {
        taskId: child.taskId,
        message: "resume",
      }),
      /Cancelled/,
    );
  } finally {
    await s.close();
  }
});
test("depth and per-depth concurrency limits", async () => {
  const s = setup(1);
  try {
    const one = await delegate(s.engine);
    const two = await delegate(s.engine, { parentTaskId: one.taskId });
    const three = await delegate(s.engine, { parentTaskId: two.taskId });
    await assert.rejects(
      delegate(s.engine, { parentTaskId: three.taskId }),
      /depth/,
    );
    const secondRoot = await delegate(s.engine, { task: "another root" });
    await tick();
    assert.equal(s.drivers.length, 3);
    assert.equal(s.store.task(secondRoot.taskId).status, "pending");
    s.drivers[0]!.resolve!("done");
    await tick();
    assert.equal(s.drivers.length, 4);
  } finally {
    await s.close();
  }
});
test("transcript cursors and notification cursors survive database reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ao-db-"));
  let store = new Store(join(dir, "state.sqlite"));
  const engine = new Engine(store, () => new Fake());
  const t = await delegate(engine);
  await tick();
  const task = store.task(t.taskId);
  store.event(task, "tool_result", { unicode: "Türkçe 🧪" });
  const page = store.events(t.taskId, 0, 2);
  const rest = store.events(t.taskId, page.nextOffset, 200);
  assert.ok(
    rest.messages.some((m) => (m.payload as any).unicode === "Türkçe 🧪"),
  );
  await engine.close();
  store.close();
  store = new Store(join(dir, "state.sqlite"));
  assert.equal(
    store.events(t.taskId, page.nextOffset, 200).messages[0]?.id,
    rest.messages[0]?.id,
  );
  assert.ok(store.notifications(scope.id, 0, 100).notifications.length);
  store.close();
  rmSync(dir, { recursive: true });
});
test("recovery never silently replays uncertain work; explicit continuation resumes session", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine);
    await tick();
    const task = s.store.task(t.taskId);
    const run = s.store.run(t.runId);
    await s.engine.close();
    task.status = "running";
    run.status = "running";
    s.store.saveTask(task);
    s.store.saveRun(run);
    const nextDrivers: Fake[] = [];
    const next = new Engine(s.store, () => {
      const f = new Fake();
      nextDrivers.push(f);
      return f;
    });
    next.recover();
    await tick();
    assert.equal(s.store.task(t.taskId).status, "recovery_required");
    assert.equal(nextDrivers.length, 0);
    await next.call(scope, "send_to_subagent", {
      taskId: t.taskId,
      message: "Continue after inspecting changes",
    });
    await tick();
    assert.equal(nextDrivers[0]!.context!.task.sessionId, "native-session");
    await next.close();
  } finally {
    s.store.close();
  }
});

test("old queued follow-ups are held after crash, never mistaken for recovery consent", async () => {
  const s = setup();
  const t = await delegate(s.engine);
  await tick();
  await s.engine.call(scope, "send_to_subagent", {
    taskId: t.taskId,
    message: "old queued work",
    mode: "queue",
  });
  const task = s.store.task(t.taskId);
  const run = s.store.run(t.runId);
  await s.engine.close();
  task.status = "running";
  run.status = "running";
  s.store.saveTask(task);
  s.store.saveRun(run);
  let starts = 0;
  const next = new Engine(s.store, () => {
    starts++;
    return new Fake();
  });
  next.recover();
  await tick();
  assert.equal(starts, 0);
  assert.equal(s.store.commands("held").length, 1);
  await next.close();
  s.store.close();
});
test("unsupported Claude steering fails before creating any command", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine, { provider: "claude" });
    await assert.rejects(
      s.engine.call(scope, "send_to_subagent", {
        taskId: t.taskId,
        message: "change",
        mode: "steer",
      }),
      /not native/,
    );
    assert.equal(s.store.commands("queued").length, 0);
  } finally {
    await s.close();
  }
});
test("interrupt and restart preserves session and original interrupted run", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine);
    await tick();
    await s.engine.call(scope, "send_to_subagent", {
      taskId: t.taskId,
      message: "new direction",
      mode: "interrupt_and_restart",
    });
    await tick();
    assert.equal(s.drivers.length, 2);
    assert.equal(s.drivers[1]!.context!.task.sessionId, "native-session");
    assert.equal(s.store.run(t.runId).status, "failed");
    assert.equal(s.store.runs(t.taskId)[1]!.prompt, "new direction");
  } finally {
    await s.close();
  }
});
test("wait on another task run is rejected and prompts are bounded", async () => {
  const s = setup();
  try {
    const a = await delegate(s.engine),
      b = await delegate(s.engine);
    await assert.rejects(
      s.engine.wait(scope, a.taskId, 0, b.runId),
      /Run not found/,
    );
    await assert.rejects(delegate(s.engine, { task: "x".repeat(64_001) }));
  } finally {
    await s.close();
  }
});
test("provider errors produce durable failure notifications and release capacity", async () => {
  const s = setup(1);
  try {
    const t = await delegate(s.engine);
    const second = await delegate(s.engine);
    await tick();
    s.drivers[0]!.reject!(new Error("rate limited"));
    await tick();
    assert.equal(s.store.task(t.taskId).status, "failed");
    assert.match(s.store.task(t.taskId).error!, /rate limited/);
    assert.equal(s.drivers.length, 2);
    assert.equal(s.drivers[1]!.context!.task.id, second.taskId);
    assert.equal(
      s.store.notifications(scope.id, 0, 100).notifications[0].status,
      "failed",
    );
  } finally {
    await s.close();
  }
});
test("shared writable tasks serialize on the same workspace", async () => {
  const s = setup();
  try {
    const writer = {
      ...scope,
      id: "writer",
      ceiling: "auto-accept-edits" as const,
    };
    for (let i = 0; i < 2; i++)
      await s.engine.call(writer, "delegate_task", { task: "edit" });
    await tick();
    assert.equal(s.drivers.length, 1);
    s.drivers[0]!.resolve!("done");
    await tick();
    assert.equal(s.drivers.length, 2);
  } finally {
    await s.close();
  }
});

test("invalid question answers preserve the pending question", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine);
    await tick();
    const pending = s.drivers[0]!.context!.question({
      questions: [{ id: "file" }],
    });
    void pending.catch(() => {});
    const q = s.store.task(t.taskId).question!;
    await assert.rejects(
      s.engine.call(scope, "answer_subagent", {
        taskId: t.taskId,
        questionId: q.id,
        answer: { file: "wrong schema" },
      }),
    );
    assert.equal(s.store.task(t.taskId).status, "waiting_question");
    assert.equal(s.store.task(t.taskId).question!.id, q.id);
  } finally {
    await s.close();
  }
});
test("list pagination does not lose tasks created in the same millisecond", async () => {
  const s = setup();
  try {
    for (let i = 0; i < 7; i++) await delegate(s.engine, { task: "task " + i });
    const seen = new Set<string>();
    let before: number | undefined;
    for (let i = 0; i < 5; i++) {
      const page = (await s.engine.call(scope, "list_tasks", {
        limit: 2,
        before,
      })) as any;
      for (const t of page.tasks) {
        assert.equal(seen.has(t.id), false);
        seen.add(t.id);
      }
      if (!page.tasks.length) break;
      before = page.nextCursor;
    }
    assert.equal(seen.size, 7);
  } finally {
    await s.close();
  }
});

test("quota failure notifies parent, holds queued work, preserves run evidence on explicit retry", async () => {
  const s = setup();
  try {
    const task = await delegate(s.engine, { provider: "claude" });
    await tick();
    await s.engine.call(scope, "send_to_subagent", {
      taskId: task.taskId,
      message: "queued work",
      mode: "queue",
      clientRequestId: "queued-before-limit",
    });
    s.drivers[0]!.reject!(
      new Error(
        "Claude HTTP 429: You've hit your session limit · resets 9:40pm (Europe/Istanbul)",
      ),
    );
    const result = (await s.engine.wait(scope, task.taskId, 1000)) as any;
    assert.equal(result.failure.kind, "usage_limit");
    assert.equal(result.failure.resetHint, "9:40pm (Europe/Istanbul)");
    const notices = (await s.engine.call(
      scope,
      "get_notifications",
      {},
    )) as any;
    assert.equal(notices.notifications.length, 1);
    assert.equal(notices.notifications[0].runId, task.runId);
    assert.deepEqual(notices.notifications[0].failure, result.failure);
    assert.equal(s.store.commands("held").length, 1);
    await tick();
    assert.equal(s.drivers.length, 1);
    const oldRun = s.store.run(task.runId);
    await s.engine.call(scope, "send_to_subagent", {
      taskId: task.taskId,
      message: "quota restored, continue",
      mode: "queue",
      clientRequestId: "explicit-retry",
    });
    await tick();
    assert.equal(s.drivers.length, 2);
    assert.equal(s.store.task(task.taskId).failure, undefined);
    assert.deepEqual(s.store.run(task.runId), oldRun);
  } finally {
    await s.close();
  }
});

test("assistant follow-up runs while a shared child is active, ordinary writers remain serialized", async () => {
  const s = setup();
  const writer = { ...scope, ceiling: "auto-accept-edits" as const };
  try {
    const parent = (await s.engine.call(writer, "delegate_task", {
      task: "coordinate",
    })) as any;
    const profile = s.store.task(parent.taskId);
    profile.conversationKind = "assistant";
    s.store.saveTask(profile);
    await tick();
    const childScope = {
      ...writer,
      id: `child:${parent.taskId}`,
      parentTaskId: parent.taskId,
    };
    const child = (await s.engine.call(childScope, "delegate_task", {
      task: "long edit",
      mode: "async",
    })) as any;
    await tick();
    assert.equal(s.store.task(child.taskId).status, "running");
    s.drivers[0]!.resolve!("Started in background");
    await tick();
    await s.engine.call(writer, "send_to_subagent", {
      taskId: parent.taskId,
      message: "new unrelated topic",
      mode: "queue",
    });
    await tick();
    await tick();
    assert.equal(s.store.task(parent.taskId).status, "running");
    assert.equal(s.store.task(child.taskId).status, "running");
    const sibling = (await s.engine.call(childScope, "delegate_task", {
      task: "another edit",
      mode: "async",
    })) as any;
    await tick();
    assert.equal(s.store.task(sibling.taskId).status, "pending");
    await assert.rejects(
      s.engine.call(childScope, "wait_for_task", { taskId: child.taskId }),
      /Assistant must delegate async/,
    );
  } finally {
    await s.close();
  }
});

test("provider handoff queues behind the active turn, preserves task and children, never cross-resumes native IDs", async () => {
  const s = setup();
  try {
    const t = await delegate(s.engine, { provider: "codex" });
    await tick();
    const parent = s.store.task(t.taskId);
    const originalSession = parent.sessionId;
    const c = (await s.engine.call(
      { ...scope, id: `child:${t.taskId}`, parentTaskId: t.taskId },
      "delegate_task",
      { task: "child" },
    )) as any;
    await tick();
    await s.engine.call(scope, "send_to_subagent", {
      taskId: t.taskId,
      message: "switch question",
      mode: "auto",
      selection: { provider: "claude", model: "test-claude", effort: "high" },
      clientRequestId: "switch-1",
    });
    assert.equal(s.store.task(t.taskId).provider, "codex");
    s.drivers[0]!.context!.event({
      type: "assistant_message",
      payload: { text: "Prior answer", id: "a" },
    });
    s.drivers[0]!.resolve!("Prior answer");
    await tick();
    await tick();
    const next = s.store.task(t.taskId);
    assert.equal(
      s.drivers.find(
        (d) => d.context?.task.id === t.taskId && d !== s.drivers[0],
      )!.resumedSession,
      undefined,
    );
    assert.equal(next.provider, "claude");
    assert.equal(next.effort, "high");
    assert.equal(s.store.task(c.taskId).parentTaskId, t.taskId);
    const handoff = s.store
      .events(t.taskId, 0, 200)
      .messages.find((e) => e.type === "provider_handoff")!;
    assert.equal(handoff.payload.previous.sessionId, originalSession);
    const prompt = s.store.run(next.runId).prompt;
    assert.match(prompt, /Prior answer/);
    assert.match(prompt, /child/);
    assert.equal(prompt.split("switch question").length - 1, 1);
    s.drivers.find(
      (d) => d.context?.task.id === t.taskId && d !== s.drivers[0],
    )!.resolve!("switched");
    await tick();
    await s.engine.call(scope, "send_to_subagent", {
      taskId: t.taskId,
      message: "same provider",
      mode: "queue",
      selection: { provider: "claude", model: "another-model" },
    });
    await tick();
    await tick();
    assert.equal(
      s.store
        .events(t.taskId, 0, 200)
        .messages.filter((e) => e.type === "provider_handoff").length,
      1,
    );
  } finally {
    await s.close();
  }
});

test("queued messages stay pending until explicitly promoted; promotion is idempotent", async () => {
  const s = setup();
  try {
    const task = await delegate(s.engine);
    await tick();
    const message: any = await s.engine.call(scope, "send_to_subagent", {
      taskId: task.taskId,
      message: "Queued correction",
      mode: "queue",
    });
    await tick();
    assert.deepEqual(s.drivers[0]!.steers, []);
    assert.equal(s.store.commands("queued").length, 1);
    const first = s.engine.steerQueuedMessage(
      scope,
      task.taskId,
      message.commandId,
      "promote-once",
    );
    assert.deepEqual(
      s.engine.steerQueuedMessage(
        scope,
        task.taskId,
        message.commandId,
        "promote-once",
      ),
      first,
    );
    await tick();
    assert.deepEqual(s.drivers[0]!.steers, ["Queued correction"]);
    assert.equal(s.store.commands("queued").length, 0);
    assert.equal(s.store.runs(task.taskId).length, 1);
    assert.throws(() =>
      s.engine.steerQueuedMessage(
        scope,
        task.taskId,
        message.commandId,
        "promote-stale",
      ),
    );
  } finally {
    await s.close();
  }
});
test("Claude queue promotion never interrupts or loses the queued message", async () => {
  const s = setup();
  try {
    const task = await delegate(s.engine, { provider: "claude" });
    await tick();
    const message: any = await s.engine.call(scope, "send_to_subagent", {
      taskId: task.taskId,
      message: "Wait for completion",
      mode: "queue",
    });
    assert.throws(() =>
      s.engine.steerQueuedMessage(
        scope,
        task.taskId,
        message.commandId,
        "unsupported",
      ),
    );
    assert.equal(s.store.commands("queued").length, 1);
    assert.deepEqual(s.drivers[0]!.steers, []);
  } finally {
    await s.close();
  }
});
