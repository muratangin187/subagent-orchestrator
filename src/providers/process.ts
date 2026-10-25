import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { errorText } from "../types.js";
export function providerEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /^(T3_|T3CODE_|ORCHESTRATOR_|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|CODEX_THREAD_ID$|CODEX_INTERNAL_|MCP_)/.test(
        key,
      )
    )
      delete env[key];
  return env;
}
export class RpcProcess extends EventEmitter {
  readonly child: ChildProcessWithoutNullStreams;
  private seq = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private buffer = "";
  private ended = false;
  private stderr = "";
  constructor(command: string, args: string[], cwd?: string) {
    super();
    this.child = spawn(command, args, {
      cwd,
      env: providerEnvironment(),
      stdio: "pipe",
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
        this.fail(new Error("Provider frame exceeds 8 MiB"));
        void this.close();
        return;
      }
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        try {
          this.receive(JSON.parse(line));
        } catch (e) {
          this.fail(new Error(`Invalid provider frame: ${errorText(e)}`));
          void this.close();
        }
      }
    });
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });
    this.child.on("error", (e) => this.fail(e));
    this.child.on("exit", (code, signal) =>
      this.fail(new Error(`Provider exited (${code ?? signal})`)),
    );
    this.child.stdin.on("error", (e) => this.fail(e));
  }
  private receive(msg: any) {
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error)
        p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else this.emit(msg.id !== undefined ? "request" : "notification", msg);
  }
  private fail(error: Error) {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit("failure", error);
  }
  send(message: unknown) {
    if (this.ended) throw new Error("Provider connection closed");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  request<T = any>(
    method: string,
    params: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.ended)
      return Promise.reject(new Error("Provider connection closed"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Provider request timed out: ${method}; delivery uncertain`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 2000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
