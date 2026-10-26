import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CodexDriver } from "./codex.js";
import { providerEnvironment } from "./process.js";
export type CatalogModel = {
  provider: "codex" | "claude";
  model: string;
  label: string;
  efforts: string[];
};
let cached:
  | {
      expires: number;
      value: { models: CatalogModel[]; errors: Record<string, string> };
    }
  | undefined;
let pending: ReturnType<typeof loadCatalog> | undefined;
export async function modelCatalog() {
  if (cached && cached.expires > Date.now()) return cached.value;
  return (pending ??= loadCatalog().finally(() => {
    pending = undefined;
  }));
}
async function loadCatalog() {
  if (cached && cached.expires > Date.now()) return cached.value;
  const models: CatalogModel[] = [],
    errors: Record<string, string> = {};
  await Promise.all([
    (async () => {
      try {
        const r: any = await CodexDriver.models();
        for (const m of (r.data ?? []).filter((m: any) => !m.hidden))
          models.push({
            provider: "codex",
            model: m.model ?? m.id,
            label: m.displayName ?? m.id,
            efforts: (m.supportedReasoningEfforts ?? [])
              .map((e: any) => e.reasoningEffort)
              .filter((e: string) =>
                ["low", "medium", "high", "xhigh", "max", "ultra"].includes(e),
              ),
          });
      } catch {
        errors.codex = "Codex model listesi alınamadı.";
      }
    })(),
    (async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 12000);
      let q: ReturnType<typeof query> | undefined;
      try {
        q = query({
          prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
            await new Promise<void>((r) =>
              abort.signal.addEventListener("abort", () => r(), { once: true }),
            );
          })(),
          options: {
            abortController: abort,
            pathToClaudeCodeExecutable:
              process.env.ORCHESTRATOR_CLAUDE_BIN ?? "claude",
            env: providerEnvironment(),
            settingSources: [],
            tools: [],
            persistSession: false,
          },
        });
        for (const m of await q.supportedModels())
          models.push({
            provider: "claude",
            model: m.value,
            label: m.displayName,
            efforts: (m.supportedEffortLevels ?? []).filter((e) =>
              ["low", "medium", "high", "xhigh", "max", "ultra"].includes(e),
            ),
          });
      } catch {
        errors.claude = "Claude model listesi alınamadı.";
      } finally {
        clearTimeout(timer);
        abort.abort();
        q?.close();
      }
    })(),
  ]);
  const value = { models, errors };
  cached = { expires: Date.now() + 60000, value };
  return value;
}
