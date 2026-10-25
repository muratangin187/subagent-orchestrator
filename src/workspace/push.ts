import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
import type { WorkspaceController } from "./controller.js";

// This boundary deliberately accepts no task title, prompt, result or user identity.
export function pushEnvelope(token: string, eventId: string) {
  return {
    message: {
      token,
      notification: {
        title: "Agent Workspace",
        body: "Asistanında yeni bir güncelleme var.",
      },
      data: { eventId },
      android: {
        priority: "HIGH",
        ttl: "86400s",
        collapse_key: "workspace-update",
        notification: {
          channel_id: "workspace_updates",
          tag: "workspace-update",
        },
      },
    },
  };
}
export type PushSender = (token: string, eventId: string) => Promise<void>;
export function configuredSender(): PushSender | undefined {
  const keyFile = process.env.ORCHESTRATOR_FCM_CREDENTIALS;
  const projectId = process.env.ORCHESTRATOR_FCM_PROJECT;
  if (!keyFile && !projectId) return;
  if (!keyFile || !projectId)
    throw Error("FCM requires an explicit project and credentials file");
  const credentials = JSON.parse(readFileSync(keyFile, "utf8"));
  if (
    credentials.type !== "service_account" ||
    credentials.project_id !== projectId
  )
    throw Error("FCM credentials must belong to the configured project");
  const auth = new GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  return async (token, eventId) => {
    const client = await auth.getClient();
    const response = await client
      .request<any>({
        url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
        method: "POST",
        data: pushEnvelope(token, eventId),
        timeout: 15000,
      })
      .catch((error: any) => {
        // Never persist/log SDK errors: they may include Authorization or the device token.
        const invalid = error.response?.data?.error?.details?.some(
          (d: any) => d.errorCode === "UNREGISTERED",
        );
        throw Error(invalid ? "push-token-expired" : "push-delivery-failed");
      });
    if (!response.data?.name) throw Error("push-delivery-failed");
  };
}
export class PushDispatcher {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;
  private retryAt = 0;
  private failures = 0;
  constructor(
    private controller: WorkspaceController,
    private send: PushSender,
  ) {}
  register(token: string) {
    const c = this.controller;
    c.store.transaction(() => {
      if (!c.get("push:cursor")) {
        const row = c.store.db
          .prepare("SELECT COALESCE(MAX(id),0) AS n FROM notifications")
          .get()!;
        c.set("push:cursor", String(row.n));
      }
      c.set("push:token", token);
      c.set("push:status", "ready");
    });
    this.retryAt = 0;
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 2000);
  }
  tick(): Promise<void> {
    if (this.stopped || Date.now() < this.retryAt) return Promise.resolve();
    return (this.running ??= this.pump().finally(() => {
      this.running = undefined;
    }));
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }
  private async pump() {
    const c = this.controller;
    const token = c.get("push:token");
    if (!token) return;
    const tasks = new Map(c.snapshot().tasks.map((t) => [t.id, t]));
    const rows = c.store.db
      .prepare(
        "SELECT id,data FROM notifications WHERE id>? ORDER BY id LIMIT 100",
      )
      .all(Number(c.get("push:cursor") ?? 0)) as { id: number; data: string }[];
    for (const row of rows) {
      const n = JSON.parse(row.data);
      const task = tasks.get(n.taskId);
      // Successful children are summarized by the assistant first. Questions/errors wake directly.
      const eligible = task && (!task.parentTaskId || n.status !== "completed");
      if (eligible) {
        try {
          await this.send(token, String(row.id));
          this.failures = 0;
          c.set("push:status", "ready");
        } catch (e) {
          if (
            (e as Error).message === "push-token-expired" &&
            c.get("push:token") === token
          )
            c.set("push:token", "");
          c.set(
            "push:status",
            (e as Error).message === "push-token-expired"
              ? "token-expired"
              : "retrying",
          );
          this.retryAt =
            Date.now() +
            Math.min(300000, 1000 * 2 ** Math.min(++this.failures, 9));
          return; // Cursor survives restart; retry with the same opaque event ID.
        }
      }
      c.set("push:cursor", String(row.id));
    }
  }
}
