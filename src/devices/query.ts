import { spawn } from "node:child_process";
import type { Device } from "./registry.js";
import { sshArgs } from "./registry.js";
export function deviceQuery(
  device: Device,
  query: Record<string, unknown>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", sshArgs(device.sshHost!, device.command!), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let data = "";
    let settled = false;
    const finish = (e?: Error, v?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      e ? reject(e) : resolve(v);
    };
    const timer = setTimeout(
      () => finish(Error("Device unavailable: " + device.name)),
      20000,
    );
    child.stderr.on("data", () => {});
    child.on("error", () =>
      finish(Error("Device unavailable: " + device.name)),
    );
    child.stdout.on("data", (b) => {
      data += b;
      if (data.length > 16_000_000)
        return finish(Error("Device response too large"));
      const i = data.indexOf("\n");
      if (i < 0) return;
      try {
        const r = JSON.parse(data.slice(0, i));
        if (r.type === "error") finish(Error(r.error));
        else if (r.type === "result") finish(undefined, r.result);
        else finish(Error("Unexpected device response"));
      } catch {
        finish(Error("Invalid device response"));
      }
    });
    child.on("close", () => {
      if (!settled) finish(Error("Device disconnected: " + device.name));
    });
    child.stdin.on("error", () =>
      finish(Error("Device disconnected: " + device.name)),
    );
    child.stdin.write(JSON.stringify({ type: "query", query }) + "\n");
  });
}
