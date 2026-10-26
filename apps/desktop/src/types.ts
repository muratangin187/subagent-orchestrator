export type Task = {
  deviceId?: string;
  id: string;
  title?: string;
  task?: string;
  provider: string;
  status: string;
  parentTaskId?: string;
  conversationKind?: string;
  updatedAt: number;
  createdAt: number;
  question?: {
    id: string;
    prompt: {
      questions?: {
        id: string;
        question: string;
        options?: { label: string }[];
      }[];
    };
  };
};
export type Snapshot = {
  localDeviceId?: string;
  defaultDeviceId?: string;
  devices?: {id:string;name:string;cwd:string;online?:boolean}[];
  assistantId?: string;
  tasks: Task[];
  inputs: {
    id: string;
    taskId: string;
    body: string;
    displayText?: string;
    state: string;
  }[];
};
export type Event = { id: number; type: string; payload: Record<string, any> };
export type Message = {
  id: string;
  role: string;
  text: string;
  attachments?: { id: string; name: string }[];
};
export type Native = {
  deviceId?: string;
  id: string;
  provider: string;
  title: string;
  cwd?: string;
};
declare global {
  interface Window {
    desktop: {
      microphoneAccess(): Promise<boolean>;
      connection(): Promise<{ connected: boolean; origin?: string }>;
      connectLocal(): Promise<unknown>;
      importConnection(): Promise<unknown>;
      disconnect(): Promise<void>;
      request<T = any>(path: string, body?: unknown): Promise<T>;
      openLink(url: string): Promise<void>;
      saveAttachment(id: string): Promise<boolean>;
      openAttachment(id: string): Promise<void>;
      notify(id: string): Promise<void>;
      onCommand(fn: (cmd: string) => void): () => void;
    };
  }
}
export const request = <T = any>(p: string, b?: unknown) =>
  window.desktop.request<T>(p, b);
export const isActive = (t: Task) =>
  !["completed", "failed", "cancelled"].includes(t.status);
export const title = (t: Task) =>
  t.title || t.task?.split("\n")[0] || "İsimsiz oturum";
export const ordered = (ts: Task[]) =>
  [...ts].sort(
    (a, b) =>
      Number(isActive(b)) - Number(isActive(a)) || b.updatedAt - a.updatedAt,
  );
export const labels: Record<string, string> = {
  running: "Çalışıyor",
  queued: "Sırada",
  starting: "Başlıyor",
  completed: "Tamamlandı",
  failed: "Hata",
  cancelled: "İptal",
  waiting_question: "Yanıt bekliyor",
  recovery_required: "Kontrol gerekli",
  waiting: "Bekliyor",
};
export function toMessages(events: Event[]): Message[] {
  return events.flatMap((e) => {
    const p = e.payload;
    if (e.type === "assistant_message")
      return [{ id: String(e.id), role: "assistant", text: p.text || "" }];
    if (["task_created", "message_queued"].includes(e.type)) {
      const text = p.displayText || p.message || p.task || "";
      return text.startsWith("Background task event")
        ? []
        : [
            {
              id: String(e.id),
              role: "user",
              text,
              attachments: p.attachments,
            },
          ];
    }
    if (e.type === "failed")
      return [
        {
          id: String(e.id),
          role: "error",
          text: p.message || p.error || "İş tamamlanamadı.",
        },
      ];
    return [];
  });
}
