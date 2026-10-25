import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { WorkspaceController } from "../src/workspace/controller.js";
import { startGateway } from "../src/workspace/gateway.js";
import type { RunContext, Driver } from "../src/types.js";
class Fake implements Driver {
  context!: RunContext;
  resolve!: (s: string) => void;
  reject!: (e: Error) => void;
  run(c: RunContext) {
    this.context = c;
    c.session(c.task.sessionId ?? "native-session");
    return new Promise<string>((r, j) => {
      this.resolve = r;
      this.reject = j;
    });
  }
  async close() {
    this.reject?.(Error("closed"));
  }
  async interrupt() {
    this.reject(Error("interrupted"));
  }
  async steer() {}
}
const tick = () => new Promise((r) => setTimeout(r, 30));
function setup() {
  const home = mkdtempSync(join(tmpdir(), "workspace-test-"));
  const store = new Store(join(home, "state.sqlite"));
  const drivers: Fake[] = [];
  const engine = new Engine(
    store,
    () => {
      const f = new Fake();
      drivers.push(f);
      return f;
    },
    4,
    3,
    60_000,
    home,
  );
  const c = new WorkspaceController(
    engine,
    store,
    home,
    "read-only",
    "test-model",
  );
  return {
    home,
    store,
    engine,
    c,
    drivers,
    async close() {
      await c.stop();
      await engine.close();
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
test("assistant ends its turn, child result resumes same native session exactly once", async () => {
  const s = setup();
  try {
    s.c.submit({
      id: "u1",
      target: "assistant",
      kind: "assistant",
      provider: "codex",
      body: "Start work",
    });
    await tick();
    const root = s.c.get("assistant")!;
    assert.equal(s.store.task(root).conversationKind, "assistant");
    const childScope = {
      ...s.c.scope,
      id: `child:${root}`,
      parentTaskId: root,
    };
    await assert.rejects(
      s.engine.call(childScope, "delegate_task", {
        task: "blocked wait",
        mode: "wait",
      }),
      /async/,
    );
    const child = (await s.engine.call(childScope, "delegate_task", {
      task: "Do work",
      mode: "async",
    })) as any;
    await tick();
    s.drivers[0]!.resolve("Started.");
    await tick();
    s.c.submit({
      id: "u2",
      target: "assistant",
      kind: "assistant",
      provider: "codex",
      body: "Another topic",
    });
    await tick();
    assert.equal(s.drivers[2]!.context.task.sessionId, "native-session");
    assert.equal(s.store.task(child.taskId).status, "running");
    s.drivers[2]!.resolve("Answer to another topic");
    s.drivers[1]!.resolve("Verified result");
    await tick();
    await s.c.pump();
    await tick();
    assert.equal(s.drivers.length, 4);
    assert.match(s.drivers[3]!.context.run.prompt, /Verified result/);
    s.drivers[3]!.resolve("Result summary");
    await tick();
    await s.c.pump();
    await tick();
    assert.equal(s.drivers.length, 4);
    assert.equal(
      s.store.db
        .prepare("SELECT count(*) AS n FROM workspace_deliveries")
        .get()!.n,
      1,
    );
  } finally {
    await s.close();
  }
});
test("mobile receipt rejects mismatched retry and accepts identical payload once", async () => {
  const s = setup();
  try {
    const input = {
      id: "same",
      target: "assistant",
      kind: "assistant" as const,
      provider: "codex" as const,
      body: "hello",
    };
    s.c.submit(input);
    s.c.submit(input);
    assert.throws(() => s.c.submit({ ...input, body: "changed" }), /conflict/);
    await tick();
    assert.equal(s.drivers.length, 1);
  } finally {
    await s.close();
  }
});
test("gateway requires pairing, rejects origins and limits external resume", async () => {
  const s = setup();
  const g = await startGateway(s.c, s.home, 0);
  try {
    const url = `http://127.0.0.1:${(g.server.address() as any).port}`;
    assert.equal((await fetch(url + "/v1/state")).status, 401);
    const pair = await fetch(url + "/v1/pair", {
      method: "POST",
      body: JSON.stringify({
        code: readFileSync(join(s.home, "pairing-code"), "utf8"),
      }),
    });
    const { token } = (await pair.json()) as any;
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(url + "/v1/state", { headers })).status, 200);
    assert.equal(
      (
        await fetch(url + "/v1/state", {
          headers: { ...headers, Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const post = (path: string, body: unknown) =>
      fetch(url + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const upload = {
      id: "12345678-1234-4234-8234-123456789abc",
      name: "test.txt",
      content: Buffer.from("attachment fixture").toString("base64"),
    };
    // Simulate crash after writing a file but before committing its upload receipt.
    mkdirSync(join(s.home, ".orchestrator-attachments"));
    writeFileSync(
      join(s.home, ".orchestrator-attachments", upload.id + "-test.txt"),
      "attachment fixture",
    );
    assert.equal((await post("/v1/upload", upload)).status, 200);
    assert.equal((await post("/v1/upload", upload)).status, 200);
    assert.equal(
      (
        await post("/v1/upload", {
          ...upload,
          content: Buffer.from("different").toString("base64"),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/v1/upload", {
          id: "22345678-1234-4234-8234-123456789abc",
          name: "preview.html",
          content: Buffer.from("<h1>Preview</h1>").toString("base64"),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/v1/upload", {
          id: "32345678-1234-4234-8234-123456789abc",
          name: "script.exe",
          content: "AA==",
        })
      ).status,
      400,
    );
    const input = {
      clientRequestId: "http-idempotency",
      text: "read file",
      attachments: [upload.id],
    };
    const first = await post("/v1/assistant/messages", input);
    assert.equal(first.status, 202);
    assert.deepEqual(
      await (await post("/v1/assistant/messages", input)).json(),
      await first.json(),
    );
    assert.equal(
      (await post("/v1/assistant/messages", { ...input, text: "changed" }))
        .status,
      400,
    );
    assert.equal((await post("/v1/sessions/messages", input)).status, 400);
    await tick();
    assert.equal(s.drivers.length, 1);
    const chat = (await (
      await fetch(url + "/v1/messages?taskId=" + s.c.get("assistant"), {
        headers,
      })
    ).json()) as any;
    assert.equal(
      chat.messages.find((e: any) => e.type === "task_created").payload.task,
      "read file",
    );
    const attachments = chat.messages.find(
      (e: any) => e.type === "task_created",
    ).payload.attachments;
    assert.deepEqual(attachments, [
      { id: upload.id, name: "test.txt", size: 18 },
    ]);
    const downloaded = (await (
      await fetch(url + "/v1/attachments/" + upload.id, { headers })
    ).json()) as any;
    assert.equal(
      Buffer.from(downloaded.content, "base64").toString(),
      "attachment fixture",
    );
    assert.equal(
      (await fetch(url + "/v1/attachments/" + upload.id)).status,
      401,
    );
    assert.match(s.drivers[0]!.context.run.prompt, /User attached files/);
    const denied = await fetch(url + "/v1/sessions/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        clientRequestId: "external",
        text: "hello",
        nativeId: "00000000-0000-4000-8000-000000000000",
      }),
    });
    assert.equal(denied.status, 400);
    assert.equal(
      (
        await fetch(url + "/v1/pair", {
          method: "POST",
          body: JSON.stringify({
            code: readFileSync(join(s.home, "pairing-code"), "utf8"),
          }),
        })
      ).status,
      403,
    );
  } finally {
    await g.close();
    await s.close();
  }
});

test("assistant quota retains child notification until an explicit user continuation", async () => {
  const s = setup();
  try {
    s.c.submit({
      id: "first",
      target: "assistant",
      kind: "assistant",
      provider: "codex",
      body: "work",
    });
    await tick();
    const root = s.c.get("assistant")!;
    const child = (await s.engine.call(
      { ...s.c.scope, id: `child:${root}`, parentTaskId: root },
      "delegate_task",
      { task: "child" },
    )) as any;
    await tick();
    s.drivers[0]!.reject(Error("usage_limit_reached"));
    s.drivers[1]!.resolve("result");
    await tick();
    await s.c.pump();
    await tick();
    assert.equal(s.drivers.length, 2);
    assert.equal(
      s.store.db
        .prepare("SELECT count(*) AS n FROM workspace_deliveries")
        .get()!.n,
      0,
    );
    s.c.submit({
      id: "user-retry",
      target: "assistant",
      kind: "assistant",
      provider: "codex",
      body: "Limit restored, continue",
    });
    await tick();
    s.drivers[2]!.resolve("Resumed");
    await tick();
    await s.c.pump();
    await tick();
    assert.equal(s.drivers.length, 4);
    assert.match(s.drivers[3]!.context.run.prompt, /result/);
  } finally {
    await s.close();
  }
});
