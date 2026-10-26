# Agent Workspace for Android — alpha

A native Kotlin/Compose companion for a computer running the standalone orchestrator. The persistent **Assistant** delegates long tasks. The three-dot chat menu contains model/effort selection, remaining quota, settings and **Sessions**. Sessions open in a bottom sheet and list only Workspace conversations; selecting one replaces the current chat. Device selection belongs to the new-session form. The header job count always opens the hierarchical job list, including when no jobs are active. There is no bottom navigation bar.

Voice assistant opens from the header. The composer contains the message field, dictation microphone, attachment and send buttons. Dictation fills the draft without sending it. Messages show their recorded local time (HH:mm); orchestration tools use readable labels.

The desktop companion follows the same conversation-first layout: no left sidebar; sessions, remaining quota and settings live in the right rail. Jobs and Workspace sessions open in dialogs. Model and effort share a single composer control.

Messages include raw-text copy. Expand **Worked for** to inspect the turn’s tool calls and provider-published thinking; tap an item for its input/output. Active turns show a running timer.

## Run the computer service

Requires the matching release package or repository build, Node 22.16+, signed-in Codex/Claude CLIs, and Tailscale on both devices. Use a separate state directory so the mobile service does not interfere with existing MCP daemons:

```sh
npm install -g https://github.com/muratangin187/subagent-orchestrator/releases/download/v0.2.0-alpha.1/standalone-agent-orchestrator-0.2.0-alpha.1.tgz
agent-orchestrator workspace --home "$HOME/.local/share/agent-workspace" \
  --cwd /absolute/path/to/project --model YOUR_SUPPORTED_CODEX_MODEL --port 8787
```

When using a checkout rather than an installed release, replace `agent-orchestrator` with `node dist/cli.js`. `ORCHESTRATOR_CODEX_BIN` and `ORCHESTRATOR_CLAUDE_BIN` select explicit CLI binaries. Models come from your installed provider and account; the app does not silently substitute unsupported models.

Codex shell network access is disabled by default. To enable internet access without
granting file writes, set `ORCHESTRATOR_CODEX_NETWORK_ACCESS=true` in the computer
service environment and restart the service while idle. This host-level setting
applies to subsequent Codex turns (including resumed sessions and children); it
also enables live web search. It does not change the filesystem permission ceiling
or enable permission escalation. Existing active turns keep their original policy.

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
- Attachments use Android's document picker, up to 5 MiB per file and five files per message. Upload requires a connection; a queued message references an already uploaded file. Sent attachments appear as clickable cards with filename, type and size. Text formats open in an in-app preview (first 100,000 characters). PDFs open in a paginated native viewer with zoom; images use Coil with zoom/pan. Self-contained HTML/HTM opens in a WebView with inline CSS/JavaScript and embedded images. Network requests, frames, forms, file access and native bridges are blocked; external/CDN assets are not loaded. Every viewer has an explicit “Open in another app” action using a temporary content-URI grant. Password-protected PDFs show a readable error and can be opened externally. Downloaded files are cached privately on the phone. Files remain in the workspace's `.orchestrator-attachments` directory; no automatic retention policy yet.
- Single computer, single paired phone, fixed project for newly created sessions. No multi-user accounts or UI project picker yet.
- Slack/email and other inherited MCP integration profiles are not implemented. The assistant must report them unavailable rather than pretend to execute them.
- Local notifications and cache do not make the computer service available while the computer sleeps.
- Chat messages render Markdown headings, emphasis, lists, task lists, quotes, code and tables. Text can be selected; web/email links open on tap. Computer file paths remain references on the phone. Remote images and HTML execution are disabled. Table cells have equal widths; table contents are not included in native text selection. The sessions screen supports local title/path search and provider filters; the drawer can show active jobs only. Draft text is saved per session on the phone.

## Verification

The automated suite covers queue idempotency, asynchronous assistant turns, child-result delivery, quota recovery, authentication, one-use pairing, browser-origin rejection, and privacy/retry behavior of the push boundary. Run `npm run check`, `npm test`, `npm run build` and Android lint before release.

A development run on a physical Android phone verified pairing, private Tailscale access, drawer navigation, child transcripts, rendered Markdown, message submission through the phone UI, Android document selection, and real FCM receipt while the screen was in Doze. A file selected on the phone was uploaded and read by Codex, which returned a verification code present only in that file. Attachment prompts remain internal; chat shows the original message and filenames. A real Codex run verified asynchronous delegation, answering a separate arithmetic question while the child ran, and a later summary in the same native assistant session. A separate live Claude turn returned a provider session-limit error; the structured quota state and push dispatch were verified, but successful Claude generation remains unverified in this run. These are observed checks, not a claim of exhaustive device compatibility or production readiness.

Viewer QA on the physical Android device: a two-page synthetic PDF rendered and navigated to page two; the external-app chooser opened; HTML/CSS rendered and an inline JavaScript button changed its label; a synthetic PNG rendered in the image preview.

## Voice assistant (alpha)

Open **Asistan → Sesli asistan** for the avatar view without message bubbles.
**Ayarlar** accepts an ElevenLabs API key and lists voices available to that account.
The key needs Voices read, Speech to Text and Text to Speech access. It is sent over the
paired HTTPS connection and stored only in the computer's state home as
`elevenlabs.json` (owner-only file permissions). It is not embedded in the APK.
The settings screen blocks screenshots; the key field disables keyboard suggestions.

Speech uses ElevenLabs Scribe v2 to transcribe Turkish, then submits to the existing
persistent Codex assistant. The assistant can delegate work and handle new topics
while children run. New assistant replies use ElevenLabs Multilingual v2. This is
turn-based speech, not a separate ElevenLabs conversational agent or a realtime
full-duplex call. Pause briefly to submit; each utterance is limited to 30 seconds.
Use **Söz al** to interrupt playback. Microphone mute and response playback are separate.
Leaving the voice screen, backgrounding the app or losing audio focus stops the call.
No background microphone service is installed.

Audio and spoken reply text leave the computer for ElevenLabs. Provider retention
depends on the account's terms; zero retention is not implied. Raw recordings are
not stored by this service. Transcripts remain in normal assistant history. Generated
speech is cached privately under `voice-cache` on the computer, without automatic expiry.
The phone deletes temporary playback files. Starting a call skips older replies.

Transcription requests use durable request IDs: a completed retry returns the same
receipt; an uncertain attempt is not automatically replayed. Concurrent synthesis of
the same reply/voice shares one request and successful audio is reused. Failed synthesis
can be retried and provider charging cannot be guaranteed exactly once across crashes.

Validation: automated tests cover credential redaction/permissions, transcript
deduplication, conflicting retries, quota errors and uncertain-request handling.
Android debug build and lint pass. The avatar view and settings navigation were
checked on a physical phone. A real ElevenLabs API check synthesized a short Turkish test sentence and Scribe
transcribed it correctly. Phone microphone capture and conversational playback need
a separate live spoken check; API round-trip success does not establish device audio quality.

### Görünüm
Ayarlar → Görünüm bölümünde Sistem / Açık / Koyu ve Petrol / Mavi / Bakır / Gül vurgu renkleri seçilebilir. Seçim telefonda saklanır ve uygulama yeniden başlatıldığında korunur; cihazlar arasında senkronize edilmez. Sistem modu Android görünümünü izler. IBM Plex Sans uygulamaya gömülüdür; yazı tipi için ağ isteği yapılmaz. Tasarım kararları kökteki DESIGN.md dosyasındadır.

### Attachments and app lifecycle

The composer accepts images from Android's paste/keyboard rich-content menu and
cross-app drag and drop (when the keyboard/source app provides a content URI).
Desktop accepts clipboard images with Cmd+V and files dropped on the composer.
Images show a small preview; other supported files keep their filename. The same
five-file, 5 MiB-per-file limits apply to every entry point. Add a message before
sending. Unsaved composer drafts and in-progress uploads are local to the UI.

Closing a client does not cancel server-accepted work. The coordinator and the
executing computer must remain running. Do not restart the coordinator to deploy
an update during active provider runs: interrupted runs can require explicit
recovery rather than automatic replay.

The trusted assistant profile coordinates asynchronously and delegates repository
edits. It does not acquire a shared repository writer slot; ordinary writing
sessions continue to serialize. Child completion/questions return as later turns.
Android retrieves all event pages, then resumes after the last received event;
long conversations no longer stop at the first 4,000 events.

### Models, reasoning and dictation

Choose a model and its reasoning level in the composer on Android or macOS. The
list comes from the selected execution computer's installed providers; unavailable
models are not silently substituted. The choice applies when you send the next
message, after any current turn finishes. Other clients see the applied choice
when the next turn starts.

Switching Codex ↔ Claude opens a fresh native session with bounded recent chat
history and child-task references. The app conversation and child ownership stay
the same. Switching models within one provider resumes that provider's session.
A handoff does not replay completed tools or restart children. Older context may
be omitted; it is not a byte-for-byte migration of native provider history.

**Dikte** records speech and appends its transcription to your draft. It never
sends the draft automatically. Review/edit the text, then send it yourself. On
Android, a pause ends the recording; on desktop, use **Dikteyi bitir**. Leaving
the app cancels recording. **Sesli asistan** remains the separate conversational
voice flow. Both use the existing server-side ElevenLabs connection.

### Hesap limitleri ve görev ağacı

Masaüstünde Ayarlar'ın üstündeki Codex/Claude çubukları, mobilde sohbet başlığındaki halka **kalan** kota yüzdesini gösterir. Birden fazla dönem varsa özet en az kotası kalan dönemi seçer. Üzerine basınca kısa dönem, haftalık ve sağlayıcının sunduğu model pencereleri ile yenilenme zamanları açılır. Değerler seçili oturumun çalıştığı cihazdaki hesaptan, yaklaşık dakikada bir okunur. Bilinmeyen değer sıfır olarak gösterilmez; güncelleme hatası ve son kontrol zamanı ayrıntıda belirtilir.

İşler ekranı alt görevlerin alt görevlerini de içerir. Girinti ve üst görev yolu ilişkiyi gösterir. Mobilde aktif iş filtresi, aktif bir alt görevin üst görevlerini de bağlam için tutar. Masaüstü bağımsız oturumları ayrıca işaretler.

Limit okuması bir model turu başlatmaz. Codex app-server hesap limitleri ve Claude SDK'nin deneysel kullanım sorgusu kullanılır; CLI sürümü veya hesap türü bu sorguyu desteklemiyorsa sohbet çalışmaya devam eder, limit bilgisi kullanılamaz olarak görünür.

### Local file links in chat

Desktop and Android intercept absolute filesystem and `file://` Markdown links.
`POST /v1/artifacts/open` resolves the file on the selected conversation device,
then tries other registered devices. Each device only serves regular
files inside its configured workspace; hidden paths, symlink escapes and files larger than 512 MiB are rejected. Offline devices and missing
files produce a visible error. No shell command is constructed from the link.

The gateway snapshots the bytes into its authenticated attachment store. Existing
HTML/PDF/image/text viewers and desktop Save/Open actions use that snapshot;
Android's **İndir** uses the system document picker to save on the phone. Unknown types (including APK) and files above the 5 MiB preview limit download automatically: Android 10+ saves to Downloads, Android 9 opens the document picker, and desktop saves a uniquely named copy in Downloads and reveals it in Finder. No installer or executable is launched. Transfers use bounded 4 MiB chunks, with source-version checks during snapshot creation and incomplete-file cleanup. Markdown has formatted and raw-source views on both clients. HTML
previews retain their isolated rendering policies; relative sibling resources
are not fetched. The source file is not changed. A later click reads the current
source again. Files outside a device's configured workspace must first be placed
inside that workspace.

### Queue and explicit steering

Normal chat sends use `queue`: an active turn finishes before the next message
starts. Desktop and Android show pending messages as **Sırada**. For Codex,
**Şimdi yönlendir** promotes that existing command to `steer` without duplicating
it. Promotion is scoped, idempotent and rejected if already dispatched, inactive,
or requesting a model change. Claude messages remain queued; the UI does not
silently interrupt and restart Claude. Background notifications stay queued and
are not shown as user steering cards.

Usage indicators display **remaining quota** (`100 - usedPercent`), including both sidebar bars, the mobile ring and all detail rows. The summary selects the window with the least remaining quota; missing data remains unknown, never 100%.
