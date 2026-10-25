import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { WorkspaceController } from "./controller.js";

const configSchema = z
  .object({
    apiKey: z.string().min(10).max(512).optional(),
    voiceId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .max(100)
      .optional(),
  })
  .strict();
export class VoiceService {
  private readonly configPath: string;
  private busy = false;
  private readonly synthesis = new Map<string, Promise<void>>();
  constructor(
    private controller: WorkspaceController,
    private home: string,
    private http: typeof fetch = fetch,
  ) {
    this.configPath = join(home, "elevenlabs.json");
    controller.store.db.exec(
      "CREATE TABLE IF NOT EXISTS workspace_voice_requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT)",
    );
  }
  private config(): { apiKey?: string; voiceId?: string } {
    return existsSync(this.configPath)
      ? JSON.parse(readFileSync(this.configPath, "utf8"))
      : { apiKey: process.env.ELEVENLABS_API_KEY };
  }
  status() {
    const c = this.config();
    const root = this.controller.get("assistant");
    const row = root
      ? this.controller.store.db
          .prepare(
            "SELECT COALESCE(MAX(id),0) AS n FROM events WHERE task_id=?",
          )
          .get(root)
      : undefined;
    return {
      configured: !!c.apiKey,
      voiceId: c.voiceId ?? null,
      cursor: Number(row?.n ?? 0),
    };
  }
  private async request(
    path: string,
    init: RequestInit = {},
    key = this.config().apiKey,
  ) {
    if (!key) throw Error("ElevenLabs bağlantısını Ayarlar bölümünden ekle.");
    let response: Response;
    try {
      response = await this.http("https://api.elevenlabs.io" + path, {
        ...init,
        headers: { ...init.headers, "xi-api-key": key },
        signal: AbortSignal.timeout(40000),
      });
    } catch {
      throw Error(
        "ElevenLabs bağlantısı tamamlanamadı. İsteğin durumunu kontrol etmeden tekrar göndermeyin.",
      );
    }
    if (!response.ok)
      throw Error(
        response.status === 401 || response.status === 403
          ? "ElevenLabs anahtarı veya yetkileri geçersiz."
          : response.status === 429
            ? "ElevenLabs kullanım limiti doldu. Daha sonra tekrar deneyin."
            : "ElevenLabs isteği başarısız oldu (" + response.status + ").",
      );
    return response;
  }
  async voices(key?: string) {
    if (!key && !this.config().apiKey) return { voices: [] };
    const result = (await (
      await this.request("/v2/voices?page_size=100", {}, key)
    ).json()) as any;
    return {
      voices: (result.voices ?? []).map((v: any) => ({
        id: v.voice_id,
        name: v.name,
        language: v.labels?.language ?? "",
      })),
    };
  }
  async configure(body: unknown) {
    const args = configSchema.parse(body);
    const prior = this.config();
    const key = args.apiKey ?? prior.apiKey;
    if (!key) throw Error("ElevenLabs API anahtarı gerekli.");
    const catalog = await this.voices(key);
    const voiceId = args.voiceId ?? prior.voiceId ?? catalog.voices[0]?.id;
    if (!catalog.voices.some((v: any) => v.id === voiceId))
      throw Error("Bu hesapta seçilen ses kullanılamıyor.");
    writeFileSync(
      this.configPath + ".tmp",
      JSON.stringify({ apiKey: key, voiceId }),
      { mode: 0o600 },
    );
    renameSync(this.configPath + ".tmp", this.configPath);
    return { ...this.status(), ...catalog };
  }
  events(after: number) {
    const root = this.controller.get("assistant");
    if (!root) return { events: [], cursor: after };
    const page = this.controller.store.events(root, after, 200);
    return {
      cursor: page.nextOffset,
      events: page.messages
        .filter((e) =>
          ["assistant_message", "failed", "question", "cancelled"].includes(
            e.type,
          ),
        )
        .map((e) => ({ id: e.id, type: e.type })),
    };
  }
  async transcribe(body: unknown) {
    const a = z
      .object({
        clientRequestId: z.string().uuid(),
        audio: z.string().min(100).max(1_300_000),
      })
      .strict()
      .parse(body);
    const audio = Buffer.from(a.audio, "base64");
    if (audio.length < 3200 || audio.length > 960000 || audio.length % 2)
      throw Error("Ses kaydı 0,1–30 saniye, 16 kHz mono PCM olmalı.");
    const db = this.controller.store.db;
    const hash = createHash("sha256").update(audio).digest("hex");
    const prior = db
      .prepare("SELECT * FROM workspace_voice_requests WHERE id=?")
      .get(a.clientRequestId) as any;
    if (prior) {
      if (prior.hash !== hash) throw Error("Voice request payload conflict");
      if (prior.state === "done") return JSON.parse(prior.result);
      throw Error(
        "Bu ses isteğinin sonucu belirsiz; otomatik tekrar yapılmadı.",
      );
    }
    if (this.busy) throw Error("Ses işleniyor; lütfen bekleyin.");
    if (!this.config().apiKey)
      throw Error("ElevenLabs bağlantısını Ayarlar bölümünden ekle.");
    this.busy = true;
    db.prepare(
      "INSERT INTO workspace_voice_requests VALUES(?,?,'started',NULL)",
    ).run(a.clientRequestId, hash);
    try {
      const data = new FormData();
      data.set("model_id", "scribe_v2");
      data.set("language_code", "tr");
      data.set("tag_audio_events", "false");
      data.set("file_format", "pcm_s16le_16");
      data.set("file", new Blob([audio]), "speech.pcm");
      const r = (await (
        await this.request("/v1/speech-to-text", { method: "POST", body: data })
      ).json()) as any;
      const text = z.string().trim().min(1).max(6000).parse(r.text);
      const result = this.controller.submit({
        id: "voice:" + a.clientRequestId,
        target: "assistant",
        provider: "codex",
        kind: "assistant",
        displayText: text,
        body:
          text +
          "\n\n[Voice reply preference: respond briefly in natural Turkish suitable for speech. Delegate long work asynchronously and acknowledge briefly. Do not wait for children.]",
      });
      db.prepare(
        "UPDATE workspace_voice_requests SET state='done',result=? WHERE id=?",
      ).run(JSON.stringify(result), a.clientRequestId);
      return result;
    } finally {
      this.busy = false;
    }
  }
  async speech(body: unknown) {
    const a = z
      .object({ eventId: z.number().int().positive() })
      .strict()
      .parse(body);
    const root = this.controller.get("assistant");
    const e = this.controller.store.db
      .prepare(
        "SELECT data FROM events WHERE id=? AND task_id=? AND type='assistant_message'",
      )
      .get(a.eventId, root ?? "") as any;
    if (!e) throw Error("Asistan yanıtı bulunamadı.");
    const payload = JSON.parse(e.data);
    const text = String(payload.text ?? "")
      .replace(/```[\s\S]*?```/g, " Kod ayrıntıları sohbette. ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*#`_]/g, "")
      .slice(0, 4000);
    if (!text.trim()) throw Error("Seslendirilecek metin yok.");
    const config = this.config();
    if (!config.voiceId) throw Error("Ayarlar bölümünden bir ses seç.");
    const voiceId = config.voiceId;
    const dir = join(this.home, "voice-cache");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(
      dir,
      createHash("sha256")
        .update(config.voiceId + ":" + a.eventId)
        .digest("hex") + ".mp3",
    );
    if (!existsSync(path)) {
      let pending = this.synthesis.get(path);
      if (!pending) {
        pending = (async () => {
          const response = await this.request(
            "/v1/text-to-speech/" +
              encodeURIComponent(voiceId) +
              "?output_format=mp3_44100_128",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                model_id: "eleven_multilingual_v2",
              }),
            },
          );
          const audio = Buffer.from(await response.arrayBuffer());
          if (audio.length > 12 * 1024 * 1024)
            throw Error("Ses yanıtı çok büyük.");
          writeFileSync(path + ".tmp", audio, { mode: 0o600 });
          renameSync(path + ".tmp", path);
        })();
        this.synthesis.set(path, pending);
      }
      try {
        await pending;
      } finally {
        if (this.synthesis.get(path) === pending) this.synthesis.delete(path);
      }
    }
    return { audio: readFileSync(path).toString("base64"), mime: "audio/mpeg" };
  }
}
