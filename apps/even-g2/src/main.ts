import "./style.css";
import {
  Client,
  normalizedOrigin,
  sorted,
  status,
  messageText,
  type Snapshot,
  type Task,
  type Event,
} from "./core";
import { Glasses } from "./glasses";
const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `<header><span class="mark">A</span><div><small>AGENT WORKSPACE / G2</small><h1>Asistanın, gözlüğünde.</h1></div></header>
<p class="intro">Aynı asistan, aynı işler. Konuş, kısa yanıtları oku, ilerlemeyi takip et.</p>
<div id="notice" role="status" aria-live="polite">Gözlük köprüsü bekleniyor…</div>
<details id="connection" open><summary>Bağlantı ayarları</summary><form id="connect"><label>Bilgisayarın HTTPS adresi<input id="origin" type="url" placeholder="https://bilgisayar.tailnet.ts.net:9443" required></label><label>Cihaz bağlantı anahtarı<input id="token" type="password" autocomplete="off" required></label><label class="check"><input id="remember" type="checkbox"> Bu kişisel telefonda bağlantıyı hatırla</label><p class="hint">Anahtar yalnızca bu uygulamanın yerel deposunda tutulur. Ortak cihazda kaydetme. ElevenLabs anahtarını buraya girme.</p><label>Bağlantı dosyasını içe aktar<input id="connection-file" type="file" accept="application/json,.json"></label><div class="actions"><button>Bağlan</button><button id="disconnect" type="button" class="secondary">Bağlantıyı sil</button></div></form></details>
<nav><button id="assistant">Asistan</button><button id="jobs-tab" class="secondary">İşler</button><button id="sessions-tab" class="secondary">Oturumlar</button><button id="voice" class="secondary">Gözlükten konuş</button></nav>
<section id="tasks-section" hidden><h2 id="list-title">İşler</h2><div id="tasks"></div></section>
<section id="sessions-section" hidden><h2>Yeni oturum</h2><form id="new-session"><label>Cihaz<select id="device"></select></label><label>Sağlayıcı<select id="provider"><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label><label>Model (isteğe bağlı)<input id="model" placeholder="Sağlayıcının varsayılan modeli"></label><label>İlk mesaj<textarea id="first-message" required></textarea></label><button>Oturum başlat</button></form><h2>Terminal oturumları</h2><button id="native-load" class="secondary">Seçili sağlayıcının oturumlarını getir</button><div id="native-list"></div><button id="native-more" hidden class="secondary">Daha fazla</button></section>
<section><div class="section-title"><h2 id="chat-title">Asistan</h2><button id="refresh" class="secondary">Yenile</button></div><div id="questions"></div><div id="chat" aria-live="polite"><p class="hint">Bağlantı kurduğunda sohbet burada görünür.</p></div><button id="older" hidden class="secondary">Önceki mesajlar</button><form id="compose"><label>Mesaj<textarea id="message" maxlength="60000" required placeholder="Bugün ne yapalım?"></textarea></label><label class="file">Dosya ekle<input id="files" type="file" multiple accept=".txt,.md,.json,.csv,.log,.ts,.js,.py,.html,.pdf,.png,.jpg,.jpeg,.webp"></label><div id="attachments"></div><div class="actions"><button>Gönder</button><button id="cancel" type="button" class="danger" hidden>İşi iptal et</button></div></form></section>
<footer>Gözlük: kaydırarak seç, dokunarak aç, çift dokunarak geri dön. Ana sayfada çift dokunma sistemin çıkış penceresini açar. G2’de hoparlör ve kamera yoktur.</footer>`;
function el<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
function input(id: string) {
  return el<HTMLInputElement>(id);
}
function notify(s: string) {
  el("notice").textContent = s;
}
let client: Client | undefined;
let snapshot: Snapshot = { tasks: [], inputs: [] };
let selected = "assistant";
let list: "jobs" | "sessions" = "jobs";
let offset = 0;
let olderCursor: number | undefined;
let phoneEvents: Event[] = [];
let chatLoading = false;
let native:
  | { id: string; provider: string; title: string; deviceId?: string }
  | undefined;
let nativeCursor: string | undefined;
let attachments: { id: string; name: string }[] = [];
let working = false;
let generation = 0;
let renderedQuestion = "";
function c() {
  if (!client) throw Error("Önce sunucuya bağlan.");
  return client;
}
async function run(fn: () => Promise<void>) {
  if (working) return;
  working = true;
  try {
    await fn();
  } catch (e) {
    notify(e instanceof Error ? e.message : "İşlem başarısız.");
  } finally {
    working = false;
  }
}
const glasses = new Glasses(
  () => client,
  notify,
  (s) => {
    snapshot = s;
    const saved = localStorage.getItem("workspace-connection");
    if (saved && client) {
      const config = JSON.parse(saved);
      config.origin = client.origin;
      localStorage.setItem("workspace-connection", JSON.stringify(config));
    }
    renderTasks();
    if (!working)
      void loadMessages().catch((e) => notify(String(e.message ?? e)));
  },
);
void glasses
  .start()
  .catch((e) =>
    notify("Telefon arayüzü hazır. Gözlük için uygulamayı Even Hub içinde aç."),
  );
try {
  const saved = JSON.parse(
    localStorage.getItem("workspace-connection") ?? "null",
  );
  if (saved) {
    input("origin").value = saved.origin;
    input("token").value = saved.token;
    input("remember").checked = true;
    client = new Client(saved.origin, saved.token);
  }
} catch {
  localStorage.removeItem("workspace-connection");
}
input("message").value = sessionStorage.getItem("workspace-draft") ?? "";
input("message").oninput = () =>
  sessionStorage.setItem("workspace-draft", input("message").value);
function button(text: string, action: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "secondary row";
  b.textContent = text;
  b.onclick = action;
  return b;
}
function renderTasks() {
  const select = el<HTMLSelectElement>("device");
  const selectedDevice = select.value || snapshot.defaultDeviceId;
  select.replaceChildren(
    ...(snapshot.devices ?? []).map((d) => {
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = d.name;
      o.selected = d.id === selectedDevice;
      return o;
    }),
  );
  const target = el("tasks");
  target.replaceChildren();
  for (const t of sorted(
    snapshot.tasks.filter(
      (t) =>
        t.id !== snapshot.assistantId &&
        (list === "sessions"
          ? t.conversationKind === "session"
          : t.conversationKind !== "session"),
    ),
  )) {
    target.append(
      button(
        `${t.title ?? t.task ?? "İş"} · ${status(t.status)} · ${t.deviceId ?? "local"}`,
        () => void run(() => openChat(t.id, t.title ?? "İş")),
      ),
    );
  }
  if (!target.children.length) target.textContent = "Henüz kayıt yok.";
  renderQuestions();
}
function renderQuestions() {
  const target = el("questions");
  const t = snapshot.tasks.find(
    (t) =>
      t.id === (selected === "assistant" ? snapshot.assistantId : selected),
  );
  const key = t?.question ? t.id + ":" + t.question.id : "";
  if (key === renderedQuestion) return;
  renderedQuestion = key;
  target.replaceChildren();
  if (!t?.question) return;
  const form = document.createElement("form");
  const title = document.createElement("h3");
  title.textContent = "Yanıtın gerekiyor";
  form.append(title);
  for (const q of t.question.prompt.questions ?? []) {
    const label = document.createElement("label");
    label.textContent = q.question;
    const field = document.createElement("input");
    field.name = t.provider === "codex" ? q.id : q.question;
    field.required = true;
    label.append(field);
    form.append(label);
  }
  const send = document.createElement("button");
  send.textContent = "Yanıtla";
  form.append(send);
  form.onsubmit = (e) => {
    e.preventDefault();
    void run(async () => {
      const answer: Record<string, unknown> = {};
      for (const [key, v] of new FormData(form))
        answer[key] = t.provider === "codex" ? { answers: [v] } : v;
      await c().request("/v1/task/action", {
        clientRequestId: crypto.randomUUID(),
        taskId: t.id,
        questionId: t.question!.id,
        action: "answer",
        answer,
      });
      notify("Yanıt iletildi.");
      await refresh();
    });
  };
  target.append(form);
}
async function openChat(id: string, title: string) {
  selected = id;
  native = undefined;
  offset = 0;
  phoneEvents = [];
  olderCursor = undefined;
  el("chat-title").textContent = title;
  el("cancel").hidden = id === "assistant";
  await loadMessages();
  if (id !== "assistant") void glasses.chat(id, title).catch(notify);
}
async function loadMessages() {
  if (native) return;
  const id = selected === "assistant" ? snapshot.assistantId : selected;
  if (!id) {
    el("chat").textContent = "İlk mesajını gönder.";
    return;
  }
  if (chatLoading) return;
  chatLoading = true;
  const currentClient = c();
  try {
    const r = await currentClient.messages(id, offset);
    if (
      currentClient !== client ||
      native ||
      id !== (selected === "assistant" ? snapshot.assistantId : selected)
    )
      return;
    phoneEvents = [
      ...new Map(
        [...phoneEvents, ...r.messages].map((e) => [e.id, e]),
      ).values(),
    ];
    const chat = el("chat");
    const bottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
    chat.textContent = messageText(phoneEvents) || "Henüz mesaj yok.";
    if (bottom) chat.scrollTop = chat.scrollHeight;
    offset = r.nextOffset;
    if (phoneEvents.length === r.messages.length)
      olderCursor = r.olderCursor ?? undefined;
    el("older").hidden = !olderCursor;
  } finally {
    chatLoading = false;
  }
  renderQuestions();
}
async function refresh() {
  const currentClient = c();
  const next = await currentClient.state();
  if (currentClient !== client) return;
  snapshot = next;
  const saved = localStorage.getItem("workspace-connection");
  if (saved) {
    const config = JSON.parse(saved);
    config.origin = c().origin;
    localStorage.setItem("workspace-connection", JSON.stringify(config));
  }
  input("origin").value = c().origin;
  renderTasks();
  await loadMessages();
  notify("Bilgisayar bağlı.");
  void glasses.refresh();
}
el("connect").onsubmit = (e) => {
  e.preventDefault();
  void run(async () => {
    const origin = normalizedOrigin(input("origin").value);
    const token = input("token").value.trim();
    const epoch = ++generation;
    const proposed = new Client(origin, token);
    const next = await proposed.state();
    if (epoch !== generation) return;
    snapshot = next;
    client = proposed;
    if (input("remember").checked)
      localStorage.setItem(
        "workspace-connection",
        JSON.stringify({ origin, token }),
      );
    else localStorage.removeItem("workspace-connection");
    el<HTMLDetailsElement>("connection").open = false;
    phoneEvents = [];
    offset = 0;
    await glasses.reset();
    await refresh();
  });
};
input("connection-file").onchange = () =>
  void run(async () => {
    const file = input("connection-file").files?.[0];
    if (!file || file.size > 8192)
      throw Error("Geçerli bir bağlantı dosyası seç.");
    const config = JSON.parse(await file.text());
    const origin = normalizedOrigin(config.origin);
    if (
      typeof config.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(config.token)
    )
      throw Error("Geçersiz bağlantı anahtarı.");
    // Bind the credential to its declared destination; do not send it to a form's old URL.
    const epoch = ++generation;
    const proposed = new Client(origin, config.token);
    const next = await proposed.state();
    if (epoch !== generation) return;
    snapshot = next;
    client = proposed;
    input("origin").value = origin;
    input("token").value = config.token;
    if (input("remember").checked)
      localStorage.setItem("workspace-connection", JSON.stringify(config));
    else localStorage.removeItem("workspace-connection");
    input("connection-file").value = "";
    el<HTMLDetailsElement>("connection").open = false;
    await glasses.reset();
    await refresh();
  });
el("disconnect").onclick = () => {
  generation++;
  renderedQuestion = "";
  el("questions").replaceChildren();
  client = undefined;
  localStorage.removeItem("workspace-connection");
  input("token").value = "";
  snapshot = { tasks: [], inputs: [] };
  attachments = [];
  el("chat").replaceChildren();
  el("tasks").replaceChildren();
  el("native-list").replaceChildren();
  el("attachments").replaceChildren();
  phoneEvents = [];
  offset = 0;
  void glasses.reset();
  notify("Yerel bağlantı silindi.");
};
el("assistant").onclick = () =>
  void run(() => openChat("assistant", "Asistan"));
el("jobs-tab").onclick = () => {
  list = "jobs";
  el("tasks-section").hidden = false;
  el("sessions-section").hidden = true;
  el("list-title").textContent = "İşler";
  renderTasks();
};
el("sessions-tab").onclick = () => {
  list = "sessions";
  el("tasks-section").hidden = false;
  el("sessions-section").hidden = false;
  el("list-title").textContent = "Oturumlar";
  renderTasks();
};
el("voice").onclick = () => void run(() => glasses.beginRecording());
el("refresh").onclick = () => void run(refresh);
el("older").onclick = () =>
  void run(async () => {
    const id = selected === "assistant" ? snapshot.assistantId : selected;
    if (!id || !olderCursor || native) return;
    const r = await c().messages(id, 0, olderCursor);
    phoneEvents = [...r.messages, ...phoneEvents];
    olderCursor = r.olderCursor ?? undefined;
    el("chat").textContent = messageText(phoneEvents);
    el("older").hidden = !olderCursor;
  });
el("compose").onsubmit = (e) => {
  e.preventDefault();
  void run(async () => {
    const text = input("message").value.trim();
    if (!text) return;
    let extra: Record<string, unknown> = {
      attachments: attachments.map((a) => a.id),
    };
    if (native) {
      if (
        !confirm(
          "Terminaldeki aktif turu durdurdun mu? Aynı oturuma iki yerden eşzamanlı mesaj gönderme.",
        )
      )
        return;
      extra = {
        ...extra,
        nativeId: native.id,
        provider: native.provider,
        deviceId: native.deviceId,
        confirmExternal: true,
      };
      selected = "new";
    }
    await c().send(selected, text, crypto.randomUUID(), extra);
    input("message").value = "";
    sessionStorage.removeItem("workspace-draft");
    attachments = [];
    el("attachments").replaceChildren();
    notify("Mesaj sıraya alındı.");
    if (selected === "new") {
      selected = "assistant";
      native = undefined;
    }
    await refresh();
  });
};
el("cancel").onclick = () =>
  void run(async () => {
    if (!confirm("Bu iş ve tüm alt görevleri iptal edilsin mi?")) return;
    await c().request("/v1/task/action", {
      taskId: selected,
      action: "cancel",
      clientRequestId: crypto.randomUUID(),
    });
    await refresh();
  });
el("new-session").onsubmit = (e) => {
  e.preventDefault();
  void run(async () => {
    const text = input("first-message").value.trim();
    await c().send("new", text, crypto.randomUUID(), {
      provider: input("provider").value,
      deviceId: input("device").value || snapshot.defaultDeviceId,
      ...(input("model").value.trim()
        ? { model: input("model").value.trim() }
        : {}),
      title: text.slice(0, 80),
    });
    input("first-message").value = "";
    await refresh();
    notify("Yeni oturum sıraya alındı. Oturumlar listesinde görünecek.");
  });
};
async function loadNative(more = false) {
  const provider = input("provider").value;
  const r = await c().request(
    `/v1/native?deviceId=${input("device").value || snapshot.defaultDeviceId || "local"}&provider=${provider}${more && nativeCursor ? "&cursor=" + encodeURIComponent(nativeCursor) : ""}`,
  );
  nativeCursor = r.nextCursor;
  el("native-more").hidden = !nativeCursor;
  const list = el("native-list");
  if (!more) list.replaceChildren();
  for (const s of r.sessions)
    list.append(
      button(
        `${s.title} · ${s.provider}`,
        () =>
          void run(async () => {
            native = s;
            selected = "native";
            el("chat-title").textContent = s.title;
            el("cancel").hidden = true;
            const r = await c().request(
              `/v1/native/messages?provider=${s.provider}&id=${s.id}&deviceId=${s.deviceId || "local"}`,
            );
            const text =
              s.provider === "codex"
                ? (r.thread?.turns ?? [])
                    .flatMap((t: any) =>
                      (t.items ?? []).flatMap((i: any) =>
                        i.text
                          ? [i.text]
                          : (i.content ?? [])
                              .filter((p: any) => p.type === "text")
                              .map((p: any) => p.text),
                      ),
                    )
                    .join("\n\n")
                : (r.messages ?? [])
                    .map((m: any) =>
                      typeof m.message?.content === "string"
                        ? m.message.content
                        : (m.message?.content ?? [])
                            .filter((p: any) => p.type === "text")
                            .map((p: any) => p.text)
                            .join("\n"),
                    )
                    .join("\n\n");
            el("chat").textContent = text || "Bu sayfada metin yok.";
            el("older").hidden = true;
            el("questions").replaceChildren();
            notify(
              "Terminal oturumu. Devam etmeden önce terminalde aktif tur olmadığını doğrula.",
            );
          }),
      ),
    );
}
el("native-load").onclick = () => void run(() => loadNative());
el("native-more").onclick = () => void run(() => loadNative(true));
function renderAttachments() {
  el("attachments").replaceChildren();
  for (const a of attachments)
    el("attachments").append(
      button(a.name + " · kaldır", () => {
        attachments = attachments.filter((x) => x.id !== a.id);
        renderAttachments();
      }),
    );
}
input("files").onchange = () =>
  void run(async () => {
    const files = Array.from(input("files").files ?? []);
    if (files.length + attachments.length > 5)
      throw Error("Bir mesajda en fazla 5 dosya.");
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024)
        throw Error("Dosya en fazla 5 MiB olmalı.");
      const b = new Uint8Array(await file.arrayBuffer());
      let raw = "";
      for (let i = 0; i < b.length; i += 8192)
        raw += String.fromCharCode(...b.subarray(i, i + 8192));
      const a = await c().request("/v1/upload", {
        id: crypto.randomUUID(),
        name: file.name,
        content: btoa(raw),
      });
      attachments.push(a);
      renderAttachments();
    }
    input("files").value = "";
  });
window.addEventListener("pagehide", () => void glasses.dispose());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void glasses.stopRecording(false);
  else if (client) void run(refresh);
});
const poll = setInterval(() => {
  if (client && !working && !document.hidden) void run(refresh);
}, 4000);
window.addEventListener("pagehide", () => clearInterval(poll));
if (client) void run(refresh);
