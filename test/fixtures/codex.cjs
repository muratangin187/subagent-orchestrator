#!/usr/bin/env node
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let threadId, turnId;
const reply = (id, result) => send({ id, result });
const event = (method, params) => send({ method, params });
if (process.argv.includes("--version")) {
  console.log("fake-codex 1");
  process.exit();
}
createInterface({ input: process.stdin })
  .on("close", () => process.exit())
  .on("line", (line) => {
    const m = JSON.parse(line);
    if (m.id === undefined) return;
    if (m.method === "initialize") return reply(m.id, { userAgent: "fake" });
    if (m.method === "model/list")
      return reply(m.id, { data: [{ model: "fake", isDefault: true }] });
    if (m.method === "thread/start" || m.method === "thread/resume") {
      threadId = m.params.threadId ?? randomUUID();
      return reply(m.id, { thread: { id: threadId } });
    }
    if (m.method === "turn/start") {
      turnId = randomUUID();
      const prompt = m.params.input[0].text;
      appendFileSync(
        process.env.AO_FIXTURE_LOG,
        JSON.stringify({ method: m.method, prompt, threadId }) + "\n",
      );
      reply(m.id, { turn: { id: turnId } });
      event("turn/started", { threadId, turn: { id: turnId } });
      if (prompt === "hang") return;
      setTimeout(() => {
        event("item/completed", {
          threadId,
          item: { id: "i", type: "agentMessage", text: "fixture result" },
        });
        event("turn/completed", {
          threadId,
          turn: { id: turnId, status: "completed" },
        });
      }, 30);
      return;
    }
    if (m.method === "turn/interrupt") {
      reply(m.id, {});
      event("turn/completed", {
        threadId,
        turn: { id: turnId, status: "interrupted" },
      });
      return;
    }
    if (m.method === "turn/steer") {
      reply(m.id, { turnId });
      event("item/completed", {
        threadId,
        item: { type: "agentMessage", text: "steered" },
      });
      event("turn/completed", {
        threadId,
        turn: { id: turnId, status: "completed" },
      });
      return;
    }
    reply(m.id, {});
  });
