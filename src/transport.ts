import { Devices } from "./devices/registry.js";
import { RemoteDriver } from "./devices/remote.js";
import { randomUUID } from "node:crypto";
import { createServer, request, type Server } from "node:http";
import {
  mkdirSync,
  existsSync,
  unlinkSync,
  chmodSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store.js";
import { Engine } from "./engine.js";
import { parseConcurrency } from "./scheduler-config.js";
import { schemas, runtime, type Tool } from "./schema.js";
import { CodexDriver } from "./providers/codex.js";
import { ClaudeDriver } from "./providers/claude.js";
import { errorText, type Scope } from "./types.js";
export const defaultHome = () =>
  resolve(
    process.env.ORCHESTRATOR_HOME ??
      join(homedir(), ".local", "share", "agent-orchestrator"),
  );
export const socketPath = (home: string) => join(home, "daemon.sock");
const scopeSchema = z
  .object({
    id: z.string().min(1).max(200),
    parentTaskId: z.string().uuid().optional(),
    cwd: z.string().min(1),
    ceiling: runtime,
    interactionMode: z.enum(["plan", "default"]),
  })
  .strict();
export async function rpc(
  home: string,
  method: string,
  params: unknown = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params });
    const req = request(
      {
        socketPath: socketPath(home),
        path: "/rpc",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > 32 * 1024 * 1024) {
            res.destroy(new Error("Response too large"));
          }
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const value = JSON.parse(data);
            if (value.error)
              reject(
                Object.assign(new Error(value.error.message), {
                  code: value.error.code,
                }),
              );
            else resolve(value.result);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(70_000, () =>
      req.destroy(
        new Error(
          "Local service timeout; operation may still be running. Retry with the same clientRequestId.",
        ),
      ),
    );
    req.on("error", reject);
    req.end(body);
  });
}
export async function ensureDaemon(home: string) {
  try {
    await rpc(home, "health");
    return;
  } catch (e) {
    if (
      !["ENOENT", "ECONNREFUSED"].includes(
        (e as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw e;
  }
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      "daemon",
      "--home",
      home,
    ],
    { detached: true, stdio: "ignore", env: process.env },
  );
  child.unref();
  let spawnError: Error | undefined;
  child.on("error", (e) => {
    spawnError = e;
  });
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    await new Promise((r) => setTimeout(r, 100));
    try {
      await rpc(home, "health");
      return;
    } catch {}
  }
  throw new Error(
    `Daemon did not start. Run agent-orchestrator daemon --home ${home} to inspect the error.`,
  );
}
export async function serve(
  home: string,
  workspace?: {
    cwd: string;
    ceiling: import("./types.js").RuntimeMode;
    port: number;
    model?: string;
  },
): Promise<{ server: Server; close: () => Promise<void> }> {
  if (process.platform === "win32")
    throw new Error(
      "Use WSL2 on Windows; this release requires Unix domain sockets",
    );
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  let store!: Store;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      store = new Store(join(home, "state.sqlite"));
      break;
    } catch (e) {
      if (!/database is locked/.test(errorText(e)) || attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    }
  }
  const nonce = randomUUID();
  try {
    store.claimDaemon(process.pid, nonce);
  } catch (e) {
    store.close();
    throw e;
  }
  let engine: Engine | undefined;
  let server: Server | undefined;
  const sock = socketPath(home);
  try {
    if (existsSync(sock)) {
      if (!lstatSync(sock).isSocket())
        throw new Error("Socket path is not a socket");
      unlinkSync(sock);
    }
    const devices = new Devices(home, workspace?.cwd ?? process.cwd());
    engine = new Engine(
      store,
      (p, task) =>
        devices.remote(task?.deviceId)
          ? new RemoteDriver(
              devices.get(task!.deviceId!),
              devices.config.coordinatorSshHost!,
              workspace?.cwd ?? process.cwd(),
            )
          : p === "codex"
            ? new CodexDriver()
            : new ClaudeDriver(),
      parseConcurrency(process.env.ORCHESTRATOR_CONCURRENCY_PER_DEPTH),
      z.coerce
        .number()
        .int()
        .min(1)
        .max(8)
        .parse(process.env.ORCHESTRATOR_MAX_DEPTH ?? 3),
      30 * 60_000,
      home,
      devices,
    );
    engine.recover();
    const owner = engine;
    let closing = false;
    server = createServer(async (req, res) => {
      const respond = (value: unknown) => {
        if (!res.destroyed) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(value));
        }
      };
      if (req.method !== "POST" || req.url !== "/rpc") {
        res.statusCode = 404;
        res.end();
        return;
      }
      try {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 256_000) throw new Error("Request exceeds 256 KiB");
          chunks.push(chunk);
        }
        const envelope = z
          .object({ method: z.string(), params: z.unknown() })
          .strict()
          .parse(JSON.parse(Buffer.concat(chunks).toString()));
        if (envelope.method === "health") {
          respond({ result: { version: 1, pid: process.pid, home } });
          return;
        }
        if (envelope.method === "shutdown") {
          if (!closing) {
            closing = true;
            respond({ result: { stopping: true } });
            setImmediate(() => void close());
          }
          return;
        }
        if (envelope.method === "models") {
          respond({ result: await CodexDriver.models() });
          return;
        }
        if (envelope.method !== "tool") throw new Error("Unknown method");
        const params = z
          .object({
            scope: scopeSchema,
            tool: z.enum(Object.keys(schemas) as [Tool, ...Tool[]]),
            input: z.unknown(),
          })
          .strict()
          .parse(envelope.params);
        const scope: Scope = {
          ...params.scope,
          cwd: realpathSync(params.scope.cwd),
        };
        respond({ result: await owner.call(scope, params.tool, params.input) });
      } catch (e) {
        respond({
          error: {
            code:
              e instanceof z.ZodError
                ? "invalid_input"
                : ((e as { code?: string }).code ?? "internal_error"),
            message: errorText(e),
          },
        });
      }
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(sock, () => {
        chmodSync(sock, 0o600);
        resolve();
      });
    });
    let gateway: { close: () => Promise<void> } | undefined;
    if (workspace) {
      const { WorkspaceController } = await import("./workspace/controller.js");
      const { startGateway } = await import("./workspace/gateway.js");
      gateway = await startGateway(
        new WorkspaceController(
          owner,
          store,
          workspace.cwd,
          workspace.ceiling,
          workspace.model,
        ),
        home,
        workspace.port,
      );
    }
    let closePromise: Promise<void> | undefined;
    const close = () =>
      (closePromise ??= (async () => {
        await gateway?.close();
        server!.close();
        await owner.close();
        server!.closeAllConnections();
        if (existsSync(sock)) unlinkSync(sock);
        store.releaseDaemon(nonce);
        store.close();
      })());
    return { server, close };
  } catch (e) {
    await engine?.close();
    server?.close();
    store.releaseDaemon(nonce);
    store.close();
    throw e;
  }
}
