/** Wire presentation shared by the desktop and Android timelines. */
export type ActivityPatch = {
  id: string;
  kind?: "command" | "read" | "edit" | "search" | "tool" | "thinking";
  title?: string;
  state?: "running" | "completed" | "failed";
  input?: string;
  output?: string;
  append?: "output";
};
const bounded = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 24000
    ? text.slice(0, 24000) + "\n… Görüntüleme sınırına ulaşıldı."
    : text;
};
const textContent = (content: any): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
      : bounded(content);
function tool(
  id: string,
  name: string,
  input: any,
  state: ActivityPatch["state"],
  output?: unknown,
): ActivityPatch {
  const kind = /read|view|open_file/i.test(name)
    ? "read"
    : /edit|write|patch|fileChange/i.test(name)
      ? "edit"
      : /search|grep|glob|web/i.test(name)
        ? "search"
        : /bash|exec|command|terminal/i.test(name)
          ? "command"
          : "tool";
  const labels = {
    read: "Dosya okuma",
    edit: "Dosya değişikliği",
    search: "Arama",
    command: "Komut",
    tool: name || "Araç",
  };
  return {
    id,
    kind,
    title: labels[kind],
    state,
    input: bounded(input),
    ...(output === undefined ? {} : { output: bounded(output) }),
  };
}
export function activityPatches(event: {
  type: string;
  payload: any;
  id: number;
}): ActivityPatch[] {
  const p = event.payload || {};
  if (event.type === "reasoning_summary")
    return [
      {
        id: p.itemId || "reasoning",
        kind: "thinking",
        title: "Düşünme özeti",
        state: "running",
        output: bounded(p.text),
        append: "output",
      },
    ];
  if (event.type === "tool_output")
    return [{ id: p.itemId, output: bounded(p.text), append: "output" }];
  if (event.type === "tool_result")
    return (p.content || [])
      .filter((b: any) => b.type === "tool_result")
      .map((b: any) => ({
        id: b.tool_use_id,
        state: b.is_error ? "failed" : "completed",
        output: bounded(textContent(b.content)),
      }));
  if (event.type === "assistant_message")
    return (p.content || []).flatMap((b: any, index: number) => {
      if (b.type === "tool_use")
        return [tool(b.id, b.name, b.input, "running")];
      if (b.type === "thinking" && typeof b.thinking === "string")
        return [
          {
            id: (p.id || "") + ":thinking:" + index,
            kind: "thinking",
            title: "Düşünme özeti",
            state: "completed",
            output: bounded(b.thinking),
          },
        ];
      return [];
    });
  if (
    !["tool_started", "tool_item"].includes(event.type) ||
    ["userMessage", "agentMessage"].includes(p.type)
  )
    return [];
  const state =
    event.type === "tool_started"
      ? "running"
      : p.status === "failed" ||
          p.error ||
          (typeof p.exitCode === "number" && p.exitCode !== 0)
        ? "failed"
        : "completed";
  const id = p.id || String(event.id);
  if (p.type === "reasoning") {
    // Never forward raw reasoning content; only public summaries supplied by the provider.
    const summary = Array.isArray(p.summary)
      ? p.summary
          .map((s: any) => (typeof s === "string" ? s : s.text || ""))
          .join("\n")
      : "";
    return [
      {
        id,
        kind: "thinking",
        title: "Düşünme özeti",
        state,
        ...(summary ? { output: bounded(summary) } : {}),
      },
    ];
  }
  return [
    tool(
      id,
      p.tool || p.name || p.type,
      p.command || p.arguments || p.input || p.changes || p.action,
      state,
      p.aggregatedOutput ?? p.result ?? p.error,
    ),
  ];
}
