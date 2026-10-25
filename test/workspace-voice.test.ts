import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { VoiceService } from "../src/workspace/voice.js";

test("voice credentials stay server-side, transcript retries deduplicate and ambiguous failures never replay", async () => {
  const home = mkdtempSync(join(tmpdir(), "voice-test-"));
  const store = new Store(join(home, "state.sqlite"));
  const submissions: any[] = [];
  let transcriptionCalls = 0;
  let fail = false;
  const c: any = {
    store,
    get: () => undefined,
    submit: (input: any) => {
      submissions.push(input);
      return { commandId: input.id };
    },
  };
  const requests: any[] = [];
  const http: any = async (url: string, init: any) => {
    requests.push({ url, init });
    if (url.includes("/voices"))
      return Response.json({
        voices: [{ voice_id: "voice1", name: "Test voice" }],
      });
    transcriptionCalls++;
    if (fail) return new Response("sensitive upstream error", { status: 429 });
    return Response.json({ text: "Test görevini başlat." });
  };
  try {
    const voice = new VoiceService(c, home, http);
    assert.equal(voice.status().configured, false);
    const status = await voice.configure({
      apiKey: "test-only-not-a-real-key",
      voiceId: "voice1",
    });
    assert.equal(status.configured, true);
    assert(!JSON.stringify(status).includes("test-only"));
    assert.equal(statSync(join(home, "elevenlabs.json")).mode & 0o777, 0o600);
    const a = {
      clientRequestId: "12345678-1234-4234-8234-123456789abc",
      audio: Buffer.alloc(6400, 1).toString("base64"),
    };
    await voice.transcribe(a);
    await voice.transcribe(a);
    assert.equal(transcriptionCalls, 1);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].displayText, "Test görevini başlat.");
    assert.match(submissions[0].body, /Voice reply preference/);
    await assert.rejects(
      voice.transcribe({
        ...a,
        audio: Buffer.alloc(6400, 2).toString("base64"),
      }),
      /conflict/,
    );
    fail = true;
    const b = { ...a, clientRequestId: "22345678-1234-4234-8234-123456789abc" };
    await assert.rejects(voice.transcribe(b), /limit/);
    await assert.rejects(voice.transcribe(b), /belirsiz/);
    assert.equal(transcriptionCalls, 2);
    assert.equal(requests[1].init.body.get("model_id"), "scribe_v2");
    await assert.rejects(voice.speech({ eventId: 1 }), /bulunamadı/);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("concurrent speech requests share synthesis and only root replies can be spoken", async () => {
  const home = mkdtempSync(join(tmpdir(), "voice-speech-"));
  let calls = 0;
  const controller: any = {
    get: () => "root",
    store: {
      db: {
        exec: () => {},
        prepare: (sql: string) => ({
          get: (id: number, root: string) =>
            sql.includes("MAX")
              ? { n: 1 }
              : id === 1 && root === "root"
                ? { data: JSON.stringify({ text: "**Tamam**, iş bitti." }) }
                : undefined,
        }),
      },
    },
  };
  const http: any = async (url: string) => {
    if (url.includes("/voices"))
      return Response.json({ voices: [{ voice_id: "test", name: "Test" }] });
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  try {
    const service = new VoiceService(controller, home, http);
    await service.configure({ apiKey: "fake-test-key", voiceId: "test" });
    const results = await Promise.all([
      service.speech({ eventId: 1 }),
      service.speech({ eventId: 1 }),
    ]);
    assert.deepEqual(results[0], results[1]);
    await service.speech({ eventId: 1 });
    assert.equal(calls, 1);
    await assert.rejects(service.speech({ eventId: 2 }), /bulunamadı/);
    assert.equal(calls, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
