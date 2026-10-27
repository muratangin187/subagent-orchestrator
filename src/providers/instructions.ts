import type { RunContext } from '../types.js';
import { VISUAL_INSTRUCTIONS } from '../workspace/visuals.js';
import { SESSION_LINK_INSTRUCTIONS } from '../workspace/session-links.js';

/** Role is a responsibility, never an elevation of runtime permissions. */
export function providerInstructions(ctx: Pick<RunContext, 'task' | 'delegation'>): string {
  const worker = `You are the owner of this delegated job. Work only on the supplied brief and within runtime permissions. Carry out authorized repository implementation, tests and delivery directly; delegation is optional, not a prerequisite for doing your own work. For review or research briefs, stay within that scope. Report uncertainties and evidence honestly. Do not label blocked or unimplemented work as delivered. Keep the same job for follow-up work.`;
  const delegation = ctx.delegation
    ? 'Use standalone_children orchestrator_capabilities to discover whether you can delegate: availability of HTML tools does not imply child capacity. If allowed and useful, manage your own implementation/review children using this MCP only, never native or shell-spawned agents. Wait for child results before reporting a combined outcome. If child depth is exhausted, do the authorized work yourself; do not recursively create coordinators.'
    : 'Delegation depth limit reached. Do not spawn further agents. Complete your own authorized work directly.';
  return [ctx.task.instructions ?? worker,
    ctx.task.conversationKind === 'assistant' ? '' : delegation,
    ctx.delegation && !ctx.task.instructions?.includes(VISUAL_INSTRUCTIONS) ? VISUAL_INSTRUCTIONS : '',
    ctx.task.instructions?.includes(SESSION_LINK_INSTRUCTIONS) ? '' : SESSION_LINK_INSTRUCTIONS].filter(Boolean).join('\n');
}
