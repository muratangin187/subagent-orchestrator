import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
// Limits are per JSONL line in wire bytes, excluding LF (including any CR).
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const STDERR_BYTES = 4000;
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
  private buffer: Buffer = Buffer.alloc(0);
  private bufferedBytes = 0;
  private ended = false;
  private stderr: Buffer = Buffer.alloc(0);
  constructor(command: string, args: string[], cwd?: string) {
    super();
    this.child = spawn(command, args, {
      cwd,
      env: providerEnvironment(),
      stdio: "pipe",
      windowsHide: true,
    });
    // Consume synchronously without a decoded-message queue. The pipe retains
    // its native backpressure; retain at most one bounded incomplete line.
    this.child.stdout.on("data", (chunk: Buffer) => {
      if (this.ended) return;
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 ? chunk.length : newline;
        const size = this.bufferedBytes + end - start;
        if (size > MAX_FRAME_BYTES) {
          this.stop(new Error("Provider frame exceeds 8 MiB"));
          return;
        }
        if (size > this.buffer.length) {
          const grown = Buffer.allocUnsafe(
            Math.min(
              MAX_FRAME_BYTES,
              Math.max(size, 4096, this.buffer.length * 2),
            ),
          );
          this.buffer.copy(grown, 0, 0, this.bufferedBytes);
          this.buffer = grown;
        }
        chunk.copy(this.buffer, this.bufferedBytes, start, end);
        this.bufferedBytes = size;
        if (newline < 0) return;
        const line = this.buffer.toString("utf8", 0, size);
        this.bufferedBytes = 0;
        start = newline + 1;
        if (!line.trim()) continue;
        try {
          this.receive(JSON.parse(line));
        } catch {
          // JSON.parse error messages can quote private provider content.
          this.stop(new Error("Invalid provider frame"));
          return;
        }
        if (this.ended) return;
      }
    });
    this.child.stdout.on("end", () => {
      if (this.bufferedBytes > 0)
        this.stop(new Error("Incomplete provider frame at EOF"));
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      if (this.ended) return;
      const tail = chunk.subarray(Math.max(0, chunk.length - STDERR_BYTES));
      this.stderr = Buffer.concat([
        this.stderr.subarray(
          Math.max(0, this.stderr.length + tail.length - STDERR_BYTES),
        ),
        tail,
      ]);
    });
    this.child.on("error", (e) => this.fail(e));
    // close follows stdout EOF, unlike exit which may precede pipe draining.
    this.child.on("close", (code, signal) =>
      this.fail(new Error(`Provider exited (${code ?? signal})`)),
    );
    this.child.stdin.on("error", (e) => this.fail(e));
  }
  private stop(error: Error) {
    this.fail(error);
    void this.close();
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
    this.child.stdout.pause();
    this.buffer = Buffer.alloc(0);
    this.bufferedBytes = 0;
    this.stderr = Buffer.alloc(0);
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
