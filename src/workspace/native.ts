import {
  listSessions,
  getSessionMessages,
  getSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import { RpcProcess } from "../providers/process.js";
export async function codexRequest(method: string, params: unknown) {
  const rpc = new RpcProcess(process.env.ORCHESTRATOR_CODEX_BIN ?? "codex", [
    "app-server",
    "--stdio",
  ]);
  rpc.on("failure", () => {});
  try {
    await rpc.request("initialize", {
      clientInfo: { name: "orchestrator_workspace", version: "0.1.1" },
      capabilities: { experimentalApi: true },
    });
    rpc.send({ method: "initialized", params: {} });
    return await rpc.request(method, params);
  } finally {
    await rpc.close();
  }
}
export async function nativeList(
  provider: "codex" | "claude",
  cursor?: string,
) {
  if (provider === "codex") {
    const result = await codexRequest("thread/list", {
      limit: 30,
      sourceKinds: [
        "cli",
        "vscode",
        "exec",
        "appServer",
        "subAgent",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "subAgentOther",
        "unknown",
      ],
      cursor: cursor || null,
    });
    return {
      sessions: result.data.map((s: any) => ({
        id: s.id,
        title: s.name || s.preview || "Codex oturumu",
        cwd: s.cwd,
        provider,
        status: s.status?.type || "unknown",
      })),
      nextCursor: result.nextCursor,
    };
  }
  const offset = cursor ? Number(cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw Error("Invalid cursor");
  const result = await listSessions({ limit: 30, offset });
  return {
    sessions: result.map((s) => ({
      id: s.sessionId,
      title: s.customTitle || s.summary || "Claude oturumu",
      cwd: s.cwd,
      provider,
      status: "external",
    })),
    nextCursor: result.length === 30 ? String(offset + 30) : null,
  };
}
export async function nativeRead(
  provider: "codex" | "claude",
  id: string,
  cursor?: string,
) {
  if (provider === "codex") {
    const r = await codexRequest("thread/read", { threadId: id });
    try {
      const page = await codexRequest("thread/turns/list", {
        threadId: id,
        limit: 30,
        cursor: cursor || null,
        itemsView: "full",
        sortDirection: "desc",
      });
      r.thread.turns = page.data?.slice().reverse() ?? [];
      r.nextCursor = page.nextCursor;
    } catch (e) {
      if (!/method not found|not supported|unknown method/i.test(String(e)))
        throw e;
      return await codexRequest("thread/read", {
        threadId: id,
        includeTurns: true,
      });
    }
    return r;
  }
  const offset = cursor ? Number(cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw Error("Invalid cursor");
  const messages = await getSessionMessages(id, { limit: 200, offset });
  return {
    info: await getSessionInfo(id),
    messages,
    nextCursor: messages.length === 200 ? String(offset + 200) : null,
  };
}
