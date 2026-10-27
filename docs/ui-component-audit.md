# Desktop and Android component audit — 2026-10-27

Direction: calm Linear/native Mac feel. Extend the existing conversation redesign to secondary screens. Review uses the real renderer with synthetic transport, source inspection, and native device navigation. No production task messages are sent. Keychain is never bypassed: disconnected/loading/error screens are exercised with the isolated renderer.

## Coverage and decisions

| Surface | Desktop | Android | Decision |
| --- | --- | --- | --- |
| Connection / onboarding | Disconnected renderer fixture | PairScreen source review; existing pairing preserved | Keep concise guidance, remove obsolete Android first-version statement |
| Conversation / Markdown / queue | Light/dark, compact, streaming/performance fixtures | Native conversation and keyboard | Preserve chronology, bounded work details and full-width composer |
| Main/child navigation | Split, independent drafts, return/close | Native scoped jobs, back navigation | Keep recipient/context clear |
| Jobs | Populated/search/no-results fixture | Full-height sheet, search and active filter | Quiet rows, readable hierarchy, explicit empty result |
| Sessions | Populated/search/no-results fixture | Full-height sheet and no-results message | Distinguish no sessions from no search matches |
| New session | Form fixture | Scrollable device/provider/model form | Long forms remain reachable with larger text/keyboard |
| Model/effort | Catalog/search/empty, Escape/outside dismissal | Full-height searchable sheet | Loading, failure, retry, cancellation cleanup; preserve per-conversation selection |
| Settings / appearance | Light/dark and compact fixture | Secure native settings tree | Always-reachable desktop settings; consistent section hierarchy |
| Usage limits | Unknown-data popover fixture; source review | Existing bounded menu reviewed | Preserve remaining-quota semantics and unknown values |
| Voice / dictation | Idle dock fixture; source lifecycle review | Native idle screen and settings | Do not start recording or send audio during traversal |
| Attachments | Markdown raw/preview fixture; PDF/image code review | Picker and preview source review | Wrapping toolbar and long filenames; preserve sandbox/security |
| HTML / inline results | Existing report sandbox regression; source review | Existing sandbox reviewed | No security boundary changes |
| Questions / cancel | Question fixture; cancel/source review | Scrollable question dialog; cancel/source review | No live task cancellation or answers during QA |
| Offline / loading / errors | Separate isolated fixtures | Existing connection/error state source review | Do not force real network loss or unpair device |

Source review is not a claim of native end-to-end coverage. External file pickers, recording, credential entry, real cancellations, and device pairing are intentionally not executed against the user's live data.

## Reproducible checks

- `node apps/desktop/test/full-ui.qa.mjs`: 34 synthetic screen/theme states; screenshots and coverage JSON in `/tmp/aw-full-ui-after`.
- `node apps/desktop/test/design-ui.qa.mjs`: split drafts, light/dark/compact and horizontal overflow.
- `node apps/desktop/test/performance.qa.mjs`: 800-message renderer typing, idle polling, streaming.
- `node apps/desktop/test/report-sandbox.qa.mjs`: production CSP, local interactions, outside links, bridge isolation.
- Standard server check/test/build and desktop test/build.
- Android Kotlin compile and unit tests; release lint/build and native delivery verified separately in the release record.

Independent Sol review found no concrete blockers; native keyboard/sheet checks remain a separate release gate. No new UI framework or animation dependency was added.
