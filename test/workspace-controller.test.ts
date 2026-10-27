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
async function until(ready: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline) await tick();
  assert.ok(ready(), "Expected asynchronous state within 5 seconds");
}
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
    await until(() => s.drivers.length >= 1 && !!s.drivers[0]?.context);
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
    await until(() => s.drivers.length >= 2 && !!s.drivers[1]?.context);
    s.drivers[0]!.resolve("Started.");
    await until(() => s.store.task(root).status === "completed");
    s.c.submit({
      id: "u2",
      target: "assistant",
      kind: "assistant",
      provider: "codex",
      body: "Another topic",
    });
    await until(() => s.drivers.length >= 3 && !!s.drivers[2]?.context);
    assert.equal(s.drivers[2]!.context.task.sessionId, "native-session");
    assert.equal(s.store.task(child.taskId).status, "running");
    s.drivers[2]!.resolve("Answer to another topic");
    s.drivers[1]!.resolve("Verified result");
    await tick();
    await s.c.pump();
    await until(() => s.drivers.length >= 4 && !!s.drivers[3]?.context);
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

test("WebView CORS is opt-in, exact-origin and still requires bearer authentication", async () => {
  const s = setup();
  const old = process.env.ORCHESTRATOR_BROWSER_ORIGINS;
  process.env.ORCHESTRATOR_BROWSER_ORIGINS = JSON.stringify([
    "https://glasses.example",
  ]);
  const g = await startGateway(s.c, s.home, 0);
  if (old === undefined) delete process.env.ORCHESTRATOR_BROWSER_ORIGINS;
  else process.env.ORCHESTRATOR_BROWSER_ORIGINS = old;
  try {
    const url = `http://127.0.0.1:${(g.server.address() as any).port}/v1/state`;
    const origin = "https://glasses.example";
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: origin },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(
      (await fetch(url, { headers: { Origin: origin } })).status,
      401,
    );
    const token = readFileSync(join(s.home, "device-secret"), "utf8");
    const valid = await fetch(url, {
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("Vary"), "Origin");
    for (const bad of [
      "null",
      "https://glasses.example.evil.test",
      "https://evil.example",
    ]) {
      const denied = await fetch(url, {
        method: "OPTIONS",
        headers: { Origin: bad },
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
    }
  } finally {
    await g.close();
    await s.close();
  }
});

test("recent chat starts at the tail and older pages preserve chronological order", async () => {
  const s = setup();
  const g = await startGateway(s.c, s.home, 0);
  try {
    const t: any = await s.engine.call(s.c.scope, "delegate_task", {
      task: "history fixture",
      provider: "codex",
      mode: "async",
      clientRequestId: "history-fixture",
    });
    await until(() => !!s.drivers[0]?.context);
    for (let i = 0; i < 450; i++)
      s.store.event(s.store.task(t.taskId), "assistant_message", {
        text: "message " + i,
      });
    const url = `http://127.0.0.1:${(g.server.address() as any).port}/v1/messages?taskId=${t.taskId}`;
    const headers = {
      Authorization:
        "Bearer " + readFileSync(join(s.home, "device-secret"), "utf8"),
    };
    const tail: any = await (
      await fetch(url + "&tail=true", { headers })
    ).json();
    assert.equal(tail.messages.length, 200);
    assert.equal(tail.messages.at(-1).payload.text, "message 449");
    assert.ok(tail.olderCursor);
    const older: any = await (
      await fetch(url + "&before=" + tail.olderCursor, { headers })
    ).json();
    assert.equal(older.messages.length, 200);
    assert.ok(older.messages.at(-1).id < tail.messages[0].id);
    const ids = [...older.messages, ...tail.messages].map((m: any) => m.id);
    assert.equal(new Set(ids).size, 400);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => a - b),
    );
    const incremental: any = await (
      await fetch(url + "&after=" + tail.nextOffset, { headers })
    ).json();
    assert.equal(incremental.messages.length, 0);
  } finally {
    await g.close();
    await s.close();
  }
});

test("explicit user message reopens cancelled assistant without reviving children or old runs", async () => {
  const s = setup();
  try {
    s.c.submit({
      id: "start",
      target: "assistant",
      kind: "assistant",
      provider: "codex",
      body: "work",
    });
    await until(() => !!s.drivers[0]?.context);
    const root = s.c.get("assistant")!;
    const oldRun = s.store.task(root).runId;
    const child: any = await s.engine.call(
      { ...s.c.scope, id: `child:${root}`, parentTaskId: root },
      "delegate_task",
      { task: "child" },
    );
    await until(() => !!s.drivers[1]?.context);
    await s.engine.call(s.c.scope, "cancel_task", {
      taskId: root,
      clientRequestId: "cancel",
    });
    await tick();
    await s.c.pump();
    assert.equal(s.store.task(root).cancelled, true);
    assert.equal(s.drivers.length, 2);
    s.c.submit({
      id: "new-message",
      target: "assistant",
      kind: "assistant",
      provider: "codex",
      body: "new topic",
    });
    await s.c.pump();
    await until(() => !!s.drivers[2]?.context);
    assert.equal(s.c.get("assistant"), root);
    assert.equal(s.drivers[2]!.context.task.sessionId, "native-session");
    assert.equal(s.drivers[2]!.context.run.prompt, "new topic");
    assert.equal(s.store.run(oldRun).status, "cancelled");
    assert.equal(s.store.task(child.taskId).cancelled, true);
    assert.equal(s.store.task(root).cancelled, false);
    s.drivers[2]!.resolve("Hello again");
    await tick();
  } finally {
    await s.close();
  }
});

test("local chat artifacts require auth and produce downloadable immutable snapshots", async () => {
  const s = setup();
  const g = await startGateway(s.c, s.home, 0);
  try {
    const base = `http://127.0.0.1:${(g.server.address() as any).port}`;
    const path = join(s.c.scope.cwd, "report.html");
    writeFileSync(path, "<h1>Report</h1>");
    const payload = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    };
    assert.equal(
      (await fetch(base + "/v1/artifacts/open", payload)).status,
      401,
    );
    const headers = {
      ...payload.headers,
      Authorization:
        "Bearer " + readFileSync(join(s.home, "device-secret"), "utf8").trim(),
    };
    const response = await fetch(base + "/v1/artifacts/open", {
      ...payload,
      headers,
    });
    assert.equal(response.status, 200);
    const file: any = await response.json();
    assert.equal(file.name, "report.html");
    const apkPath = join(s.c.scope.cwd, "app.apk");
    const apkBytes = Buffer.alloc(6 * 1024 * 1024, 17);
    writeFileSync(apkPath, apkBytes);
    const apkResponse = await fetch(base + "/v1/artifacts/open", {
      ...payload,
      headers,
      body: JSON.stringify({ path: apkPath }),
    });
    assert.equal(apkResponse.status, 200);
    const apk: any = await apkResponse.json();
    assert.equal(apk.size, apkBytes.length);
    const parts: Buffer[] = [];
    let offset = 0;
    while (offset < apk.size) {
      const part: any = await (
        await fetch(base + "/v1/attachments/" + apk.id + "?offset=" + offset, {
          headers,
        })
      ).json();
      parts.push(Buffer.from(part.content, "base64"));
      offset = part.nextOffset;
    }
    assert.deepEqual(Buffer.concat(parts), apkBytes);
    writeFileSync(path, "changed");
    const download: any = await (
      await fetch(base + "/v1/attachments/" + file.id, { headers })
    ).json();
    assert.equal(
      Buffer.from(download.content, "base64").toString(),
      "<h1>Report</h1>",
    );
    assert.equal(
      (
        await fetch(base + "/v1/artifacts/open", {
          ...payload,
          headers,
          body: JSON.stringify({ path: join(s.c.scope.cwd, "missing.pdf") }),
        })
      ).status,
      404,
    );
  } finally {
    await g.close();
    await s.close();
  }
});

test("visual documents require authentication and task ownership", async () => {
  const s = setup();
  const g = await startGateway(s.c, s.home, 0);
  try {
    const own = (await s.engine.call(s.c.scope, "delegate_task", {
      task: "visual fixture",
      clientRequestId: "visual-own",
    })) as any;
    const otherScope = { ...s.c.scope, id: "another-owner" };
    const other = (await s.engine.call(otherScope, "delegate_task", {
      task: "private fixture",
      clientRequestId: "visual-other",
    })) as any;
    const id = "11111111-1111-4111-8111-111111111111",
      foreign = "22222222-2222-4222-8222-222222222222";
    for (const [visualId, taskId] of [
      [id, own.taskId],
      [foreign, other.taskId],
    ])
      s.store.db
        .prepare("INSERT INTO visual_documents VALUES(?,?,?,?,?)")
        .run(visualId, taskId, "Fixture", "<p>Safe</p>", "[]");
    const base = `http://127.0.0.1:${(g.server.address() as any).port}/v1/visuals/`;
    const headers = {
      Authorization:
        "Bearer " + readFileSync(join(s.home, "device-secret"), "utf8").trim(),
    };
    assert.equal((await fetch(base + id)).status, 401);
    assert.equal((await fetch(base + id, { headers })).status, 200);
    assert.notEqual((await fetch(base + foreign, { headers })).status, 200);
  } finally {
    await g.close();
    await s.close();
  }
});

test('simultaneous child notices resume assistant once and are durable', async () => {
  const s = setup();
  try {
    s.c.submit({id:'batch-root',target:'assistant',kind:'assistant',provider:'codex',body:'work'});
    await until(() => !!s.drivers[0]?.context);
    const root = s.c.get('assistant')!;
    const scope = {...s.c.scope,id:`child:${root}`,parentTaskId:root};
    const a = await s.engine.call(scope,'delegate_task',{task:'a'}) as any;
    const b = await s.engine.call(scope,'delegate_task',{task:'b'}) as any;
    await until(() => s.drivers.length === 3 && !!s.drivers[2]?.context);
    s.drivers[0]!.resolve('Started');
    s.drivers[1]!.resolve('first child result');
    s.drivers[2]!.resolve('second child result');
    await until(() => [root,a.taskId,b.taskId].every(id => s.store.task(id).status === 'completed'));
    await s.c.pump();
    await until(() => !!s.drivers[3]?.context);
    assert.match(s.drivers[3]!.context.run.prompt,/first child result/);
    assert.match(s.drivers[3]!.context.run.prompt,/second child result/);
    assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM workspace_deliveries').get()!.n,2);
    await s.c.pump();
    assert.equal(s.drivers.length,4);
  } finally { await s.close(); }
});

test('quiet work warns once per run; waiting children and recent activity are not stalls', async () => {
  const s = setup();
  try {
    s.c.submit({id:'quiet-root',target:'assistant',kind:'assistant',provider:'codex',body:'work'});
    await until(() => !!s.drivers[0]?.context);
    const root = s.c.get('assistant')!;
    const scope = {...s.c.scope,id:`child:${root}`,parentTaskId:root};
    const child = await s.engine.call(scope,'delegate_task',{task:'slow tool'}) as any;
    await until(() => !!s.drivers[1]?.context);
    const id = child.taskId;
    s.store.db.prepare('UPDATE events SET created=? WHERE task_id=?').run(Date.now()-700_000,id);
    assert.equal(s.c.snapshot().tasks.find(t=>t.id===id)!.quiet,true);
    (s.c as any).healthCheckedAt=0;
    await s.c.pump();
    assert.equal(s.store.db.prepare("SELECT count(*) AS n FROM events WHERE task_id=? AND type='inactivity_warning'").get(id)!.n,1);
    (s.c as any).healthCheckedAt=0;
    await s.c.pump();
    assert.equal(s.store.db.prepare("SELECT count(*) AS n FROM events WHERE task_id=? AND type='inactivity_warning'").get(id)!.n,1);
    const t=s.store.task(id); t.status='waiting_children';s.store.saveTask(t);
    assert.equal(s.c.snapshot().tasks.find(t=>t.id===id)!.quiet,false);
    t.status='running';s.store.saveTask(t);
    s.drivers[1]!.context.event({type:'tool_output',payload:{text:'progress'}});
    assert.equal(s.c.snapshot().tasks.find(t=>t.id===id)!.quiet,false);
  } finally { await s.close(); }
});

test('large child results and questions are durably delivered within the command limit',async()=>{
 const s=setup();try {
  s.c.submit({id:'large-root',target:'assistant',kind:'assistant',provider:'codex',body:'work'});
  await until(()=>!!s.drivers[0]?.context);
  const root=s.c.get('assistant')!;
  s.drivers[0]!.resolve('ready');await until(()=>s.store.task(root).status==='completed');
  const parent=s.store.task(root);
  for(let i=0;i<15;i++)s.store.notify({...parent,owner:`child:${root}`,resultSummary:'x'.repeat(i<2?33000:7000)});
  s.store.notify({...parent,owner:`child:${root}`,status:'waiting_question',question:{id:'required-question',prompt:'Choose the target',createdAt:Date.now()} } as any);
  let delivered=0;
  for(let i=0;i<10 && delivered<16;i++){
   await s.c.pump();await until(()=>!!s.drivers.at(-1)?.context && s.store.task(root).status==='running');
   const driver=s.drivers.at(-1)!;assert.ok(driver.context.run.prompt.length<=64000);
   delivered=Number(s.store.db.prepare('SELECT count(*) AS n FROM workspace_deliveries').get()!.n);
   driver.resolve('received');await until(()=>s.store.task(root).status==='completed');
  }
  assert.equal(delivered,16);
  const inputs=s.store.db.prepare("SELECT body,state FROM workspace_inputs WHERE id LIKE 'event:%'").all() as any[];
  assert.ok(inputs.length>1);assert.ok(inputs.every(x=>x.state==='accepted'));
  assert.ok(inputs.some(x=>x.body.includes('required-question')));
  assert.ok(inputs.some(x=>x.body.includes('"truncated":true')));
  await s.c.pump();assert.equal(Number(s.store.db.prepare('SELECT count(*) AS n FROM workspace_deliveries').get()!.n),16);
 } finally {await s.close()}
});
