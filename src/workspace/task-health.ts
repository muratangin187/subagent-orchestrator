import type { Store } from '../store.js';
import type { Task } from '../types.js';
export const QUIET_MS = 10 * 60_000;
export function taskHealth(store: Store, task: Task, now = Date.now()) {
  const run = store.run(task.runId);
  const last = store.db.prepare("SELECT created FROM events WHERE task_id=? AND run_id=? AND type != 'inactivity_warning' ORDER BY id DESC LIMIT 1").get(task.id, task.runId) as { created: number } | undefined;
  const started = store.db.prepare("SELECT created FROM events WHERE task_id=? AND run_id=? AND type='run_started' ORDER BY id DESC LIMIT 1").get(task.id, task.runId) as { created: number } | undefined;
  const lastActivityAt = last?.created ?? run.createdAt;
  return { runCreatedAt: run.createdAt, runStartedAt: started?.created, runFinishedAt: run.finishedAt,
    lastActivityAt, quiet: task.status === 'running' && now - lastActivityAt >= QUIET_MS };
}
