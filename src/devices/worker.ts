import { readArtifact } from "../workspace/artifacts.js";
import { usageLimits } from "../providers/limits.js";
import { modelCatalog } from "../providers/catalog.js";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { CodexDriver } from "../providers/codex.js";
import { ClaudeDriver } from "../providers/claude.js";
import { prepareWorkspace, resolveCommit } from "../workspace.js";
import {
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { nativeList, nativeRead } from "../workspace/native.js";
import { errorText, type Driver } from "../types.js";
export async function worker() {
  let driver: Driver | undefined,
    started = false;
  const questions = new Map<string, (answer: any) => void>();
  const send = (m: any) => process.stdout.write(JSON.stringify(m) + "\n");
  const lines = createInterface({ input: process.stdin });
  const close = async () => {
    for (const answer of questions.values()) answer({});
    questions.clear();
    await driver?.close().catch(() => {});
    await new Promise<void>((r) => process.stdout.write("", () => r()));
    process.exit(0);
  };
  lines.on("close", () => void close());
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());
  lines.on("line", (line) => {
    void (async () => {
      if (line.length > 8_000_000) throw Error("Worker input too large");
      const m = JSON.parse(line);
      if (m.type === "query") {
        if (started) throw Error("Worker already in use");
        started = true;
        const q = m.query;
        let result: any;
        if (q.op === "health")
          result = { online: true, platform: process.platform };
        else if (q.op === "artifact")
          result = readArtifact(
            z.string().max(4096).parse(q.path),
            z.string().startsWith("/").parse(q.root),
            z.number().int().nonnegative().default(0).parse(q.offset),
          );
        else if (q.op === "limits") result = await usageLimits();
        else if (q.op === "models") result = await modelCatalog();
        else if (q.op === "native")
          result = await nativeList(
            z.enum(["codex", "claude"]).parse(q.provider),
            q.cursor,
          );
        else if (q.op === "nativeRead")
          result = await nativeRead(
            z.enum(["codex", "claude"]).parse(q.provider),
            z.string().uuid().parse(q.id),
            q.cursor,
          );
        else if (q.op === "upload") {
          const id = z.string().uuid().parse(q.id),
            name = z
              .string()
              .min(1)
              .max(200)
              .parse(q.name)
              .replace(/[^\p{L}\p{N}._-]/gu, "_");
          const content = Buffer.from(
            z.string().max(7_000_000).parse(q.content),
            "base64",
          );
          if (content.length > 5 * 1024 * 1024)
            throw Error("Attachment too large");
          const dir = join(
            homedir(),
            ".local/share/agent-workspace/remote-attachments",
          );
          if (existsSync(dir) && lstatSync(dir).isSymbolicLink())
            throw Error("Attachment directory must not be a symlink");
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          const path = join(dir, id + "-" + name);
          try {
            writeFileSync(path, content, { mode: 0o600, flag: "wx" });
          } catch (error: any) {
            if (error.code !== "EEXIST") throw error;
            if (
              !lstatSync(path).isFile() ||
              !readFileSync(path).equals(content)
            )
              throw Error(
                "Attachment ID already exists with different content",
              );
          }
          result = { path };
        } else throw Error("Unknown device query");
        send({ type: "result", result });
        await close();
      } else if (m.type === "run") {
        if (started) throw Error("Worker accepts one run");
        started = true;
        if (!["codex", "claude"].includes(m.task.provider))
          throw Error("Invalid provider");
        m.task.sourceCwd = realpathSync(m.task.sourceCwd ?? m.task.cwd);
        if (m.task.isolation === "worktree" && !m.task.baseCommit)
          m.task.baseCommit = resolveCommit(m.task.sourceCwd);
        await prepareWorkspace(m.task);
        m.task.cwd = realpathSync(m.task.cwd);
        send({
          type: "workspace",
          workspace: {
            cwd: m.task.cwd,
            sourceCwd: m.task.sourceCwd,
            baseCommit: m.task.baseCommit,
          },
        });
        driver =
          m.task.provider === "codex" ? new CodexDriver() : new ClaudeDriver();
        try {
          const result = await driver.run({
            task: m.task,
            run: m.run,
            delegation: m.delegation,
            session: (id) => send({ type: "session", id }),
            event: (event) => send({ type: "event", event }),
            question: (prompt) =>
              new Promise((resolve) => {
                const id = randomUUID();
                questions.set(id, resolve);
                send({ type: "question", id, prompt });
              }),
          });
          send({ type: "result", result });
        } catch (e) {
          send({ type: "error", error: errorText(e) });
        } finally {
          await close();
        }
      } else if (m.type === "answer") {
        questions.get(m.id)?.(m.answer);
        questions.delete(m.id);
      } else if (m.type === "steer" || m.type === "interrupt") {
        try {
          if (!driver) throw Error("Worker not started");
          if (m.type === "steer") await driver.steer(m.message);
          else await driver.interrupt();
          send({ type: "reply", id: m.id });
        } catch (e) {
          send({ type: "reply", id: m.id, error: errorText(e) });
        }
      }
    })().catch((e) => {
      send({ type: "error", error: errorText(e) });
      void close();
    });
  });
}
