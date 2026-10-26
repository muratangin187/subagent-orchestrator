export const duration = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
export function runTimes(events) {
  /** @type {Record<string, {start?: number, end?: number}>} */
  const runs = {};
  for (const e of events) {
    if (!e.runId) continue;
    const run = (runs[e.runId] ||= {});
    if (e.type === "run_started") run.start = e.created;
    if (["completed", "failed", "cancelled"].includes(e.type))
      run.end = e.created;
  }
  return runs;
}
export function activity(events, runId) {
  const items = new Map();
  let summary = "";
  for (const e of events.filter((e) => e.runId === runId)) {
    const p = e.payload || {};
    if (e.type === "reasoning_summary") summary += p.text || "";
    if (
      ["tool_started", "tool_item"].includes(e.type) &&
      !["userMessage", "agentMessage", "reasoning"].includes(p.type)
    )
      items.set(p.id || String(e.id), {
        label: p.tool || p.name || p.command || p.type || "Araç",
        done: e.type === "tool_item",
      });
    if (e.type === "tool_result")
      for (const b of p.content || [])
        if (b.tool_use_id && items.has(b.tool_use_id))
          items.get(b.tool_use_id).done = true;
  }
  return {
    summary: summary.slice(-1200),
    tools: [...items.values()].slice(-8),
  };
}
export function projectMessages(events) {
  const messages = [],
    streams = new Map();
  const full = new Set(
    events
      .filter((e) => e.type === "assistant_message")
      .map((e) => `${e.runId}:${e.payload.id || e.payload.itemId || ""}`),
  );
  for (const e of events) {
    const p = e.payload || {},
      base = { id: String(e.id), runId: e.runId, created: e.created };
    if (e.type === "html_render") {
      messages.push({...base, role:"assistant", text:p.title, visual:p});
    } else if (e.type === "provider_handoff") {
      messages.push({
        ...base,
        role: "system",
        text: `${p.previous?.provider} → ${p.selection?.provider} · Sohbet bağlamı yeni oturuma aktarıldı.`,
      });
    } else if (e.type === "assistant_message") {
      const text =
        p.text ??
        (p.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
      if (text) messages.push({ ...base, role: "assistant", text });
    } else if (e.type === "assistant_delta") {
      const key = `${e.runId}:${p.itemId || ""}`;
      if (!full.has(key)) {
        if (!streams.has(key)) {
          const m = {
            ...base,
            id: "stream-" + key,
            role: "assistant",
            text: "",
          };
          streams.set(key, m);
          messages.push(m);
        }
        streams.get(key).text += p.text || "";
      }
    } else if (["task_created", "message_queued"].includes(e.type)) {
      const text = p.displayText || p.message || p.task || "";
      if (!text.startsWith("Background task event"))
        messages.push({
          ...base,
          role: "user",
          text,
          attachments: p.attachments,
        });
    } else if (e.type === "failed")
      messages.push({
        ...base,
        role: "error",
        text: p.message || p.error || "İş tamamlanamadı.",
      });
  }
  return messages;
}

export function workGroups(events) {
  /** @type {Record<string, any>} */
  const groups = {};
  for (const e of events) {
    if (!e.runId) continue;
    const g = (groups[e.runId] ||= {
      runId: e.runId,
      start: undefined,
      end: undefined,
      state: "running",
      items: [],
    });
    if (e.type === "run_started") g.start = e.created;
    if (["completed", "failed", "cancelled"].includes(e.type)) {
      g.end = e.created;
      g.state = e.type;
    }
    for (const patch of e.activity || []) {
      let item = g.items.find((i) => i.id === patch.id);
      if (!item) {
        item = {
          id: patch.id,
          kind: "tool",
          title: "Araç",
          state: "running",
          startedAt: e.created,
        };
        g.items.push(item);
      }
      const output =
        patch.append === "output"
          ? ((item.output || "") + (patch.output || "")).slice(-48000)
          : patch.output;
      Object.assign(item, patch, { output: output ?? item.output });
      if (patch.state && patch.state !== "running") item.endedAt = e.created;
    }
  }
  for (const g of Object.values(groups))
    if (g.end)
      for (const item of g.items)
        if (item.state === "running") item.state = "interrupted";
  return groups;
}

// A tool owns its original position even when its result arrives after a message.
export function workSegments(events) {
  const runs = workGroups(events),
    segments = [],
    owners = new Map();
  let current;
  for (const e of events) {
    const p = e.payload || {};
    if (
      [
        "assistant_message",
        "assistant_delta",
        "provider_handoff",
        "question",
      ].includes(e.type) ||
      (["task_created", "message_queued"].includes(e.type) &&
        !(p.displayText || p.message || p.task || "").startsWith(
          "Background task event",
        ))
    )
      current = undefined;
    for (const patch of e.activity || []) {
      const key = `${e.runId}:${patch.id}`;
      if (owners.has(key)) continue;
      if (!current || current.runId !== e.runId) {
        current = {
          ...runs[e.runId],
          id: `work-${e.id}`,
          order: e.id,
          start: e.created,
          items: [],
        };
        segments.push(current);
      }
      owners.set(key, current);
      current.items.push(runs[e.runId].items.find((i) => i.id === patch.id));
    }
  }
  for (const g of segments) {
    // Closed segments retain live tool state until all their tools finish.
    if (g.items.every((i) => i.state === "completed" || i.state === "failed")) {
      g.end = Math.max(...g.items.map((i) => i.endedAt || g.start));
      g.state = "completed";
    }
  }
  for (const run of Object.values(runs))
    if (!segments.some((g) => g.runId === run.runId)) {
      const start = events.find(
        (e) => e.runId === run.runId && e.type === "run_started",
      );
      if (start)
        segments.push({ ...run, id: `work-${start.id}`, order: start.id });
    }
  return segments.sort((a, b) => a.order - b.order);
}
export function workSlots(events, messages) {
  const before = new Map(),
    tail = [];
  for (const group of workSegments(events)) {
    const next = messages.find((m) => {
      const order = m.id.startsWith("stream-")
        ? events.find(
            (e) =>
              e.type === "assistant_delta" &&
              `stream-${e.runId}:${e.payload?.itemId || ""}` === m.id,
          )?.id
        : (() => {
            const event = events.find((e) => String(e.id) === m.id);
            const p = event?.payload || {};
            const first =
              m.role === "assistant" &&
              events.find(
                (e) =>
                  e.type === "assistant_delta" &&
                  e.runId === m.runId &&
                  (e.payload?.itemId || "") === (p.id || p.itemId || ""),
              );
            return first ? first.id : Number(m.id);
          })();
      return order > group.order;
    });
    if (next) before.set(next.id, [...(before.get(next.id) || []), group]);
    else tail.push(group);
  }
  return { before, tail };
}
