# Agent Workspace for macOS

A spacious desktop companion for your existing Agent Workspace server. One persistent assistant, your Codex and Claude sessions, and a live view of delegated work.

- Three-column layout: navigation, conversation, and task inspector.
- Searchable sessions, native terminal history, and explicit resume confirmation.
- Job board, child tasks, cancellation, and answers to agent questions.
- Markdown conversations, file attachments, image/text previews, paginated PDF viewing, sandboxed HTML rendering, and native downloads/opening.
- Expandable per-turn work logs: tool input/output, provider-published thinking, elapsed time, and raw Markdown copy.
- Voice capture and speech playback through the server's ElevenLabs configuration.
- macOS menus, keyboard shortcuts, encrypted connection storage, and generic task notifications.

## Run locally

Requires Node 22.16+, macOS, and a running Workspace gateway. See [server setup](../../docs/android-workspace.md).

```sh
cd apps/desktop
npm ci
npm test
npm run build
npm start
```

Choose **Bu Mac’e bağlan** to connect to the gateway on localhost:8787 using the existing local device secret. No token needs to be copied into chat. Alternatively, import a private connection JSON containing `origin` and `token` through Settings. Never commit that file.

```sh
npm run pack  # local .app bundle
npm run dist  # DMG; requires additional disk space
```

The current packaging configuration produces an ad-hoc signed local build with the app bundle identity and audio-input entitlement. Distribution to teammates needs Developer ID signing and notarization; automatic updates are not implemented. The app uses the host architecture unless a different target is explicitly requested.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘ K | Search sessions |
| ⌘ N | New session |
| ⌘ 1 / 2 / 3 | Assistant / jobs / sessions |
| ⌘ , | Settings |
| Enter / Shift Enter | Send / new line |
| Escape | Close overlay and stop voice capture |

## Security and behavior

The sandboxed renderer has no Node access and never receives the bearer token. The main process validates IPC senders, API routes, connection origins, and external links. Connection credentials are encrypted using Electron safeStorage. Requests do not follow redirects. Ambiguous failed sends are not automatically retried.

State refreshes every four seconds. Notifications require an open or minimized window and macOS notification permission; closing the last window stops refreshes. The gateway and provider sessions run independently of this window.

## Current limits

- The existing Workspace server must already be installed and running; this app does not bundle it.
- PDF pages and zoom work in-app; password-protected PDFs can be opened in Preview. HTML preserves layout while scripts, forms, remote resources and navigation are blocked. Opening the original file in another Mac application uses that application’s behavior.
- Voice is turn-based, up to 30 seconds per recording, with microphone selection, a live input meter, automatic reply playback and a mute control. It requires macOS microphone permission and the server's ElevenLabs setup. Empty recordings are rejected before upload; empty transcripts never create assistant messages. Physical Mac microphone capture was confirmed by the user after fixing permission checks and launching the locally signed bundle through LaunchServices. The macOS permission is checked before capture; when denied, enable Agent Workspace in System Settings → Privacy & Security → Microphone, then restart. Choose a named microphone if the system default is a Bluetooth headset.
- Native terminal history is available, but resume requires confirmation that another terminal is not actively using that session.
- Unsaved drafts are kept only while the app runs.

## Validation

Automated tests cover the IPC route boundary, origin validation and external-link policy. Manual macOS checks verified local connection, existing conversations, native Codex history, a real assistant reply, and a newly created Codex session receiving a response. Additional checks verified a real two-page PDF and a styled HTML attachment through the conversation, including inert script content. Unit tests cover microphone permission boundaries, PCM clipping/silent speaker output and rejected empty transcripts. These checks do not establish full Claude or notification end-to-end coverage; audible reply quality still needs user confirmation.

The PCM worklet was also exercised inside the packaged Electron runtime with a synthetic oscillator: 16 kHz samples reached the recorder while the worklet kept speaker output silent. This isolates the capture pipeline from physical microphone quality.

### Launching microphone tests on macOS

Launch the packaged app through Finder or macOS LaunchServices (`env -u ELECTRON_RUN_AS_NODE open -a "Agent Workspace"`). Spawning the executable directly from a development host can attribute microphone access to that host instead of this app. For CDP testing, launch through LaunchServices with `--args --remote-debugging-port=9337`, then attach Argent to the running target. Do not change the host application’s entitlements or bypass macOS consent.

On 26 October 2026, the user confirmed live microphone operation in the installed Mac app. The previous host-attributed TCC denial was resolved without modifying T3 Code permissions.

Mouse back/forward buttons, Alt+Left/Right and Cmd+[/] navigate the in-app history. Chat and list scroll positions are restored separately during the current app session; up to 20 loaded transcripts are retained for immediate return. Copy preserves raw Markdown, and the adjacent speech action is labelled “Seslendir”.

Appearance is available under **Ayarlar → Görünüm**: system/light/dark and teal/blue/copper/rose accent colors, saved locally. System mode follows live OS changes. The interface uses bundled, OFL-licensed IBM Plex Sans and semantic color tokens; see [DESIGN.md](../../DESIGN.md). Documents keep their own colors. Ad-hoc macOS upgrades may prompt for Keychain permission again when opening the encrypted connection.
