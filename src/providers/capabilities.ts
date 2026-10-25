import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { errorText } from "../types.js";
let cached: { until: number; value: unknown } | undefined;
export async function providerCapabilities() {
  if (cached && Date.now() < cached.until) return cached.value;
  const entries = await Promise.all(
    (["codex", "claude"] as const).map(async (provider) => {
      const command =
        process.env[
          provider === "codex"
            ? "ORCHESTRATOR_CODEX_BIN"
            : "ORCHESTRATOR_CLAUDE_BIN"
        ] ?? provider;
      const semantics = {
        nativeSteering: provider === "codex",
        customModels: true,
        authentication: "existing local CLI login",
        workspaceExecution:
          provider === "codex"
            ? "native sandbox"
            : "Read/Glob/Grep/Write/Edit; Bash only in full-access",
      };
      try {
        const { stdout } = await promisify(execFile)(command, ["--version"], {
          timeout: 5000,
        });
        return [
          provider,
          { ...semantics, available: true, version: stdout.trim() },
        ];
      } catch (e) {
        return [
          provider,
          { ...semantics, available: false, error: errorText(e) },
        ];
      }
    }),
  );
  const value = Object.fromEntries(entries);
  cached = { until: Date.now() + 30_000, value };
  return value;
}
