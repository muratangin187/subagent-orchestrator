import { projectMessages } from "./timeline.mjs";
export type Task = {
  runId?: string;
  deviceId?: string;
  id: string;
  title?: string;
  task?: string;
  provider: string;
  model?: string;
  effort?: string;
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
  queuedMessages?: { id: string; taskId: string; text: string }[];
  localDeviceId?: string;
  defaultDeviceId?: string;
  devices?: { id: string; name: string; cwd: string; online?: boolean }[];
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
export type Event = {
  runId?: string;
  created?: number;
  id: number;
  type: string;
  payload: Record<string, any>;
};
export type Message = {
  runId?: string;
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
      copyText(text: string): Promise<void>;
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
export const toMessages = (events: Event[]): Message[] =>
  projectMessages(events);
