# Agent Workspace for Android — alpha

A native Kotlin/Compose companion for a computer running the standalone orchestrator. Two views share one local service: **Assistant**, a persistent Codex conversation that delegates long tasks, and **Sessions**, for Codex/Claude conversations and local history. A job drawer opens child transcripts and pending questions.

## Run the computer service

Requires the repository build, Node 22.16+, signed-in Codex/Claude CLIs, and Tailscale on both devices. Use a separate state directory so the mobile service does not interfere with existing MCP daemons:

```sh
npm ci
npm run build
agent-orchestrator workspace --home "$HOME/.local/share/agent-workspace" \
  --cwd /absolute/path/to/project --model YOUR_SUPPORTED_CODEX_MODEL --port 8787
```

When using a checkout rather than an installed release, replace `agent-orchestrator` with `node dist/cli.js`. `ORCHESTRATOR_CODEX_BIN` and `ORCHESTRATOR_CLAUDE_BIN` select explicit CLI binaries. Models come from your installed provider and account; the app does not silently substitute unsupported models.

The service defaults to **read-only**. Set `--ceiling workspace-write` only for a workspace where agents should edit files. The phone cannot elevate the ceiling. New sessions use this working directory; an imported native session retains its own directory.

Expose the loopback API through a private Tailscale HTTPS endpoint, for example:

```sh
tailscale serve --bg --https=9443 http://127.0.0.1:8787
```

Choose an unused port and preserve existing Serve routes. Do not enable Funnel. Pair the app with the HTTPS URL and the code in `<home>/pairing-code`. The code expires after 15 minutes, is single-use, and allows at most ten attempts. Restart the service for a new code. The API accepts a bearer credential, rejects browser origins, and binds only to localhost. Pairing is currently **single-device**, with one shared credential per workspace. To revoke it, stop the service, remove `<home>/device-secret`, restart and pair again.

The computer must remain awake and connected for providers and API access. Tailscale connectivity does not itself deliver Android notifications.

## Build an APK

Use Android Studio's JDK (or JDK 17+) and Android SDK 36:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
apps/android/gradlew -p apps/android :app:assembleDebug :app:lintDebug
```

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Install with `adb -s DEVICE install -r PATH_TO_APK`; `-r` preserves the paired credential and local chat cache. The repository builds without Firebase configuration; notifications require the optional setup below. Debug APKs are development artifacts, not signed production releases.

## Optional FCM notifications

Create a separate Firebase project under your own account. Register the Android app `dev.agentworkspace` and save its downloaded configuration to `apps/android/app/google-services.json` (gitignored). Rebuild the APK. Analytics is not required.

Enable the FCM API. Create a service account in **that same project**, with only `cloudmessaging.messages.create` permission. Keep its JSON credential outside the repository with mode `0600`. Start the computer service with:

```sh
export ORCHESTRATOR_FCM_PROJECT="your-firebase-project"
export ORCHESTRATOR_FCM_CREDENTIALS="$HOME/.local/share/agent-workspace/fcm-sender.json"
```

The sender explicitly checks that the credential belongs to the configured project; it does not fall back to another Google account's application-default credentials. Never commit this key, embed it in an APK, or share it with teammates. Each installation should use its own project/sender configuration.

Allow Android notifications when prompted. A successful foreground connection registers the device's FCM token. The push payload contains fixed generic copy and an opaque event ID, **no chat text, task title, files, or results**. Google still receives the device registration and transport metadata needed to deliver FCM. Opening the app reads updates over the authenticated Tailscale connection.

Delivery receipts and cursors survive service restart. Transient failures retry with backoff; expired tokens are marked unavailable until device registration refreshes. Delivery is at least once, not exactly once: a crash after FCM accepts a message can repeat its event ID. A stable notification tag collapses repeated alerts. Push is a hint, not the source of truth; opening the app resynchronizes even if a notification was missed. Phone battery policies, permission denial, force-stop, and connectivity can still delay or suppress notifications.

## Assistant behavior

The first assistant message creates its persistent Codex session. Later user messages and child results use that same native session. Long work must be delegated asynchronously: the assistant acknowledges and ends its turn; it cannot call blocking child waits. New topics can proceed while a child runs. The computer records child events before scheduling a new assistant turn, with durable delivery IDs. Questions, failures and quota limits remain visible. A quota-blocked or uncertain assistant is not silently restarted by background events; explicit user input is required.

Direct messages to a child also inform the assistant. Answer cards route each answer to the exact task/question. Cancellation cascades according to the engine's existing semantics. Tool events can be inspected separately from chat text.

External sessions are discovered from the local provider history. Before continuing an external session, the UI requires confirmation that its terminal turn has stopped. Provider discovery cannot establish an OS-wide ownership lease: **do not run the same native conversation simultaneously from the terminal and phone**. Imported sessions use this service's permissions/instructions and tool configuration; terminal MCP integrations are not automatically inherited.

## Current boundaries

- Native Android app; local SQLite cache/outbox, HTTPS API, foreground polling. No Room migration or SSE transport yet.
- Native session and transcript pagination is supported. Provider histories are exposed only as far as the installed provider APIs permit.
- Attachments use Android's document picker, up to 5 MiB per file and five files per message. Upload requires a connection; a queued message references an already uploaded file. Sent attachments appear as clickable cards with filename, type and size. Text formats open in an in-app preview (first 100,000 characters); PDFs/images use an installed viewer with a temporary content-URI grant. Downloaded files are cached privately on the phone. Files remain in the workspace's `.orchestrator-attachments` directory; no automatic retention policy yet.
- Single computer, single paired phone, fixed project for newly created sessions. No multi-user accounts or UI project picker yet.
- Slack/email and other inherited MCP integration profiles are not implemented. The assistant must report them unavailable rather than pretend to execute them.
- Local notifications and cache do not make the computer service available while the computer sleeps.
- Chat messages render Markdown headings, emphasis, lists, task lists, quotes, code and tables. Text can be selected; web/email links open on tap. Computer file paths remain references on the phone. Remote images and HTML execution are disabled. Table cells have equal widths; table contents are not included in native text selection. Search and polished attachment previews remain UI work.

## Verification

The automated suite covers queue idempotency, asynchronous assistant turns, child-result delivery, quota recovery, authentication, one-use pairing, browser-origin rejection, and privacy/retry behavior of the push boundary. Run `npm run check`, `npm test`, `npm run build` and Android lint before release.

A development run on a physical Android phone verified pairing, private Tailscale access, drawer navigation, child transcripts, rendered Markdown, message submission through the phone UI, Android document selection, and real FCM receipt while the screen was in Doze. A file selected on the phone was uploaded and read by Codex, which returned a verification code present only in that file. Attachment prompts remain internal; chat shows the original message and filenames. A real Codex run verified asynchronous delegation, answering a separate arithmetic question while the child ran, and a later summary in the same native assistant session. A separate live Claude turn returned a provider session-limit error; the structured quota state and push dispatch were verified, but successful Claude generation remains unverified in this run. These are observed checks, not a claim of exhaustive device compatibility or production readiness.
