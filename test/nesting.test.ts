import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { Engine } from "../src/engine.js";
import { Store } from "../src/store.js";
import type { Scope, RunContext, Driver } from "../src/types.js";
const root: Scope = {
  id: "root",
  cwd: tmpdir(),
  ceiling: "auto-accept-edits",
  interactionMode: "default",
};
const scopeFor = (id: string): Scope => ({
  ...root,
  id: `child:${id}`,
  parentTaskId: id,
});
const pause = () => new Promise((r) => setTimeout(r, 20));
class Fake implements Driver {
  ctx?: RunContext;
  resolve?: (s: string) => void;
  reject?: (e: Error) => void;
  run(c: RunContext) {
    this.ctx = c;
    c.session("native-" + c.task.id);
    return new Promise<string>((r, j) => {
      this.resolve = r;
      this.reject = j;
    });
  }
  async steer() {}
  async interrupt() {
    this.reject?.(new Error("interrupt"));
  }
  async close() {
    this.reject?.(new Error("stop"));
  }
}
function setup() {
  const store = new Store(":memory:");
  const drivers: Fake[] = [];
  const engine = new Engine(
    store,
    () => {
      const d = new Fake();
      drivers.push(d);
      return d;
    },
    1,
    3,
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
test("child is a parent: inherited scope, grandchild result, separate depth pools avoid deadlock", async () => {
  const s = setup();
  try {
    const job = (await s.engine.call(root, "delegate_task", {
      task: "Job",
    })) as any;
    await pause();
    const childScope = scopeFor(job.taskId);
    const waiting = s.engine.call(childScope, "delegate_task", {
      task: "Test the job",
      provider: "claude",
      mode: "wait",
      timeoutMs: 1000,
    });
    await pause();
    assert.equal(s.store.task(job.taskId).status, "waiting_children");
    assert.equal(
      s.drivers.length,
      2,
      "child must run while its parent occupies depth 1",
    );
    const child = s.drivers[1]!.ctx!.task;
    assert.equal(child.parentTaskId, job.taskId);
    assert.equal(child.owner, childScope.id);
    assert.equal(child.runtimeMode, "auto-accept-edits");
    const grandWait = s.engine.call(scopeFor(child.id), "delegate_task", {
      task: "Check fixture",
      mode: "wait",
      timeoutMs: 1000,
    });
    await pause();
    assert.equal(s.drivers.length, 3);
    const grand = s.drivers[2]!.ctx!.task;
    s.drivers[2]!.resolve!("fixture passed");
    const grandResult = (await grandWait) as any;
    assert.equal(grandResult.resultSummary, "fixture passed");
    s.drivers[1]!.resolve!("test passed");
    const result = (await waiting) as any;
    assert.equal(result.resultSummary, "test passed");
    assert.equal(s.store.task(job.taskId).status, "running");
    assert.equal(
      (
        (await s.engine.call(root, "get_task_status", {
          taskId: grand.id,
        })) as any
      ).status,
      "completed",
    );
  } finally {
    await s.close();
  }
});
test("child cannot see siblings, escape ancestry or increase inherited permissions", async () => {
  const s = setup();
  try {
    const a = (await s.engine.call(root, "delegate_task", {
      task: "A",
      runtimeMode: "read-only",
    })) as any;
    const b = (await s.engine.call(root, "delegate_task", {
      task: "B",
    })) as any;
    const child = scopeFor(a.taskId);
    await assert.rejects(
      s.engine.call(child, "get_task_status", { taskId: b.taskId }),
      /not found/,
    );
    await assert.rejects(
      s.engine.call(child, "delegate_task", {
        task: "escape",
        parentTaskId: b.taskId,
      }),
      /own task/,
    );
    await assert.rejects(
      s.engine.call({ ...child, ceiling: "full-access" }, "delegate_task", {
        task: "escalate",
        runtimeMode: "full-access",
      }),
      /ceiling/,
    );
    await assert.rejects(
      s.engine.call({ ...child, id: "forged" }, "delegate_task", {
        task: "forged",
      }),
      /bound parent/,
    );
    const c = (await s.engine.call(child, "delegate_task", {
      task: "child",
    })) as any;
    await s.engine.call(root, "cancel_task", { taskId: a.taskId });
    assert.equal(s.store.task(c.taskId).cancelled, true);
    await assert.rejects(
      s.engine.call(child, "delegate_task", { task: "after cancel" }),
      /cancelled/,
    );
  } finally {
    await s.close();
  }
});
test("nested notifications belong to their calling parent and depth cannot be bypassed", async () => {
  const s = setup();
  try {
    const a = (await s.engine.call(root, "delegate_task", {
      task: "A",
      runtimeMode: "read-only",
    })) as any;
    const b = (await s.engine.call(scopeFor(a.taskId), "delegate_task", {
      task: "B",
    })) as any;
    const c = (await s.engine.call(scopeFor(b.taskId), "delegate_task", {
      task: "C",
    })) as any;
    await assert.rejects(
      s.engine.call(scopeFor(c.taskId), "delegate_task", { task: "D" }),
      /depth/,
    );
    await pause();
    s.drivers.find((d) => d.ctx?.task.id === c.taskId)!.resolve!("C result");
    await pause();
    const own = (await s.engine.call(
      scopeFor(b.taskId),
      "get_notifications",
      {},
    )) as any;
    assert.equal(own.notifications[0].taskId, c.taskId);
    const outer = (await s.engine.call(root, "get_notifications", {})) as any;
    assert.equal(outer.notifications.length, 0);
  } finally {
    await s.close();
  }
});

test("three jobs can all wait while their three children execute", async () => {
  const store = new Store(":memory:");
  const drivers: Fake[] = [];
  const engine = new Engine(
    store,
    () => {
      const d = new Fake();
      drivers.push(d);
      return d;
    },
    3,
    3,
  );
  try {
    const jobs = [];
    for (let i = 0; i < 3; i++)
      jobs.push(
        (await engine.call({ ...root, ceiling: "read-only" }, "delegate_task", {
          task: `Job ${i}`,
        })) as any,
      );
    await pause();
    assert.equal(drivers.length, 3);
    const waits = jobs.map((job) =>
      engine.call(scopeFor(job.taskId), "delegate_task", {
        task: "Test child",
        mode: "wait",
        timeoutMs: 1000,
      }),
    );
    await pause();
    assert.equal(drivers.length, 6);
    for (const driver of drivers.filter((d) => d.ctx!.task.depth === 2))
      driver.resolve!("tested");
    const results = (await Promise.all(waits)) as any[];
    assert.ok(results.every((r) => r.status === "completed"));
  } finally {
    await engine.close();
    store.close();
  }
});
test("nested model and provider inherit only within the same provider", async () => {
  const s = setup();
  try {
    const parent = (await s.engine.call(root, "delegate_task", {
      task: "parent",
      provider: "claude",
      model: "custom-claude",
      effort: "high",
    })) as any;
    const inherited = (await s.engine.call(
      scopeFor(parent.taskId),
      "delegate_task",
      { task: "inherit" },
    )) as any;
    assert.equal(inherited.provider, "claude");
    assert.equal(inherited.model, "custom-claude");
    assert.equal(inherited.effort, "high");
    const other = (await s.engine.call(
      scopeFor(parent.taskId),
      "delegate_task",
      { task: "other", provider: "codex" },
    )) as any;
    assert.equal(other.provider, "codex");
    assert.equal(other.model, undefined);
  } finally {
    await s.close();
  }
});
