# Agent Workspace for Even G2

A separate Even Hub app connected to the **same local workspace and persistent assistant** as the Android APK. TypeScript + official Even Hub SDK; no T3 runtime dependency. Source: [`apps/even-g2`](../apps/even-g2).

## What runs where

The plugin runs in the Even Realities phone app. G2 displays the UI and streams microphone input over Bluetooth; the phone reaches the computer over Tailscale HTTPS. The computer keeps the existing Codex/Claude providers, durable task state and ElevenLabs credential. No provider keys enter the plugin bundle.

G2 has a **576 × 288 monochrome display, microphones, touchpads and optional R1 input; no camera or speaker**. This is a glasses adaptation, not the Android APK running on glasses. PDFs, HTML viewers and rich image previews remain in the Android app. Glasses show text and task state; there is no audio playback from the glasses.

## Included

- Persistent assistant: talk on G2; responses arrive in the existing assistant conversation.
- Recording begins only on explicit interaction; tap to submit, double-tap to discard. Maximum 30 seconds of PCM16/16kHz mono. Foreground exit stops and discards capture; it never silently restarts the microphone.
- Task context: speaking while viewing a managed task includes its validated ID so the parent can route the instruction or answer.
- Jobs ordered active first, then latest activity. Lists paginate in groups of 16; long labels truncate and messages wrap into bounded pages.
- Managed session chats, task question text, cancellation with a separate confirmation, navigation history, OS exit request mode 1 on the root screen.
- Newly arriving assistant messages open from the home screen; reading another chat or recording is not interrupted.
- Phone companion: text chat, file upload (5 × 5 MiB), Codex/Claude session creation, managed jobs, direct question answers, external terminal session browsing and explicit confirmation before resuming.
- Connection import, opt-in local credential persistence, draft retention in session storage, bounded polling and reconnect. Task/response data remains durable on the server. Microphone buffers are memory-only.

External terminal history is browsed from the phone companion; managed sessions are available on glasses. Native terminal transcript pagination is currently limited to the returned first page. File cards/viewers and voice output are richer in the Android app. Even Hub background execution and lock-screen delivery are **not guaranteed**: they require real G2 beta validation.

## Build and run

Node 22.16+:

```sh
npm ci
npm run build
npm ci --prefix apps/even-g2
npm test --prefix apps/even-g2
npm run build --prefix apps/even-g2
npm run dev --prefix apps/even-g2
# another terminal
npm run simulator --prefix apps/even-g2
```

Pinned tools: SDK `0.0.16`, CLI `0.2.0`, simulator `0.9.5`. The simulator package's npm bin link was missing in the observed installation, so the script invokes its official Node launcher directly. SDK 0.0.16 requires Even app **2.2.10+**. The CLI derives and stamps this minimum at packaging time.

The official CLI currently accepts only en/de/fr/es/it/zh/ja/ko as catalog languages. The manifest uses `en` as the accepted catalog label; the current UI and assistant preference are Turkish. This is not a claim that the app is fully localized in English.

## Connect your computer

1. Run the existing `agent-orchestrator workspace` server, pair/configure it as described in [Android workspace](android-workspace.md), and expose it **only inside your tailnet** over HTTPS.
2. Set `ORCHESTRATOR_BROWSER_ORIGINS` to a JSON array of **exact UI origins** before starting the workspace service. For example:

   ```sh
   export ORCHESTRATOR_BROWSER_ORIGINS='["http://127.0.0.1:5173","https://your-computer.your-tailnet.ts.net:9444"]'
   ```

   Existing Android behavior is unchanged. No browser origin is allowed by default. Preflight grants no API access by itself; all data still requires the device bearer token. Cookies are not sent. Do not use `*`. A packaged WebView may have a different origin: inspect the actual request on your device and explicitly allow that exact value. `"null"` is supported only as an explicit administrator opt-in, but covers multiple opaque/file origins, so prefer a concrete HTTPS sideload origin where possible.

3. Build and serve the companion UI with `node apps/even-g2/scripts/serve.mjs`. It binds to loopback port 5174. Example Tailscale forwarding:

   ```sh
   tailscale serve --bg --https=9444 http://127.0.0.1:5174
   ```

4. Create a **private** connection file, from the repository root:

   ```sh
   node apps/even-g2/scripts/connection.mjs https://your-computer.your-tailnet.ts.net:9443
   # optional final argument: your workspace state directory
   ```

   Import `.local/even-connection.json` in the companion's connection settings. This file contains the workspace device token, with the same authority as your Android pairing. It is written with mode 0600, ignored by Git, and must never be included in `.ehpk`, sent to Even Hub, or shared with teammates. Each teammate creates their own file for their own server. A browser and the Even-hosted WebView have different storage: pair the WebView too.

5. “Remember connection” is opt-in: the token is stored in this app origin's local storage, **not an OS-backed credential vault**. Clearing the connection removes the saved token and local displayed chats; it does not revoke the server token or cancel ongoing work. To revoke a leaked device token, stop the server, rotate `device-secret`, restart, and re-pair all clients.

No secrets or personal endpoint are compiled into the public source manifest. The generated private manifest contains only your server's origin. Treat the built plugin as an authenticated remote-control client; do not load untrusted scripts into its origin.

## Package / install on G2

```sh
npm run pack --prefix apps/even-g2 -- https://your-computer.your-tailnet.ts.net:9443
```

Output: `apps/even-g2/.local/agent-workspace.ehpk`. The script validates HTTPS and stamps the exact network whitelist into a generated manifest. Relative asset URLs work inside the packaged WebView. There are no wildcard network permissions and no phone camera/microphone/location permissions.

For local hardware preview, point the official CLI QR at the HTTPS companion URL:

```sh
cd apps/even-g2
npx evenhub qr --url https://your-computer.your-tailnet.ts.net:9444
```

Scan with Even Realities → Even Hub profile → Developer/Prototype Mode → Scan QR. Keep G2 connected to the same phone. This preview is **not** a durable lock-screen install.

For daily use: sign in to the Even developer portal with the **same email** as the phone app, create the app and upload the `.ehpk` as Private, add yourself as an active beta tester, and promote that build to Beta. Confirm the package ID matches your registered developer namespace before creating the app. No public store submission is performed automatically. Published versions are immutable; use a higher version for later changes.

## Verification and limitations

Automated tests cover wrapping/Unicode, firmware container budgets, active sorting, HTTPS validation, PCM limits, no automatic mutation retry, browser fetch binding, nested back navigation, omitted-zero SDK click events, microphone stop/discard, duplicate-submit prevention, exact-origin CORS/authentication, and authorized voice task context.

Official simulator regression fixture (no real accounts/providers):

```sh
npm run dev --prefix apps/even-g2
# separate terminal; stop any earlier simulator first
node apps/even-g2/node_modules/@evenrealities/evenhub-simulator/bin/index.js \
  http://127.0.0.1:5173/test/harness.html --automation-port 9898
node apps/even-g2/scripts/simulator-smoke.mjs
```

Artifacts land in `apps/even-g2/.local/qa/`: RGBA framebuffers and console evidence. Simulator PNGs encode foreground using alpha: composite onto black to inspect them; simply converting to RGB loses the distinction. The root exit calls mode 1 (unit-tested); this simulator build clears the framebuffer on exit, so its screenshot is not evidence of the real firmware's confirmation dialog.

Restart the simulator after full Vite reloads: the observed simulator retains startup containers, so a second startup creation can return error 1. The app surfaces startup failure instead of blindly declaring initialization successful. Real hardware still needs reconnect/cold-start checks.

Before claiming hardware-ready, run these **on a beta-installed G2**:

- Speak Turkish, submit once, read the real assistant response; cancel a second recording and confirm no request was sent.
- Open a child task, answer its question with voice, verify the parent routes to the right child.
- Scroll long messages and multi-page job lists; test both temples and R1 if present.
- Disconnect Bluetooth and Tailscale separately, reconnect, confirm navigation and message continuity with no duplicate mutation.
- Lock Android for five minutes, open from the glasses menu, verify stored connection and restored server state. No automatic mic restart.
- Test rejected microphone permission, quota exhaustion, 401, API downtime, process reclaim and exit confirmation.

Simulation does not validate BLE timing, G2 microphone quality, firmware glyph coverage, Android process reclaim or background delivery. Those checks must be reported separately from successful unit/build/simulator checks.

## Primary references (checked 2026-10-25)

- [Platform overview](https://hub.evenrealities.com/docs/get-started/overview)
- [First app / manifest / SDK initialization](https://hub.evenrealities.com/docs/get-started/quickstart/first-app)
- [Display and container limits](https://hub.evenrealities.com/docs/build/display)
- [Microphones, gestures and event routing](https://hub.evenrealities.com/docs/build/device-apis)
- [Networking: whitelist and CORS](https://hub.evenrealities.com/docs/build/networking)
- [Android background lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle)
- [Official simulator and HTTP automation API](https://hub.evenrealities.com/docs/test/simulator)
- [Testing ladder](https://hub.evenrealities.com/docs/test)
- [Packaging and submission requirements](https://hub.evenrealities.com/docs/ship/app-submission)
