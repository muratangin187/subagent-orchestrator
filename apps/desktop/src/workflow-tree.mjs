// Only proven parent edges enter a conversation's workflow. Missing parents are
// intentionally not promoted to roots (the global jobs tree handles orphans).
export function workflowTree(tasks, rootId, activeOnly = false) {
  if (!rootId) return [];
  const active = (t) => !["completed", "failed", "cancelled"].includes(t.status);
  const children = new Map();
  for (const task of [...tasks].sort((a, b) => Number(active(b)) - Number(active(a)) || b.updatedAt - a.updatedAt)) {
    children.set(task.parentTaskId, [...(children.get(task.parentTaskId) || []), task]);
  }
  const seen = new Set([rootId]);
  function visit(parentId, depth, path) {
    const rows = [];
    for (const task of children.get(parentId) || []) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      const descendants = visit(task.id, depth + 1, [...path, task.title || task.task || "İş"]);
      if (!activeOnly || active(task) || descendants.length)
        rows.push({ task, depth, path }, ...descendants);
    }
    return rows;
  }
  return visit(rootId, 0, []);
}
export function workflowPreferenceKey(origin, rootId) {
  return `workspace.workflow.descendants:${JSON.stringify([origin || "", rootId || ""])}`;
}
export function loadWorkflowPreference(storage, key) {
  try { return storage.getItem(key) === "true"; } catch { return false; }
}

export function elapsedLabel(task, now = Date.now()) {
  const end = task.runFinishedAt ?? (["completed", "failed", "cancelled", "recovery_required"].includes(task.status) ? task.updatedAt : now);
  const minutes = Math.max(0, Math.floor((end - (task.runStartedAt ?? task.runCreatedAt ?? task.createdAt)) / 60000));
  return minutes < 1 ? "<1 dk" : minutes < 60 ? `${minutes} dk` : `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}
