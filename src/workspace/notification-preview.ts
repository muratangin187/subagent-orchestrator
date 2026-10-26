import type { WorkspaceController } from "./controller.js";

export function notificationText(value: string, limit = 600): string {
  const plain = value
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/^[\s]*[>#-]+\s*/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(plain);
  return chars.length > limit
    ? chars.slice(0, limit - 1).join("") + "…"
    : plain;
}

// Resolve the immutable notification, not the task's possibly newer run result.
export function notificationPreview(
  c: WorkspaceController,
  query: { eventId?: number; taskId?: string },
) {
  if (query.taskId) c.engine.status(c.scope, query.taskId);
  const row = query.eventId
    ? c.store.db
        .prepare("SELECT id,data FROM notifications WHERE id=?")
        .get(query.eventId)
    : c.store.db
        .prepare(
          "SELECT id,data FROM notifications WHERE json_extract(data,'$.taskId')=? ORDER BY id DESC LIMIT 1",
        )
        .get(query.taskId!);
  if (!row) return undefined;
  const n = JSON.parse(row.data as string);
  const task = c.engine.status(c.scope, n.taskId);
  const fallback: Record<string, string> = {
    completed: "Yanıt hazır. Sohbeti açabilirsin.",
    waiting_question: "Devam etmek için yanıtın gerekiyor.",
    failed: "İş tamamlanamadı. Ayrıntıları sohbetten inceleyebilirsin.",
    recovery_required: "İşin devamı için kontrol gerekiyor.",
  };
  const text =
    n.status === "waiting_question"
      ? typeof n.question?.prompt === "string"
        ? n.question.prompt
        : ""
      : n.status === "completed" && typeof n.summary === "string"
        ? n.summary
        : "";
  return {
    eventId: String(row.id),
    taskId: n.taskId,
    title: notificationText(task.title || "Agent Workspace", 100),
    body:
      notificationText(text) ||
      fallback[n.status] ||
      "Asistanında yeni bir güncelleme var.",
  };
}
