# Chat progress and latency

Desktop and Android copy the original message string, preserving Markdown, line breaks and URLs. Role labels are omitted. Assistant messages show elapsed run time using persisted `run_started` and terminal event timestamps. Active timers use the current time; missing timestamps are left blank rather than estimated. Native imported messages without run metadata have no duration.

Codex `item/started` and `item/completed` feed tool activity. Only provider-published reasoning summaries are displayed; raw reasoning deltas are not collected. Claude tool starts and streamed text are also forwarded. Desktop reconciles partial messages by run and item ID, replacing partial text with the authoritative completed message. The clients poll (desktop every 4 seconds, Android every 2 seconds), so this is incremental display, not zero-latency transport.

When no tool or summary has arrived, the UI says it is waiting for the provider. That state is not evidence the model is thinking or that a tool is running. Clipboard writes stay local to the device.

## October 26 investigation

Native Codex telemetry for the persistent assistant recorded:

| Turn | Total | First token |
| --- | ---: | ---: |
| Greeting | 191 s | 190.463 s |
| Short validation | 4.715 s | 4.500 s |
| Next short validation | 178.889 s | 178.651 s |

The greeting used 129,851 input tokens (129,664 cached), with zero reported reasoning output tokens. These observations locate the delay before the provider's first output, not in Markdown rendering or the UI polling interval. They do not establish whether the remote service queued the request, retried transport, or spent the time processing context. No rate limit error was recorded in those turns. Context size alone does not explain the large variation.

`provider_ready`, `provider_turn_started`, `usage`, and existing timestamped output events now distinguish local startup/resume from first output and total time. In a fresh, real command test the provider was ready in 299 ms; its turn was accepted 23 ms later. No model substitution, history reset, permission change, or automatic retry was introduced.

## Folded work log

Reference: T3 Code [`e5ea25d`](https://github.com/pingdotgg/t3code/tree/e5ea25d1292e5342db8508bf48ded67b88b82b82), particularly web `TimelineWorkGroupRows`, `TimelineWorkEntryRow.logic`, mobile `thread-work-log`, and shared `work-log/presentation`. This project implements its own presentation protocol and native Compose/React views; it does not import T3 packages.

Each run has one expandable work group with a stable duration. Individual items expose their input/output and lifecycle status. Active groups open by default, settled groups collapse by default, and explicit user disclosure choices remain respected while that group is mounted. Ordinary assistant messages stay visible. Reasoning cards contain only provider-published summaries. A missing completion event is shown as unconfirmed rather than converted into success. Old events are projected on read, so existing tool history remains inspectable without a database migration.

## Desktop navigation validation

The installed macOS build was checked with synthetic mouse button 3/4 events: job chat → jobs → assistant and forward again. The jobs list restored scrollTop 310 and the assistant restored scrollTop 420. This verifies the app event handlers and restoration, not the user's physical mouse driver. Navigation history and positions last for the app session. Wide-screen assistant text and the work-group heading share the same left edge.
