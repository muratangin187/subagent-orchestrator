# Isolated viewer QA on a physical Android phone

Build `./gradlew :app:assembleDebug -PisolatedQa=true -PwithFirebase=false`.
The opt-in suffix produces `dev.agentworkspace.qa`, with its own private data and FileProvider authority. It does not replace or read the personal app. `ViewerQaActivity` exists only in debug sources and refuses to run without the suffix.

Claim the shared phone using the phones MCP and inspect its current screen first. Install the APK in place using the explicitly discovered serial, then use Argent `launch-app` with package `dev.agentworkspace.qa` and activity `dev.agentworkspace.ViewerQaActivity`. Follow the normal accessibility-tree targeting rules.

Open each fixture and verify:

- PDF: two pages, next/previous boundary, pinch/scroll, close.
- Image: fit, zoom, close.
- Markdown: headings, list/table, raw/copy controls where available.
- HTML: local Filter button changes the result; no outside access required.
- Long text: scroll to the end.
- Malformed PDF/image: readable failure state and working close control.
- Work details: expand/collapse the synthetic tool output.

Use both themes and larger font where useful. Restore any device preference changed during testing. Do not grant credentials or pair this QA app. Do not use the ordinary MainActivity for this fixture test. Release the phone lease and stop only this session's Argent device services when finished.
