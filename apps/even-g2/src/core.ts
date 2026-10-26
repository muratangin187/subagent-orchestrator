export type Task = {
  deviceId?: string;
  id: string;
  title?: string;
  task?: string;
  status: string;
  provider: string;
  updatedAt: number;
  createdAt: number;
  parentTaskId?: string;
  conversationKind?: string;
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
  devices?: { id: string; name: string; cwd: string }[];
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
  id: number;
  type: string;
  payload: Record<string, unknown>;
};
export type Messages = {
  messages: Event[];
  nextOffset: number;
  status: unknown;
  olderCursor?: number | null;
};
export function active(t: Task) {
  return !["completed", "failed", "cancelled"].includes(t.status);
}
export function sorted(tasks: Task[]) {
  return [...tasks].sort(
    (a, b) =>
      Number(active(b)) - Number(active(a)) ||
      b.updatedAt - a.updatedAt ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id),
  );
}
export function status(s: string) {
  return (
    (
      {
        running: "Çalışıyor",
        queued: "Sırada",
        completed: "Tamamlandı",
        failed: "Hata",
        cancelled: "İptal",
        waiting_question: "Yanıt bekliyor",
        recovery_required: "Kontrol gerekli",
      } as Record<string, string>
    )[s] ?? s
  );
}
export function plain(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "[Kod ayrıntısı telefonda]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, "")
    .trim();
}
export function truncate(text: string, n = 44) {
  const chars = Array.from(plain(text).replace(/\s+/g, " "));
  return chars.length > n
    ? chars.slice(0, n - 1).join("") + "…"
    : chars.join("");
}
// Fixed line budget bounds the text even with very long words or emoji.
export function pages(text: string, columns = 42, rows = 6) {
  const lines: string[] = [];
  for (const paragraph of plain(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      for (let part of Array.from(word)
        .join("")
        .match(new RegExp(`.{1,${columns}}`, "gu")) ?? [""]) {
        if (Array.from(line + (line ? " " : "") + part).length > columns) {
          lines.push(line);
          line = "";
        }
        line += (line ? " " : "") + part;
      }
    }
    lines.push(line);
  }
  const result: string[] = [];
  for (let i = 0; i < lines.length; i += rows)
    result.push(lines.slice(i, i + rows).join("\n"));
  return result.length ? result : ["Henüz mesaj yok."];
}
export function messageText(events: Event[]) {
  return events
    .flatMap((e) => {
      const p = e.payload;
      if (e.type === "assistant_message")
        return ["Asistan\n" + String(p.text ?? "")];
      if (e.type === "task_created" || e.type === "message_queued") {
        const text = String(p.message ?? p.task ?? "");
        return text.startsWith("Background task event") ? [] : ["Sen\n" + text];
      }
      if (e.type === "failed")
        return ["Hata\n" + String(p.message ?? p.error ?? "Görev başarısız")];
      return [];
    })
    .join("\n\n");
}
export function normalizedOrigin(value: string) {
  const u = new URL(value.trim());
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      ))
  )
    throw Error(
      "HTTPS sunucu adresi gir. Yerelde yalnızca localhost kullanılabilir.",
    );
  return u.origin;
}
export class Client {
  constructor(
    public origin: string,
    private token: string,
    private http: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    this.origin = normalizedOrigin(origin);
  }
  async request<T = any>(path: string, body?: unknown): Promise<T> {
    const r = await this.http(this.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + this.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(body ? 50000 : 15000),
    }).catch(() => {
      throw Error(
        body === undefined
          ? "Sunucuya ulaşılamıyor. Tailscale bağlantısını kontrol et."
          : "Gönderim sonucu belirsiz. Sohbeti kontrol et; istek otomatik tekrarlanmadı.",
      );
    });
    const data = await r.json();
    if (!r.ok)
      throw Error(
        r.status === 401
          ? "Bağlantı anahtarı geçersiz. Telefon ayarlarını aç."
          : String(data.error ?? `Sunucu hatası (${r.status})`),
      );
    if (path === "/v1/state" && data.coordinatorUrl) {
      const next = normalizedOrigin(data.coordinatorUrl);
      if (
        !next.startsWith("https://") ||
        !new URL(next).hostname.endsWith(".ts.net")
      )
        throw Error("Invalid coordinator address");
      this.origin = next;
    }
    return data;
  }
  state() {
    return this.request<Snapshot>("/v1/state");
  }
  messages(id: string, after = 0, before?: number) {
    return this.request<Messages>(
      `/v1/messages?taskId=${encodeURIComponent(id)}&after=${after}${before ? "&before=" + before : after === 0 ? "&tail=true" : ""}`,
    );
  }
  send(
    target: string,
    text: string,
    id = crypto.randomUUID(),
    extra: Record<string, unknown> = {},
  ) {
    return this.request(
      target === "assistant"
        ? "/v1/assistant/messages"
        : target === "new"
          ? "/v1/sessions/messages"
          : `/v1/tasks/${encodeURIComponent(target)}/messages`,
      { clientRequestId: id, text, ...extra },
    );
  }
}
export class PcmCapture {
  private chunks: Uint8Array[] = [];
  bytes = 0;
  append(chunk: Uint8Array) {
    if (chunk.length % 2) throw Error("Geçersiz PCM paketi");
    const take = Math.min(chunk.length, 960000 - this.bytes);
    this.chunks.push(chunk.slice(0, take));
    this.bytes += take;
    return this.bytes >= 960000;
  }
  finish() {
    if (this.bytes < 3200) throw Error("Kayıt çok kısa. Tekrar konuş.");
    const b = new Uint8Array(this.bytes);
    let at = 0;
    for (const c of this.chunks) {
      b.set(c, at);
      at += c.length;
    }
    let s = "";
    for (let i = 0; i < b.length; i += 8192)
      s += String.fromCharCode(...b.subarray(i, i + 8192));
    return btoa(s);
  }
}
