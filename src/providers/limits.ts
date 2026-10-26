import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CodexDriver } from "./codex.js";
import { providerEnvironment } from "./process.js";
export type LimitWindow = {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt?: number;
};
export type ProviderLimits = {
  provider: "codex" | "claude";
  windows: LimitWindow[];
  checkedAt: number;
  error?: string;
};
export type UsageLimits = { providers: ProviderLimits[]; deviceId?: string };
function window(
  id: string,
  label: string,
  percent: unknown,
  reset: unknown,
): LimitWindow[] {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0)
    return [];
  const resetsAt =
    typeof reset === "number"
      ? reset * 1000
      : typeof reset === "string"
        ? Date.parse(reset)
        : NaN;
  return [
    {
      id,
      label,
      usedPercent: Math.min(100, percent),
      ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
    },
  ];
}
export function normalizeLimits(
  provider: "codex" | "claude",
  raw: any,
): ProviderLimits {
  const windows: LimitWindow[] = [];
  if (provider === "codex") {
    const buckets =
      raw?.rateLimitsByLimitId && Object.keys(raw.rateLimitsByLimitId).length
        ? Object.entries(raw.rateLimitsByLimitId)
        : [["codex", raw?.rateLimits]];
    for (const [key, value] of buckets) {
      const b = value as any;
      for (const id of ["primary", "secondary"]) {
        const w = b?.[id];
        if (!w) continue;
        const mins = w.windowDurationMins;
        const label =
          mins === 300
            ? "5 saat"
            : mins === 10080
              ? "Haftalık"
              : typeof mins === "number"
                ? `${mins / 60} saat`
                : id === "primary"
                  ? "Kısa dönem"
                  : "Uzun dönem";
        windows.push(
          ...window(
            `${key}:${id}`,
            buckets.length > 1 ? `${b.limitName || key} · ${label}` : label,
            w.usedPercent,
            w.resetsAt,
          ),
        );
      }
    }
  } else if (raw?.rate_limits_available) {
    for (const [id, w] of Object.entries(raw.rate_limits || {})) {
      if (id === "model_scoped" && Array.isArray(w)) {
        for (const m of w)
          windows.push(
            ...window(
              `model:${m.display_name}`,
              `${m.display_name} · Haftalık`,
              m.utilization,
              m.resets_at,
            ),
          );
      } else if (id === "five_hour" || id.startsWith("seven_day")) {
        const v = w as any;
        windows.push(
          ...window(
            id,
            id === "five_hour"
              ? "5 saat"
              : id === "seven_day"
                ? "Haftalık"
                : `Haftalık · ${id.slice(10)}`,
            v?.utilization,
            v?.resets_at,
          ),
        );
      }
    }
  }
  return {
    provider,
    windows,
    checkedAt: Date.now(),
    ...(!windows.length
      ? { error: "Bu hesap için limit bilgisi sunulmuyor." }
      : {}),
  };
}
async function claudeUsage() {
  const abort = new AbortController();
  let q: ReturnType<typeof query> | undefined;
  const timer = setTimeout(() => abort.abort(), 12000);
  try {
    q = query({
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise<void>((resolve) =>
          abort.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
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
    return await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
  } finally {
    clearTimeout(timer);
    abort.abort();
    q?.close();
  }
}
let cached: { until: number; value: UsageLimits } | undefined;
let pending: Promise<UsageLimits> | undefined;
export function usageLimits(): Promise<UsageLimits> {
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.value);
  return (pending ??= Promise.all(
    (["codex", "claude"] as const).map(async (provider) => {
      try {
        return normalizeLimits(
          provider,
          await (provider === "codex"
            ? CodexDriver.usageLimits()
            : claudeUsage()),
        );
      } catch {
        return {
          provider,
          windows: [],
          checkedAt: Date.now(),
          error: "Limit bilgisi alınamadı. Sağlayıcı girişini kontrol et.",
        };
      }
    }),
  )
    .then((providers) => {
      const value = { providers };
      cached = { value, until: Date.now() + 60000 };
      return value;
    })
    .finally(() => {
      pending = undefined;
    }));
}
