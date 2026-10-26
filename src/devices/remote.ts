import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Driver, RunContext } from "../types.js";
import type { Device } from "./registry.js";
import { sshArgs } from "./registry.js";
export class RemoteDriver implements Driver {
  private child?: ChildProcessWithoutNullStreams;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  constructor(
    private device: Device,
    private coordinatorHost: string,
    private coordinatorCwd: string,
  ) {}
  private send(m: any) {
    if (!this.child?.stdin.writable) throw Error("Remote connection closed");
    this.child.stdin.write(JSON.stringify(m) + "\n");
  }
  async run(ctx: RunContext): Promise<string> {
    const child = (this.child = spawn(
      "ssh",
      sshArgs(this.device.sshHost!, this.device.command!),
      { stdio: ["pipe", "pipe", "pipe"] },
    ));
    child.stderr.on("data", () => {}); // SSH/provider diagnostics may contain private paths; do not forward raw output.
    const lines = createInterface({ input: child.stdout });
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: Error, result?: string) => {
        if (done) return;
        done = true;
        for (const p of this.pending.values())
          p.reject(error ?? Error("Remote run ended"));
        this.pending.clear();
        error ? reject(error) : resolve(result ?? "");
      };
      let partialBytes = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        const end = chunk.lastIndexOf(10);
        partialBytes =
          end < 0 ? partialBytes + chunk.length : chunk.length - end - 1;
        if (partialBytes > 8_000_000) {
          finish(Error("REMOTE_UNCERTAIN: worker frame exceeds limit"));
          void this.close();
        }
      });
      child.stdin.on("error", () =>
        finish(Error("REMOTE_UNCERTAIN: worker input closed")),
      );
      child.on("error", () =>
        finish(
          Error(
            "REMOTE_UNCERTAIN: device connection failed; inspect before explicitly continuing.",
          ),
        ),
      );
      child.on("close", () =>
        finish(
          Error(
            "REMOTE_UNCERTAIN: device disconnected; work was not replayed.",
          ),
        ),
      );
      lines.on("line", (line) => {
        if (done) return;
        try {
          if (line.length > 8_000_000) throw Error("Oversize worker response");
          const m = JSON.parse(line);
          switch (m.type) {
            case "session":
              ctx.session(m.id);
              break;
            case "event":
              ctx.event(m.event);
              break;
            case "workspace":
              Object.assign(ctx.task, m.workspace);
              ctx.event({ type: "device_workspace", payload: m.workspace });
              break;
            case "question":
              void ctx
                .question(m.prompt)
                .then((answer) =>
                  this.send({ type: "answer", id: m.id, answer }),
                )
                .catch(() => {
                  void this.close();
                });
              break;
            case "reply": {
              const p = this.pending.get(m.id);
              this.pending.delete(m.id);
              if (p) m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
              break;
            }
            case "result":
              if (typeof m.result !== "string") throw Error("Invalid result");
              finish(undefined, m.result);
              break;
            case "error":
              finish(Error(m.error));
              break;
          }
        } catch {
          finish(
            Error(
              "REMOTE_UNCERTAIN: invalid worker response; inspect before continuing.",
            ),
          );
        }
      });
      const delegation = ctx.delegation
        ? {
            command: "ssh",
            args: sshArgs(this.coordinatorHost, [
              ctx.delegation.command,
              ...ctx.delegation.args.map((a, i, all) =>
                all[i - 1] === "--cwd" ? this.coordinatorCwd : a,
              ),
            ]),
          }
        : undefined;
      this.send({ type: "run", task: ctx.task, run: ctx.run, delegation });
    });
  }
  private command(type: string, message?: string) {
    const id = ++this.seq;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("REMOTE_UNCERTAIN: command acknowledgement timed out"));
      }, 15000);
      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      try {
        this.send({ type, id, message });
      } catch (e) {
        this.pending.get(id)?.reject(e as Error);
        this.pending.delete(id);
      }
    });
  }
  steer(message: string) {
    return this.command("steer", message);
  }
  interrupt() {
    return this.command("interrupt");
  }
  async close() {
    const c = this.child;
    if (!c) return;
    this.child = undefined;
    c.stdin.end();
    c.kill("SIGTERM");
  }
}
