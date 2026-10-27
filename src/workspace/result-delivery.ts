import type { Store } from '../store.js';
import type { Task } from '../types.js';

export type ResultDelivery = {
  state: 'unreported' | 'pending' | 'queued' | 'processing' | 'blocked' | 'response_failed' | 'response_ready' | 'children_pending' | 'reconciliation_required';
  notificationId?: number;
  assistantRunId?: string;
};
/** Delivery to a model and completion of its response are separate from job execution.
 * response_ready proves a completed response turn, never that the user read it or that
 * every batched result was accurately summarized. Never replay work to repair delivery.
 */
export function resultDeliveries(store: Store, tasks: Task[], assistantId?: string) {
  const result = new Map<string, ResultDelivery>();
  if (!assistantId) return result;
  const notices = store.db.prepare(`SELECT n.id, json_extract(n.data,'$.taskId') taskId,
    json_extract(n.data,'$.runId') runId, json_extract(n.data,'$.status') status,
    i.state inputState, json_extract(r.data,'$.commandId') commandId, c.state commandState
    FROM notifications n
    LEFT JOIN workspace_deliveries d ON d.event_id=n.id
    LEFT JOIN workspace_inputs i ON i.id=d.input_id
    LEFT JOIN receipts r ON r.owner='mobile-workspace' AND r.operation='send_to_subagent' AND r.key='mobile-send:'||d.input_id
    LEFT JOIN commands c ON c.id=json_extract(r.data,'$.commandId')
    WHERE n.owner=? ORDER BY n.id`).all(`child:${assistantId}`) as any[];
  const latest = new Map<string, any>();
  for (const n of notices) if (['completed','failed','recovery_required'].includes(n.status)) latest.set(`${n.taskId}:${n.runId}`, n);
  const commandRuns = new Map((store.db.prepare(`SELECT json_extract(data,'$.commandId') commandId,run_id FROM events WHERE task_id=? AND type='user_message' ORDER BY id`).all(assistantId) as any[]).map(e=>[e.commandId,e.run_id]));
  const runs = new Map(store.runs(assistantId).map(r=>[r.id,r]));
  for (const t of tasks) {
    if(t.parentTaskId!==assistantId || !['completed','failed','recovery_required'].includes(t.status)) continue;
    const descendants: Task[] = [];
    const seen=new Set([t.id]);
    const visit=(id:string)=>{for(const child of tasks.filter(x=>x.parentTaskId===id))if(!seen.has(child.id)){seen.add(child.id);descendants.push(child);visit(child.id);}};
    visit(t.id);
    if(descendants.some(x=>!['completed','failed','cancelled','recovery_required'].includes(x.status))){result.set(t.id,{state:'children_pending'});continue;}
    const finishedAt=store.run(t.runId).finishedAt ?? 0;
    if(descendants.some(x=>(store.run(x.runId).finishedAt ?? 0)>finishedAt)){
      result.set(t.id,{state:'reconciliation_required'});continue;
    }
    const n=latest.get(`${t.id}:${t.runId}`);
    if(!n){result.set(t.id,{state:'unreported'});continue;}
    const assistantRunId=commandRuns.get(n.commandId);
    const run=assistantRunId ? runs.get(assistantRunId) : undefined;
    let state:ResultDelivery['state']='pending';
    if(n.inputState==='failed' || ['held','uncertain'].includes(n.commandState)) state='blocked';
    else if(run) state=run.status==='completed' && !!run.result?.trim() ? 'response_ready'
      : ['completed','failed','cancelled','recovery_required'].includes(run.status) ? 'response_failed' : 'processing';
    else if(n.commandId) state='queued';
    result.set(t.id,{state,notificationId:n.id,assistantRunId});
  }
  return result;
}
