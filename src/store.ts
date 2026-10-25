import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import type { Task, Run, Scope } from "./types.js";
import { OrchestratorError } from "./types.js";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      if (path !== ":memory:") chmodSync(path, 0o600);
      this.db
        .exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(version INTEGER NOT NULL);
      INSERT INTO meta SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM meta);
      CREATE TABLE IF NOT EXISTS daemon_owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1), pid INTEGER NOT NULL, nonce TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scopes(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, parent_id TEXT, status TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS task_owner ON tasks(owner,created);
      CREATE INDEX IF NOT EXISTS task_parent ON tasks(parent_id);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), ordinal INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(task_id,ordinal));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS event_task ON events(task_id,id);
      CREATE TABLE IF NOT EXISTS receipts(owner TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,operation,key));
      CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS notification_owner ON notifications(owner,id);
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
    `);
      const version = this.db.prepare("SELECT version FROM meta").get() as {
        version: number;
      };
      if (version.version !== 1)
        throw new Error(`Unsupported database version ${version.version}`);
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  claimDaemon(pid: number, nonce: string) {
    this.transaction(() => {
      const owner = this.db
        .prepare("SELECT pid FROM daemon_owner WHERE singleton=1")
        .get() as { pid: number } | undefined;
      if (owner) {
        try {
          process.kill(owner.pid, 0);
          throw new Error(`Daemon lock is held by live PID ${owner.pid}`);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
        }
      }
      this.db
        .prepare(
          "INSERT INTO daemon_owner VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET pid=excluded.pid,nonce=excluded.nonce",
        )
        .run(pid, nonce);
    });
  }
  releaseDaemon(nonce: string) {
    this.db
      .prepare("DELETE FROM daemon_owner WHERE singleton=1 AND nonce=?")
      .run(nonce);
  }
  register(scope: Scope) {
    const row = this.db
      .prepare("SELECT data FROM scopes WHERE id=?")
      .get(scope.id) as { data: string } | undefined;
    if (row && canonical(JSON.parse(row.data)) !== canonical(scope))
      throw new OrchestratorError(
        "scope_conflict",
        "This parent ID is already bound to another workspace or permission ceiling",
      );
    this.db
      .prepare("INSERT OR IGNORE INTO scopes VALUES(?,?)")
      .run(scope.id, JSON.stringify(scope));
  }
  task(id: string): Task {
    const row = this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new OrchestratorError("not_found", "Task not found");
    return JSON.parse(row.data);
  }
  saveTask(t: Task) {
    this.db
      .prepare(
        "INSERT INTO tasks VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data",
      )
      .run(
        t.id,
        t.owner,
        t.parentTaskId ?? null,
        t.status,
        t.createdAt,
        JSON.stringify(t),
      );
  }
  saveRun(r: Run) {
    this.db
      .prepare(
        "INSERT INTO runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(r.id, r.taskId, r.ordinal, JSON.stringify(r));
  }
  run(id: string): Run {
    const row = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new OrchestratorError("not_found", "Run not found");
    return JSON.parse(row.data);
  }
  runs(id: string): Run[] {
    return (
      this.db
        .prepare("SELECT data FROM runs WHERE task_id=? ORDER BY ordinal")
        .all(id) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  tasks(): Task[] {
    return (
      this.db.prepare("SELECT data FROM tasks ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data));
  }
  list(owner: string, limit: number, before?: number) {
    const rows = this.db
      .prepare(
        "SELECT rowid AS cursor,data FROM tasks WHERE owner=? AND rowid<? ORDER BY rowid DESC LIMIT ?",
      )
      .all(owner, before ?? Number.MAX_SAFE_INTEGER, limit) as {
      cursor: number;
      data: string;
    }[];
    return {
      tasks: rows.map((r) => JSON.parse(r.data) as Task),
      nextCursor: rows.at(-1)?.cursor ?? null,
    };
  }
  event(task: Task, type: string, payload: unknown) {
    let data = JSON.stringify(payload) ?? "null";
    if (Buffer.byteLength(data) > 128_000)
      data = JSON.stringify({
        truncated: true,
        preview: data.slice(0, 24_000),
      });
    this.db
      .prepare(
        "INSERT INTO events(task_id,run_id,type,data,created) VALUES(?,?,?,?,?)",
      )
      .run(task.id, task.runId, type, data, Date.now());
  }
  events(id: string, offset: number, limit: number) {
    const rows = this.db
      .prepare(
        "SELECT id,run_id AS runId,type,data,created FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT ?",
      )
      .all(id, offset, limit) as {
      id: number;
      runId: string;
      type: string;
      data: string;
      created: number;
    }[];
    return {
      messages: rows.map(({ data, ...r }) => ({
        ...r,
        payload: JSON.parse(data),
      })),
      nextOffset: rows.at(-1)?.id ?? offset,
    };
  }
  notify(t: Task) {
    this.db.prepare("INSERT INTO notifications(owner,data) VALUES(?,?)").run(
      t.owner,
      JSON.stringify({
        taskId: t.id,
        runId: t.runId,
        status: t.status,
        summary: t.resultSummary,
        error: t.error,
        failure: t.failure,
        provider: t.provider,
        parentTaskId: t.parentTaskId,
        question: t.question,
        createdAt: Date.now(),
      }),
    );
  }
  notifications(owner: string, offset: number, limit: number) {
    const rows = this.db
      .prepare(
        "SELECT id,data FROM notifications WHERE owner=? AND id>? ORDER BY id LIMIT ?",
      )
      .all(owner, offset, limit) as { id: number; data: string }[];
    return {
      notifications: rows.map((r) => ({ offset: r.id, ...JSON.parse(r.data) })),
      nextOffset: rows.at(-1)?.id ?? offset,
    };
  }
  receipt<T>(
    owner: string,
    op: string,
    key: string | undefined,
    input: unknown,
    action: () => T,
  ): T {
    return this.transaction(() => {
      const hash = createHash("sha256").update(canonical(input)).digest("hex");
      if (key) {
        const row = this.db
          .prepare(
            "SELECT hash,data FROM receipts WHERE owner=? AND operation=? AND key=?",
          )
          .get(owner, op, key) as { hash: string; data: string } | undefined;
        if (row) {
          if (row.hash !== hash)
            throw new OrchestratorError(
              "idempotency_conflict",
              "Request ID was already used with a different payload",
            );
          return JSON.parse(row.data) as T;
        }
      }
      const result = action();
      if (key)
        this.db
          .prepare("INSERT INTO receipts VALUES(?,?,?,?,?)")
          .run(owner, op, key, hash, JSON.stringify(result));
      return result;
    });
  }
  command(id: string, taskId: string, state: string, data: unknown) {
    this.db
      .prepare(
        "INSERT INTO commands VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data",
      )
      .run(id, taskId, state, JSON.stringify(data));
  }
  commands(state: string) {
    return (
      this.db
        .prepare(
          "SELECT id,task_id AS taskId,data FROM commands WHERE state=? ORDER BY rowid",
        )
        .all(state) as { id: string; taskId: string; data: string }[]
    ).map((r) => ({
      ...r,
      data: JSON.parse(r.data) as { message: string; mode: string },
    }));
  }
  close() {
    this.db.close();
  }
}
