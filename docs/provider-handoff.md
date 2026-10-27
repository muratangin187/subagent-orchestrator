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

## Same-provider resume and transport bounds

Codex resumes use `excludeTurns: true`: only the `thread/resume` RPC response's
historical turns are omitted. This does not clear the provider's native history
or reset the model conversation. The driver only consumes the returned thread
ID; UI history continues to come from persisted events and the separate paginated
native history API. Normal provider context compaction still applies independently.
The deployed Codex protocol must support this flag; do not silently fall back to
unbounded full-history hydration on an incompatible version.

Provider stdout is JSONL. Each line is bounded to 8 MiB of wire bytes, excluding
LF and including CR when present. Several valid lines may exceed that total in a
single chunk. Partial UTF-8 sequences are decoded only after the line is complete.
The reader retains at most one bounded partial line, grows storage geometrically,
and consumes synchronously without a decoded-frame queue, retaining pipe
backpressure. Parsing still allocates a bounded string/object in addition to the
byte buffer; 8 MiB is not an RSS limit. Oversize lines fail before further growth;
malformed or unterminated-at-EOF lines fail without dispatching later messages.
Stderr is independent, retains only its last 4000 bytes, and is not exposed in
protocol errors. Do not raise/remove this bound to accommodate growing history.

Regression coverage includes byte boundaries, chunk alignment, multiple lines,
UTF-8 splits, oversized image-shaped output, incomplete EOF, pending rejection,
and stderr isolation. The Codex fixture emits an oversized history when resume
omits the flag, so native-session recovery tests exercise this contract too.
Real-provider validation requires a separate benign two-turn session: record a
unique fact and a harmless tool result, close the provider, resume with the flag,
recall the fact without repeating it, and verify identical native thread ID and
retained prior message/tool items through the history API. A passing fixture alone
does not establish preservation of model context.
