# Provider transition policy

Reference: T3 Code's `ProviderSessionTransitionPolicy.ts`,
`ProviderSwitchService.ts`, `ContextHandoffService.ts` and `handoffBudget.ts`.
The reference repository is MIT licensed (T3 Tools Inc., 2026). This implementation
is independent and imports no T3 code or runtime.

- Model/reasoning choice is part of a durable queued message, protected by its
  request ID. It does not mutate an executing turn.
- Compatible provider: resume the same native session with the new selection.
- Incompatible provider: archive the prior binding in a handoff event, clear the
  native session ID, and start a fresh provider session. The logical task ID,
  permissions, device, working directory and child relationships remain unchanged.
- Transfer up to 200 recent conversational events / 40,000 characters and 50
  prioritized child references. Mark truncation explicitly. Pending/future user
  messages are excluded; the current user message is appended exactly once.
- Transfer history as untrusted evidence. Do not transfer hidden reasoning or
  replay tool commands. Tool output is not transplanted into the new provider.
- Native start/delivery failures follow ordinary recovery rules: no uncertain
  side effect is automatically replayed.

Unlike T3's richer full/delta transfer machinery, switching back also creates a
fresh provider session. This avoids resuming a stale branch with missing turns.
Tests cover queue order, context continuity, retained child IDs, preserved native
IDs for compatible changes, and distinct native IDs for provider changes.
