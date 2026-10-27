# Agent management audit — 27 October 2026

This report evaluates the user's requested job ownership, stalled-work detection, token efficiency, Sonnet 5.5 support and workflow presentation. It records the **pre-fix baseline** at commit `d22c2be830cfac0fc4ed9049ad360cee511c47b6`; recommendations below are not claims that a release has been installed.

## Evidence and limits

Primary application sources are linked below. Historical measurements come from the local, private `audit/metrics.json` in the `unlimited-d22c2be-20261027-143440` maintenance backup. It covers the assistant's descendant tree from 2026-10-27 00:00 Europe/Istanbul through event 238441, captured at 14:57:10 local time. The tree contains 69 tasks, of which 51 had activity in the window. The live SQLite database was queried read-only to confirm current task states and selected event metadata. Conversation text, tool output, credentials and private artifacts are deliberately excluded from this repository document.

These are instrumented observations, not an invoice. Codex figures are positive deltas of cumulative usage counters, with a preceding baseline; the audit recorded no counter resets. Historical session identity is not retained alongside every usage event, which limits independent reconstruction. Cached input remains input volume, not fresh-token cost. Claude assistant-message input/cache values were deduplicated by message ID. **The old audit's Claude output-token totals must not be used:** current official SDK documentation identifies those per-message values as placeholders; output totals must come from result usage. SDK monetary totals are estimates and resumed sessions may include earlier spend. [Claude SDK cost accounting](https://code.claude.com/docs/en/agent-sdk/cost-tracking)

## Findings

| Observation | Measured baseline | Interpretation |
| --- | ---: | --- |
| Engine turns | 331 started; 304 completed; 21 failed; 2 cancelled events | Events span the time window; these counts are not a closed cohort or an end-to-end success rate. |
| Failure classification | 19 provider-stopped, 1 capacity error, 1 other | A stopped provider alone does not establish whether timeout, maintenance or user interruption caused it. |
| Coordinator activity | 111 turns; 109 completed and 2 failed | A long-lived assistant is repeatedly invoked for orchestration. |
| Coordinator input | 50,683,120 input; 49,648,640 cached; 68,703 output tokens | About 98% of recorded input was cached. Large context traffic is real; fresh-token billing cannot be inferred from the total. |
| Coordinator context snapshots | Median 154,447; maximum 245,679 input tokens | Brief acknowledgments can still carry substantial context. These are snapshots, not a per-user-message cost. |
| Completion heuristics | 75 acknowledgment candidates, including 63 coordinator candidates; 4 instruction-blocked candidates | Heuristics identify review targets, not automatic failures; acknowledgments are often valid coordinator behavior. |
| Model-selection events | 104 total; 102 unchanged selections, 2 changed | The event name overstates actual model switching and creates avoidable noise. |
| Explicit Sonnet 5.5 tasks | 3 completed, with real provider sessions and model evidence | Sonnet worked in this environment. Their queue delays were 11.3, 11.8 and 12.5 minutes. |
| Provider events | 147,497 assistant deltas; 10,819 tool-start events | Streaming events are expected; they are not themselves proof of repeated tool execution or LLM cost. |

The sole capacity error in this audited window belonged to Codex `gpt-6.1-terra`, not Sonnet. No duplicate-delivery evidence was established by the prior audit. Avoid calling each repeated status read or acknowledgment a duplicate job without stable task/run/request evidence.

### 1. Worker instructions create a delegation deadlock

The common visual instruction ends by requiring repository implementation to belong to children. Both provider drivers append this instruction whenever the standalone MCP is attached. The engine attaches that MCP for workspace tooling even at the maximum delegation depth. Thus an implementation worker can be told both to delegate implementation and that no additional child is possible. The recorded worker blockers match this path. `role` is metadata at this baseline; it does not select a distinct trusted prompt. Sources: [visual instructions](../src/workspace/visuals.ts), [Codex prompt construction](../src/providers/codex.ts), [Claude prompt construction](../src/providers/claude.ts), [engine attachment and depth enforcement](../src/engine.ts).

Fix the host prompt, not the worker's task message. Keep coordinator-only delegation policy in the persistent assistant profile. Workers should directly perform their authorized brief; optional children must obey depth and permission ceilings. Research/review roles must preserve their requested scope. A regression should capture both Codex start/resume parameters and Claude query options, including maximum-depth cases. Do not remove depth, permission or ancestry checks to solve a prompt contradiction.

### 2. Product ownership should be assistant → job owner → optional specialists

The user calls direct assistant children “jobs” and expects each job owner to create/manage its own reviewers. The coordinator profile currently mandates asynchronous delegation but does not make this distinction explicit. Each user objective should retain one owner task; follow-ups go to that task. Review permission is passed into its brief, not interpreted as a request for sibling reviews owned by the assistant. Sources: [coordinator profile](../src/workspace/controller.ts), [ownership checks](../src/engine.ts), [workflow hierarchy](workflow-hierarchy.md).

Keep UI grouping derived from `parentTaskId`, never title, cwd or model. Preserve the existing per-conversation descendant preference. A completed provider turn is not necessarily a completed user deliverable: display its concrete outcome and blocker, and require artifact/test evidence before announcing delivery. An additional typed outcome (`delivered`, `blocked`, `needs_input`, `continuing`) would make this distinction more reliable than inferring it from prose; it requires a separate contract change and migration.

### 3. Queue delay looked like a provider failure

The three explicit Sonnet tasks completed and emitted the requested model identifier. Four historical queue examples found four active runs at the same depth. The previous scheduler limit and waiting-parent slot consumption explain a plausible delay mechanism; source commit `d22c2be` removes the default concurrency cap and excludes waiting parents from admission counts. A source fix is not proof of deployment. Sources: [scheduler](../src/engine.ts), [live provider catalog](../src/providers/catalog.ts).

Keep requested model IDs from the live catalog and expose queue versus provider-start states. Do not silently replace Sonnet or add invented aliases. Validate the scheduler with a deterministic concurrency test and inspect the running server's capability after installation. Unlimited concurrency can move the bottleneck to provider limits; retain explicit host-configured ceilings and failure reporting.

### 4. Avoidable orchestration traffic has identifiable causes

`WorkspaceController.doPump` converts each child notification into its own durable assistant input. `Store.notify` includes the result summary, and provider results can be large. This is reliable delivery, but bursts can generate repeated assistant turns with similar context. The assistant's own profile prohibits polling, yet the baseline audit records 61 structured `get_task_status` calls and 23 capability calls for that coordinator. Some may be legitimate response-time checks; the counts alone do not prove waste. Sources: [notification pump](../src/workspace/controller.ts), [notification persistence](../src/store.ts), [result bound and selection events](../src/engine.ts).

Priorities:

1. Emit `model_changed` only when provider/model/effort actually changes. Preserve explicit provider handoff behavior.
2. Batch eligible completion notifications already waiting in one pump into a bounded, ordered input. Keep a durable mapping for **every** original notification and preserve retry identity; questions and failures should remain timely. Do not discard an event because another run of the same task finished later.
3. Send a concise evidence digest (task/run, outcome, artifact paths, actionable blocker) rather than repeatedly embedding full summaries. Retain full results for explicit reads.
4. Use a reusable bounded assistant checkpoint for project state rather than accumulating repeated reports. Any compaction must preserve pending questions, stable IDs, authorization constraints and unfinished work.
5. Measure turns per delivered job and input/cache/output deltas before and after. Do not claim savings from a smaller log alone.

Deterministic routing before adding another model is consistent with Anthropic's guidance to start with simple, composable workflows and add complexity only where it improves outcomes. This is a design inference, not an empirical savings estimate for this app. [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)

### 5. A watchdog should first be deterministic and non-destructive

The baseline has a 30-minute run timer that closes the driver, but no explicit stall supervisor. `task.updatedAt` is updated at lifecycle/session transitions, not on every provider event. It is therefore not a trustworthy last-activity timestamp. `waiting_children` and `waiting_question` are valid waits, not idle failures. Source: [engine event callback, lifecycle and timeout](../src/engine.ts).

Recommended behavior:

- Track run start, last provider event, last meaningful activity, current tool start/end, and expected wait reason separately. Avoid a database write for every streaming character; use throttled metadata or indexed event queries.
- At a configurable quiet threshold, emit one advisory per run/quiet episode to its owner. Distinguish “no recent activity” from proven failure. Queue wait should have its own indicator.
- Clear the warning on renewed activity; exclude user-question waits and legitimate child waits from automatic recovery.
- Do not automatically kill/replay tasks. First check process/connection and last tool state. Any paid or uncertain side effect remains protected by explicit recovery rules.
- Only add a small diagnostic agent if deterministic evidence remains ambiguous. Invoke once with a bounded, redacted evidence packet and return to the job owner, rather than creating recurring polling agents.

Acceptance tests should use an injected clock and cover no activity, long tool execution, waiting children, user question, resumed activity, duplicate ticks and service restart. A high event rate must not conceal an indefinitely repeated non-progress loop; loop detection should be a separate advisory based on repeated operation/result fingerprints.

### 6. Desktop and mobile must describe the same job state

Present each job as a card with title, provider/model, state, elapsed duration and most recent useful activity. Group recent terminal jobs below a divider in an expandable section. Failed, cancelled and recovery-required outcomes must remain distinguishable from success. Preserve ownership and ordering when showing descendants. Sources: [desktop workflow](../apps/desktop/src/main.tsx), [Android workflow](../apps/android/app/src/main/java/dev/agentworkspace/MainActivity.kt), [hierarchy rules](workflow-hierarchy.md).

Duration needs an explicit meaning: task age, current-run elapsed and queue wait are different. A “running for” label should use the current run's start, freeze at its finish and reset on a new run. Missing timing data should be unknown, not a fabricated zero. A task's last update timestamp should not be relabeled as elapsed runtime.

The HTML issue is also concrete: desktop attachment sanitization removes scripts, controls and hrefs and renders an empty-sandbox iframe, while Android allows inline scripts but blocks external navigation. Interactive report content and links therefore cannot match normal browser behavior. Sources: [desktop HTML preparation](../apps/desktop/src/attachment-html.mjs), [desktop preview](../apps/desktop/src/AttachmentPreview.tsx), [Android preview](../apps/android/app/src/main/java/dev/agentworkspace/AttachmentViewer.kt). Fix with isolated script execution and explicit user-gesture external-link handling; retain blocked network, local-file and host-bridge access. External dependencies in an HTML file still require packaging or a clear limitation; enabling arbitrary remote fetch is not a safe rendering fix.

## Delivery checks

Prioritize the role deadlock, existing scheduler activation and HTML/UI fixes; then verify notification and activity changes with regression tests. Persist Claude result usage/model usage and estimated cost with explicit session/run scope before presenting per-job costs. Do not sum resumed cumulative totals as independent run spending.

Run repository checks and affected desktop/Android gates. Use a fixture for UI QA and short isolated tasks for live provider validation; never send test messages to the user's ongoing job. The Mac is offline and the user deferred Mac/physical-phone UI testing, so builds and automated renderer tests cannot be labeled native-device validation. Snapshot active runs before any server replacement; inspect checkpoints before explicitly continuing unfinished work, preserving stable request IDs and avoiding paid-operation replay.

## Implementation and verification

The follow-up implementation removes coordinator-only delegation language from shared visual instructions and uses one provider instruction builder for Codex start/resume and Claude. The coordinator now assigns one job owner; that owner manages optional reviewers. Existing depth and permission enforcement remains in the engine.

Ready child notifications are grouped into one durable assistant input when the assistant is idle. Each notification retains its delivery receipt; quota/recovery/cancellation gates remain. Repeated unchanged model selections no longer emit `model_changed`. Claude result usage and session-scoped estimated cost are recorded separately from chat events.

A deterministic health check runs every 30 seconds and reports a running job once per run after ten minutes without a provider event. Waiting-question/waiting-children states are excluded. It never cancels or replays the job. State responses expose current-run start/finish and actual last-event times. UI cards show elapsed current-run time and quiet warnings; terminal jobs are behind an expandable divider on both clients.

Desktop report previews now retain inline scripts and controls in an opaque-origin sandbox with network, files, frames and host access blocked. External link requests are source-checked and displayed outside the untrusted iframe for an explicit browser-open action. Android routes user-gesture HTTP(S) navigation to the external browser, retaining network/file restrictions. External dependencies remain blocked: reports must be self-contained.

Verification: 83 server tests; 28 desktop tests; TypeScript check/build; production desktop build; headless renderer fixtures for hierarchy, completed-section expansion and persistence; report data/filter/link/parent-isolation fixture plus a real report; Android release assemble, debug unit tests and release lint. Native Mac and physical-phone QA were deferred by the user. The XPS coordinator was backed up and updated during an idle window; its live capabilities report unlimited concurrency and depth 3. There were no active or queued jobs to interrupt or resume.

Mac packaging/installation and the update-compatible signed personal APK remain pending: the Mac is offline, and its existing signing material and Firebase configuration are unavailable on XPS. The unsigned release build is not an installable delivery and must not be distributed as the requested signed APK. No private conversation export or signing material is included in this repository.
