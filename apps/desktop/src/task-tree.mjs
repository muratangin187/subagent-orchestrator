export function taskTree(tasks, assistantId) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map(),
    rows = [],
    seen = new Set();
  const sorted = [...tasks]
    .filter((t) => t.id !== assistantId)
    .sort((a, b) => {
      const active = (t) =>
        !["completed", "failed", "cancelled"].includes(t.status);
      return Number(active(b)) - Number(active(a)) || b.updatedAt - a.updatedAt;
    });
  for (const t of sorted) {
    const parent =
      t.parentTaskId &&
      t.parentTaskId !== assistantId &&
      byId.has(t.parentTaskId)
        ? t.parentTaskId
        : null;
    children.set(parent, [...(children.get(parent) || []), t]);
  }
  function visit(t, depth, path) {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    rows.push({
      task: t,
      depth,
      path,
      childCount: (children.get(t.id) || []).length,
    });
    for (const child of children.get(t.id) || [])
      visit(child, depth + 1, [...path, t.title || t.task || "İş"]);
  }
  for (const t of children.get(null) || [])
    visit(
      t,
      0,
      t.parentTaskId === assistantId
        ? ["Asistan"]
        : t.parentTaskId
          ? ["Üst görev yüklenmedi"]
          : ["Bağımsız oturum"],
    );
  for (const t of sorted)
    if (!seen.has(t.id)) visit(t, 0, ["Görev bağlantısı"]);
  return rows;
}
