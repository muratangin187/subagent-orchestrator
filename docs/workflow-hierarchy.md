# Conversation workflow hierarchy

The desktop inspector and Android conversation workflow follow `parentTaskId` edges from the selected conversation. They show direct children by default. “Alt işleri de göster” expands descendants under their parents; it does not change scope or counts. Titles, cwd, provider and recorded depth do not establish ownership.

In the assistant conversation, the scope contains active descendants and any inactive ancestors needed to reach them. Completed, failed and cancelled branches without active descendants remain in the global jobs view. In a task conversation, all its descendants are eligible, including terminal jobs. A missing parent cannot prove membership, so its children are not promoted into this conversation; the existing global jobs tree still handles orphans. Traversal guards cycles. Native/provider sessions have no workflow without a proven orchestrator task relationship.

The heading badge counts eligible direct children. The summary gives direct children, all eligible nodes, and active nodes across that scope. An inactive ancestor retained for an active child contributes to the first two counts, not the active count. The global jobs badge and jobs tree retain their existing global meaning.

The toggle is stored per connection origin and actual conversation task ID using the desktop's localStorage and Android's existing local preference store. Reading the selected key during navigation avoids writing a previous conversation's state into the next one.

## Verification

- `npm run check`, `npm test` (72 tests), `npm run build` passed.
- Desktop tests (27 tests), TypeScript/Vite build and `npm --prefix apps/desktop run pack` passed.
- Android `assembleRelease testDebugUnitTest lintRelease` passed, including three workflow regression tests.
- After building desktop, run `node apps/desktop/test/workflow-ui.qa.mjs` from the repository root. This uses a separate headless browser and a small read-only bridge fixture; it makes no production requests. It checks default 3 / expanded 4, parent order, unrelated-child exclusion, reload persistence and conversation switching/back navigation. This is automated renderer QA, not physical-device evidence.
- 2026-10-27: the packaged macOS app was installed and its signature verified. The saved XPS connection opened; the actual inspector, toggle and count rendered. No server restart was performed.
- 2026-10-27: signed Android 0.3.0-alpha.1 (versionCode 6), retaining Firebase configuration and signing lineage, was installed on the discovered Samsung SM-A165F. The app launched to pairing/notification permission UI. This device had no prior installation. Workflow UI verification on the physical phone remains blocked on pairing: the coordinator's single-use code expires after 15 minutes and obtaining a new one requires restarting it. Active tasks were not interrupted to do so. No emulator substitution was made.

No message/event delivery, backend scheduling, global jobs tree or G2 changes are included. The source base includes scheduler fix `9216221`; no server artifacts were deployed.
