import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  AudioInputSource,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import {
  Client,
  PcmCapture,
  active,
  sorted,
  status,
  truncate,
  pages,
  messageText,
  type Snapshot,
  type Event,
} from "./core";
type View = {
  kind:
    | "home"
    | "jobs"
    | "sessions"
    | "chat"
    | "record"
    | "notice"
    | "cancel"
    | "devices";
  id?: string;
  title: string;
  page: number;
  text?: string;
};
export class Glasses {
  private bridge?: EvenAppBridge;
  private ready = false;
  private renderChain = Promise.resolve();
  private eventChain = Promise.resolve();
  private selectedDevice = "";
  private view: View = { kind: "home", title: "Agent Workspace", page: 0 };
  private history: View[] = [];
  private rows: { label: string; run: () => void | Promise<void> }[] = [];
  private capture?: PcmCapture;
  private recordingTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private foreground = true;
  private unsubscribe?: () => void;
  private events = new Map<string, Event[]>();
  private cursors = new Map<string, number>();
  private older = new Map<string, number>();
  private snapshot: Snapshot = { tasks: [], inputs: [] };
  private transcriptPages = ["Henüz mesaj yok."];
  private lastRender = "";
  private disposed = false;
  private voiceBusy = false;
  private voiceStarting = false;
  private voiceContext?: string;
  private connectionError = false;
  private rootInitialized = false;
  private lastKind = "";
  constructor(
    private client: () => Client | undefined,
    private notify: (s: string) => void,
    private changed: (s: Snapshot) => void,
  ) {}
  async start(bridge?: EvenAppBridge) {
    this.bridge = bridge ?? (await waitForEvenAppBridge());
    if (this.disposed) return;
    this.unsubscribe = this.bridge.onEvenHubEvent((e) => {
      if (e.audioEvent) {
        try {
          if (this.capture?.append(e.audioEvent.audioPcm ?? new Uint8Array()))
            void this.stopRecording(true).catch((e) => this.failure(e));
        } catch (error) {
          void this.stopRecording(false);
          this.failure(error);
        }
        return;
      }
      this.eventChain = this.eventChain
        .then(() => this.input(e))
        .catch((e) => this.failure(e));
    });
    try {
      await this.render();
    } catch (error) {
      this.unsubscribe?.();
      this.bridge = undefined;
      throw error;
    }
    console.info("AGENT_G2_READY");
    this.schedule(0);
  }
  private failure(e: unknown, show = true) {
    const text = e instanceof Error ? e.message : "İşlem tamamlanamadı.";
    this.notify(text);
    if (show && this.ready && !this.capture && !this.disposed) {
      this.history.push({ ...this.view });
      this.view = { kind: "notice", title: "Kontrol gerekiyor", page: 0, text };
      void this.render().catch(() => {});
    }
  }
  private schedule(ms = 4000) {
    clearTimeout(this.pollTimer);
    if (!this.disposed)
      this.pollTimer = setTimeout(() => void this.refresh(), ms);
  }
  async refresh() {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      const c = this.client();
      if (!c) return;
      const snapshot = await c.state();
      if (c !== this.client() || this.disposed) return;
      this.snapshot = snapshot;
      this.connectionError = false;
      this.changed(this.snapshot);
      const root = this.snapshot.assistantId;
      if (root && this.view.id !== root) {
        const r = await c.messages(root, this.cursors.get(root) ?? 0);
        if (c !== this.client() || this.disposed) return;
        this.cursors.set(root, r.nextOffset);
        if (r.olderCursor && !this.events.has(root))
          this.older.set(root, r.olderCursor);
        this.events.set(root, [
          ...(this.events.get(root) ?? []),
          ...r.messages,
        ]);
        if (
          this.rootInitialized &&
          r.messages.some((e) => e.type === "assistant_message") &&
          this.view.kind === "home"
        )
          await this.chat(root, "Asistan · Yeni yanıt");
        if (r.messages.length < 200) this.rootInitialized = true;
      }
      if (this.view.kind === "chat" && this.view.id) {
        const id = this.view.id;
        const r = await c.messages(id, this.cursors.get(id) ?? 0);
        if (c !== this.client() || this.disposed) return;
        this.cursors.set(id, r.nextOffset);
        if (r.olderCursor && !this.events.has(id))
          this.older.set(id, r.olderCursor);
        const all = [...(this.events.get(id) ?? []), ...r.messages];
        this.events.set(id, [...new Map(all.map((e) => [e.id, e])).values()]);
        if (this.view.kind === "chat" && this.view.id === id) {
          const wasLast = this.view.page >= this.transcriptPages.length - 1;
          const task = this.snapshot.tasks.find((t) => t.id === id);
          const question = task?.question
            ? "\n\nYanıt bekleniyor · " +
              id +
              "\n" +
              (task.question.prompt.questions ?? [])
                .map((q) => q.question)
                .join("\n")
            : "";
          this.transcriptPages = pages(
            messageText(this.events.get(id)!) + question,
          );
          if (wasLast) this.view.page = this.transcriptPages.length - 1;
          await this.render();
        }
      } else if (this.view.kind === "home") await this.render();
    } catch (e) {
      this.connectionError = true;
      this.failure(e, false);
      await this.render().catch(() => {});
    } finally {
      this.polling = false;
      this.schedule(this.foreground ? 4000 : 15000);
    }
  }
  private async open(v: View) {
    this.history.push({ ...this.view });
    this.history = this.history.slice(-32);
    this.view = v;
    this.lastRender = "";
    await this.render();
    if (v.kind === "chat") void this.refresh();
  }
  async home() {
    await this.stopRecording(false);
    this.history = [];
    this.view = { kind: "home", title: "Agent Workspace", page: 0 };
    await this.render();
    void this.refresh();
  }
  async reset() {
    await this.stopRecording(false);
    this.snapshot = { tasks: [], inputs: [] };
    this.events.clear();
    this.cursors.clear();
    this.older.clear();
    this.rootInitialized = false;
    this.transcriptPages = ["Henüz mesaj yok."];
    await this.home();
  }
  async chat(id: string, title: string) {
    this.transcriptPages = pages(messageText(this.events.get(id) ?? []));
    await this.open({
      kind: "chat",
      id,
      title,
      page: this.transcriptPages.length - 1,
    });
  }
  private async back() {
    if (this.voiceBusy) return;
    if (this.capture) {
      await this.stopRecording(false);
      return;
    }
    const prev = this.history.pop();
    if (prev) {
      this.view = prev;
      if (prev.kind === "chat")
        this.transcriptPages = pages(
          messageText(this.events.get(prev.id!) ?? []),
        );
      await this.render();
    } else await this.bridge?.shutDownPageContainer(1);
  }
  private async input(e: EvenHubEvent) {
    const sys = e.sysEvent?.eventType;
    if (sys === 5 || sys === 6 || sys === 7) {
      this.foreground = false;
      await this.stopRecording(false);
      return;
    }
    if (sys === 4) {
      this.foreground = true;
      await this.refresh();
      return;
    }
    if (this.voiceBusy) return;
    if (e.menuItemClickEvent) {
      if (this.capture) await this.stopRecording(false);
      switch (e.menuItemClickEvent.itemID) {
        case 1:
          await this.home();
          break;
        case 2:
          await this.beginRecording();
          break;
        case 3:
          await this.open({ kind: "jobs", title: "İşler", page: 0 });
          break;
        case 4:
          await this.open({ kind: "sessions", title: "Oturumlar", page: 0 });
          break;
        case 5:
          await this.refresh();
          await this.render();
          break;
        case 6:
          if (this.view.kind === "chat" && this.view.id)
            await this.open({
              kind: "cancel",
              id: this.view.id,
              title: "İşi iptal et?",
              page: 0,
            });
          break;
      }
      return;
    }
    const event = e.listEvent ?? e.textEvent ?? e.sysEvent;
    if (!event) return;
    const type = event.eventType;
    if (type === 3) {
      await this.back();
      return;
    }
    if (this.voiceBusy) return;
    if (type === 9) {
      await this.beginRecording();
      return;
    }
    if (type === 10) return;
    if (e.listEvent && (type === 0 || type === undefined)) {
      const i = e.listEvent.currentSelectItemIndex ?? 0;
      await this.rows[i]?.run();
      return;
    }
    if (this.view.kind === "record" && (type === 0 || type === undefined)) {
      await this.stopRecording(true);
      return;
    }
    if (this.view.kind === "chat") {
      if (type === 1) {
        const id = this.view.id!;
        const before = this.older.get(id);
        if (this.view.page === 0 && before) {
          const r = await this.client()!.messages(id, 0, before);
          const oldLength = this.transcriptPages.length;
          this.events.set(id, [
            ...new Map(
              [...r.messages, ...(this.events.get(id) ?? [])].map((e) => [
                e.id,
                e,
              ]),
            ).values(),
          ]);
          if (r.olderCursor) this.older.set(id, r.olderCursor);
          else this.older.delete(id);
          this.transcriptPages = pages(messageText(this.events.get(id)!));
          this.view.page = Math.max(
            0,
            this.transcriptPages.length - oldLength - 1,
          );
        } else this.view.page = Math.max(0, this.view.page - 1);
      }
      if (type === 2)
        this.view.page = Math.min(
          this.transcriptPages.length - 1,
          this.view.page + 1,
        );
      await this.render();
    }
  }
  async beginRecording() {
    if (this.capture || this.voiceBusy || this.voiceStarting || this.disposed)
      return;
    if (!this.client()) throw Error("Önce telefondan sunucuya bağlan.");
    if (!this.ready) throw Error("Gözlük bağlantısı hazır değil.");
    this.voiceStarting = true;
    try {
      const voice = await this.client()!.request("/v1/voice/status");
      if (this.disposed || !this.foreground) return;
      if (!voice.configured)
        throw Error("Mobil uygulamadaki ElevenLabs bağlantısını tamamla.");
      this.voiceContext = this.view.kind === "chat" ? this.view.id : undefined;
      await this.open({ kind: "record", title: "Asistana konuş", page: 0 });
      this.capture = new PcmCapture();
      const capture = this.capture;
      try {
        if (!(await this.bridge!.audioControl(true, AudioInputSource.Glasses)))
          throw Error(
            "Mikrofon açılamadı. Even uygulamasında izni kontrol et.",
          );
        if (this.disposed || !this.foreground || this.capture !== capture) {
          await this.bridge!.audioControl(false);
          this.capture = undefined;
          return;
        }
        this.recordingTimer = setTimeout(
          () => void this.stopRecording(true).catch((e) => this.failure(e)),
          30000,
        );
      } catch (e) {
        this.capture = undefined;
        await this.back();
        throw e;
      }
    } finally {
      this.voiceStarting = false;
    }
  }
  async stopRecording(send: boolean) {
    if (!this.capture) return;
    const capture = this.capture;
    this.capture = undefined;
    clearTimeout(this.recordingTimer);
    try {
      await this.bridge?.audioControl(false);
    } catch (e) {
      this.failure(e);
    }
    if (!send) {
      this.view = this.history.pop() ?? {
        kind: "home",
        title: "Agent Workspace",
        page: 0,
      };
      await this.render();
      return;
    }
    this.voiceBusy = true;
    this.view = {
      kind: "notice",
      title: "Ses gönderiliyor",
      page: 0,
      text: "İstek işleniyor.\nLütfen bekle.\n\nTekrar otomatik gönderilmez.",
    };
    await this.render();
    try {
      await this.client()!.request("/v1/voice/transcribe", {
        clientRequestId: crypto.randomUUID(),
        audio: capture.finish(),
        ...(this.voiceContext
          ? { contextTaskId: this.voiceContext }
          : this.selectedDevice
            ? { deviceId: this.selectedDevice }
            : {}),
      });
      this.notify("Sesli mesaj asistana iletildi.");
      await this.home();
    } catch (e) {
      this.view = {
        kind: "notice",
        title: "Gönderim tamamlanamadı",
        page: 0,
        text:
          String(e instanceof Error ? e.message : e) +
          "\n\nSohbeti kontrol et. Belirsiz istek tekrarlanmadı.",
      };
      await this.render();
      this.failure(e);
    } finally {
      this.voiceBusy = false;
    }
  }
  private menu() {
    return new MenuContainerProperty({
      menuItems: [
        ["Asistan", 1],
        ["Konuş", 2],
        ["İşler", 3],
        ["Oturumlar", 4],
        ["Yenile", 5],
        ...(this.view.kind === "chat" ? [["İptal et", 6]] : []),
      ].map(
        ([name, id]) =>
          new MenuItemProperty({ itemName: String(name), itemID: Number(id) }),
      ),
    });
  }
  private async render() {
    this.renderChain = this.renderChain.catch(() => {}).then(() => this.draw());
    return this.renderChain;
  }
  private async draw() {
    if (!this.bridge || this.disposed) return;
    const v = this.view;
    let text = "";
    this.rows = [];
    const add = (label: string, run: () => void | Promise<void>) =>
      this.rows.push({ label, run });
    if (v.kind === "home") {
      add("Asistana konuş", () => this.beginRecording());
      add("Asistan sohbeti", async () => {
        if (this.snapshot.assistantId)
          await this.chat(this.snapshot.assistantId, "Asistan");
        else this.notify("İlk mesajını telefondan veya sesle gönder.");
      });
      add(
        `İşler · ${this.snapshot.tasks.filter((t) => active(t) && t.id !== this.snapshot.assistantId).length} aktif`,
        () => this.open({ kind: "jobs", title: "İşler", page: 0 }),
      );
      add("Oturumlar", () =>
        this.open({ kind: "sessions", title: "Oturumlar", page: 0 }),
      );
      add(
        `Cihaz · ${this.selectedDevice || this.snapshot.defaultDeviceId || "local"}`,
        () =>
          this.open({ kind: "devices", title: "Çalışacağı cihaz", page: 0 }),
      );
      add(this.client() ? "Bağlantıyı yenile" : "Telefondan bağlantı kur", () =>
        this.refresh(),
      );
    }
    if (v.kind === "devices") {
      for (const device of this.snapshot.devices ?? [])
        add(
          `${device.id === (this.selectedDevice || this.snapshot.defaultDeviceId) ? "✓ " : ""}${device.name}`,
          async () => {
            this.selectedDevice = device.id;
            await this.home();
          },
        );
    }
    if (v.kind === "jobs" || v.kind === "sessions") {
      const tasks = sorted(
        this.snapshot.tasks.filter(
          (t) =>
            t.id !== this.snapshot.assistantId &&
            (v.kind === "jobs"
              ? t.conversationKind !== "session"
              : t.conversationKind === "session"),
        ),
      );
      const start = v.page * 16;
      for (const t of tasks.slice(start, start + 16))
        add(
          `${t.deviceId ?? "local"} · ${status(t.status)} · ${truncate(t.title ?? t.task ?? t.id, 35)}`,
          () => this.chat(t.id, t.title ?? "İş"),
        );
      if (!tasks.length) add("Henüz kayıt yok", () => this.back());
      if (start + 16 < tasks.length)
        add("Sonraki sayfa", async () => {
          v.page++;
          await this.render();
        });
      if (v.page > 0)
        add("Önceki sayfa", async () => {
          v.page--;
          await this.render();
        });
    }
    if (v.kind === "cancel") {
      add("Vazgeç", () => this.back());
      add("İşi ve alt görevleri iptal et", async () => {
        await this.client()!.request("/v1/task/action", {
          taskId: v.id,
          action: "cancel",
          clientRequestId: crypto.randomUUID(),
        });
        await this.back();
        void this.refresh();
      });
    }
    if (v.kind === "chat")
      text = this.transcriptPages[v.page] ?? "Henüz mesaj yok.";
    if (v.kind === "record")
      text =
        "Dinliyorum…\n\nBitir ve gönder: tek dokun\nVazgeç: çift dokun\n\nEn fazla 30 saniye. Hedef: Asistan";
    if (v.kind === "notice") text = pages(v.text ?? "")[0];
    const header =
      truncate(v.title, 38) +
      (v.kind === "chat"
        ? `  ${v.page + 1}/${this.transcriptPages.length}`
        : "");
    const footer = this.connectionError
      ? "Bağlantı yok · Menüden Yenile · Son kayıtlar"
      : v.kind === "home"
        ? "Kaydır: seç · Dokun: aç · Çift: çıkış"
        : "Çift dokun: geri · Menü: dokun + basılı tut";
    const signature = JSON.stringify([
      header,
      text,
      footer,
      this.rows.map((r) => r.label),
      v.kind,
    ]);
    if (signature === this.lastRender) return;
    const texts = [
      new TextContainerProperty({
        xPosition: 12,
        yPosition: 4,
        width: 552,
        height: 36,
        containerID: 1,
        containerName: "title",
        content: header,
        isEventCapture: 0,
      }),
      new TextContainerProperty({
        xPosition: 12,
        yPosition: 256,
        width: 552,
        height: 32,
        containerID: 3,
        containerName: "footer",
        content: footer,
        isEventCapture: 0,
        textColor: 2,
      }),
    ];
    const lists: ListContainerProperty[] = [];
    if (this.rows.length)
      lists.push(
        new ListContainerProperty({
          xPosition: 12,
          yPosition: 44,
          width: 552,
          height: 208,
          containerID: 2,
          containerName: "body",
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: this.rows.length,
            itemWidth: 544,
            isItemSelectBorderEn: 1,
            itemName: this.rows.map((r) => truncate(r.label, 60)),
          }),
        }),
      );
    else
      texts.push(
        new TextContainerProperty({
          xPosition: 12,
          yPosition: 44,
          width: 552,
          height: 208,
          containerID: 2,
          containerName: "body",
          content: text || " ",
          isEventCapture: 1,
        }),
      );
    const payload = {
      containerTotalNum: 3,
      textObject: texts,
      listObject: lists,
      menuObject: this.menu(),
    };
    if (!this.ready) {
      const result = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer(payload),
      );
      if (result !== 0) throw Error(`Gözlük ekranı oluşturulamadı (${result})`);
      this.ready = true;
    } else if (!this.rows.length && this.lastKind === v.kind) {
      for (const t of texts) {
        if (
          !(await this.bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: t.containerID,
              containerName: t.containerName,
              content: t.content,
            }),
          ))
        )
          throw Error("Gözlük metni güncellenemedi.");
      }
    } else if (
      !(await this.bridge.rebuildPageContainer(
        new RebuildPageContainer(payload),
      ))
    )
      throw Error("Gözlük ekranı güncellenemedi.");
    this.lastRender = signature;
    this.lastKind = v.kind;
    console.info("G2_VIEW", v.kind, v.page);
  }
  async dispose() {
    this.disposed = true;
    clearTimeout(this.pollTimer);
    await this.stopRecording(false);
    this.unsubscribe?.();
  }
}
