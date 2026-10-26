import { Glasses } from "../src/glasses";
import { Client } from "../src/core";
const tasks = Array.from({ length: 22 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  title: `${i === 0 ? "Uzun başlıklı Türkçe test işi: bağımsız alt görevler" : "Deneme işi " + i}`,
  status: i === 0 ? "waiting_question" : i < 4 ? "running" : "completed",
  provider: "codex",
  updatedAt: 100 - i,
  createdAt: i,
  conversationKind: i > 18 ? "session" : "task",
}));
const client = new Client(
  "http://127.0.0.1:8787",
  "fixture",
  async (url: any, init: any) => {
    const u = new URL(url);
    if (u.pathname === "/v1/state") return Response.json({ tasks, inputs: [] });
    if (u.pathname === "/v1/messages")
      return Response.json({
        messages: [
          {
            id: 1,
            type: "assistant_message",
            payload: {
              text:
                "Türkçe test yanıtı.\n\n" +
                "Bu uzun yanıt gözlükte sayfalara ayrılır. İşler arka planda devam eder. ".repeat(
                  9,
                ),
            },
          },
        ],
        nextOffset: 1,
      });
    if (u.pathname === "/v1/task/action") {
      console.info("QA_CANCEL", JSON.parse(init.body).taskId);
      return Response.json({ ok: true });
    }
    if (u.pathname === "/v1/voice/status")
      return Response.json({ configured: false });
    return Response.json(
      { error: "unexpected fixture request" },
      { status: 400 },
    );
  },
);
const g = new Glasses(
  () => client,
  (s) => console.info("QA_NOTICE", s),
  () => console.info("QA_STATE"),
);
void g.start();
window.addEventListener("pagehide", () => void g.dispose());
