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

Run repository checks and affected desktop/Android gates. Use a fixture for UI QA and short isolated tasks for live provider validation; never send test messages to the user's ongoing job. Native Mac and physical-phone verification is recorded separately below; build and renderer checks alone are not native-device evidence. Snapshot active runs before any server replacement; inspect checkpoints before explicitly continuing unfinished work, preserving stable request IDs and avoiding paid-operation replay.

## Implementation and verification

The follow-up implementation removes coordinator-only delegation language from shared visual instructions and uses one provider instruction builder for Codex start/resume and Claude. The coordinator now assigns one job owner; that owner manages optional reviewers. Existing depth and permission enforcement remains in the engine.

Ready child notifications are grouped into one durable assistant input when the assistant is idle. Each notification retains its delivery receipt; quota/recovery/cancellation gates remain. Repeated unchanged model selections no longer emit `model_changed`. Claude result usage and session-scoped estimated cost are recorded separately from chat events.

A deterministic health check runs every 30 seconds and reports a running job once per run after ten minutes without a provider event. Waiting-question/waiting-children states are excluded. It never cancels or replays the job. State responses expose current-run start/finish and actual last-event times. UI cards show elapsed current-run time and quiet warnings; terminal jobs are behind an expandable divider on both clients.

Desktop report previews now retain inline scripts and controls in an opaque-origin sandbox with network, files, frames and host access blocked. External link requests are source-checked and displayed outside the untrusted iframe for an explicit browser-open action. Android routes user-gesture HTTP(S) navigation to the external browser, retaining network/file restrictions. External dependencies remain blocked: reports must be self-contained.

Verification: 83 server tests; 28 desktop tests; TypeScript check/build; production desktop build; headless renderer fixtures for hierarchy, completed-section expansion and persistence; report data/filter/link/parent-isolation fixture plus a real report; Android release assemble, debug unit tests and release lint. The initial pass deferred native QA while the Mac was offline; the follow-up below records the completed physical-device checks. The XPS coordinator was backed up and updated during an idle window; its live capabilities report unlimited concurrency and depth 3. There were no active or queued jobs to interrupt or resume.

### Native delivery follow-up

After the user powered on the Mac, the desktop package was built and installed in `~/Applications/Agent Workspace.app`; its signature verified. The full server suite passed on Mac after replacing a fixed-delay test wait with a bounded condition wait (83/83). The personal Android release was built using the existing release key, rotation lineage and Firebase configuration, then installed with `adb install -r` on the existing Samsung SM-A165F. Its signed APK was delivered to the user's requested private Slack DM. APK SHA256: `c102cd2d81f0a99e9f4ba6803d2d2a3ba44a0c5ac0c175767d7d89149135c865`.

Physical Android QA verified XPS pairing, conversation loading, job cards with run durations and the expandable completed section. An isolated QA conversation linked a self-contained report: its inline script rendered two rows, the filter reduced it to one, and a user link opened Chrome. The shared video stream and Android accessibility WebView subtree could be stale; fresh ADB screen capture confirmed the filtered result. The shared phone lease was released after testing.

Packaged Mac QA exposed a gap in the original headless fixture: `srcdoc` inherited the main window's `script-src 'self'`, blocking inline report scripts despite the child's permissive policy. The fix serves bounded, transient report pages through the existing isolated custom scheme with an independent response CSP. The parent policy remains unchanged. Main-frame IPC alone can register/release a report; close, reload and renderer-crash events clear its storage. The revised browser QA uses the production parent CSP, and 31 desktop tests pass. Sol 6.1 review caught and verified the lifecycle cleanup fix.

A separate Mac test-launch issue was diagnosed without changing saved credentials: launching the app directly under SSH produced Electron's `safeStorage.decryptStringAsync is temporarily unavailable` error. LaunchServices startup in the normal logged-in GUI session restored the existing connection. No Keychain permission bypass or credential replacement was used. See [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) for the OS-backed encryption contract.

No private conversation export or signing material is included in this repository.


### Whole-day follow-up and independent review

Two Sonnet 5 research passes examined the day (local midnight through approximately 16:08), and Sol 6.1 independently reviewed the resulting code findings. Recounting directly from read-only SQLite gives **54 tasks created today**, **56 tasks with events today**, **344 run-start events**, and **113 coordinator run-start events today**. The coordinator's **216 runs are lifetime**, not today's count. There was one post-deployment QA run, not zero. These distinctions correct the initial research drafts; the small post-deployment sample cannot establish production savings or prove batching ineffective.

The confirmed follow-up fixes are:

- Provider capacity errors now carry a typed `capacity` failure and hold queued follow-ups until explicit continuation, like rate/quota failures. Today's observed capacity error previously escaped classification; no evidence established that an automatic follow-up actually fired in that historical instance.
- Notification batches are bounded by their **serialized** size before delivery receipts are recorded. Ordered overflow remains pending for another batch. Individually large results become explicit digests retaining task/run/question IDs and pointing to full durable evidence. The independent review caught the prior unbounded-batch path, which could exceed the 64,000-character command limit after receipts had been recorded.
- Worker briefs now require concrete delivered/partial/blocked/needs-input outcomes and evidence appropriate to implementation or research. Coordinator instructions separate a completed provider turn from verified delivery, include acceptance checks in delegation, and continue authorized unfinished work through the same owner while preserving approval/recovery gates. This is an instruction contract, **not** an enforced typed outcome classifier; historical prose is not automatically relabeled.
- The desktop completed label now explicitly says the **turn** completed, matching Android. The jobs picker also displays current-run duration, actual last activity and quiet warnings.

Validation adds capacity hold/retry, large-result/question delivery and escaped-size/overflow regression coverage: **87 server tests and 31 desktop tests** passed, alongside TypeScript/build and production-CSP report QA. The packaged Mac report rendered two rows, filtered to one, and presented the validated external-link action; physical Android verified the corresponding filter and Chrome launch.

The research also suggested several changes that were deliberately **not** applied without evidence: arbitrary breadth limits would reverse the user's unlimited-parallelism preference; research/review roles do not imply a prohibition on useful specialist delegation; short replies cannot be safely hidden based on length; and removing persisted streaming deltas would break assumptions in durable cursor/reconnect consumers. Today's 151,270 delta rows contain about 12.16 MB of payload, whereas tool-output and tool-item payloads total about 96.27 MB. Delta row share is not byte share, billing, or proof of wasted work. Retention needs an explicit replay/compaction design and measured before/after behavior, not ad-hoc deletion of live history.


### Missing final responses and late nested handback

A follow-up delivery audit traced all 92 persisted direct-child notifications through workspace input, stable send receipt, command, recipient run and output. All 92 inputs were accepted, but one recipient run failed with `Provider exited (0)` after a commentary-only message; it produced no final result. The other 91 recipient runs completed with result text. That does not prove each batched item was accurately summarized or read by the user.

Four additional direct owners have descendant results newer than their own latest final run. This is a deterministic stale-owner indicator, not proof that the user never saw the information elsewhere. The private job inventory records historical task-level findings; the public repository retains only aggregate findings.

New behavior separates execution status from result delivery. Unresolved results remain visible in a dedicated section on desktop and Android, including an action opening the original result. Completed owners with active descendants are shown as waiting for children; owners with newer descendant results are marked for reconciliation. A completed assistant response turn is labeled precisely, never as proof of user receipt or artifact acceptance.

The workspace notification pump now routes future child results to their completed job owner as well as the persistent assistant. Routing is receipt/cursor based, including bounded-batch overflow and notices arriving during reconciliation; completion timestamps are not used to discard notices. Failed, cancelled, quota/capacity-blocked and recovery-required owners need explicit continuation. On upgrade, a persisted notification floor prevents replay of historical nested jobs. An owner which already manually read a result can conservatively receive one additional reconciliation turn; avoiding that safely requires an explicit consumption receipt, not a timing heuristic.

Regression coverage includes nested owner→assistant handback, overflow, a second result arriving during reconciliation, upgrade without historical replay, and commentary followed by provider failure. **91 server and 32 desktop tests pass**. The desktop renderer fixture verifies unresolved results remain visible outside the collapsed completed section. Sol 6.1 identified the initial timestamp race and approved its receipt-based replacement. Native device verification is recorded in the delivery record after installation.
