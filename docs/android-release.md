# Android release builds

The Android companion is currently **0.2.0-alpha.1** (Android 9+). Release means
a non-debuggable APK signed with a persistent private key; it does not mean the
alpha has exhaustive device coverage.

## Download and install

Download the APK and SHA256SUMS from the matching GitHub release. Install the
matching Node package on the computer. Pair over your own Tailscale HTTPS endpoint.
The public APK contains no Firebase project configuration: foreground polling,
chat, attachments and voice work without Firebase. For screen-off push, register
your own Android app (package `dev.agentworkspace`) and follow the FCM instructions
in [android-workspace.md](android-workspace.md). Provider CLI logins, Tailscale and
ElevenLabs credentials are supplied by each user, not bundled.

## Build your own

Use JDK 17+, Android SDK 36/build-tools 36.0.0, and the checked-in Gradle wrapper.
Create a private release keystore outside the repository with Android Studio or
`keytool`. Keep its password in an owner-only file; securely back up both. Losing
the signing key prevents installing updates over an existing installation.

Set these environment variables (paths only, not the password itself):

```sh
export JAVA_HOME="/path/to/jdk"
export ANDROID_HOME="/path/to/android-sdk"
export ANDROID_KEYSTORE="/private/path/release.jks"
export ANDROID_PASSWORD_FILE="/private/path/password"
export ANDROID_KEY_ALIAS="release"
./scripts/android-release.sh
```

The script cleans generated resources, builds/lints release, signs with APK
Signature Scheme v3 and verifies the signature. The output defaults to
`.local/releases/agent-workspace-0.2.0-alpha.1.apk`.
It intentionally disables Firebase unless `WITH_FIREBASE=true` is set. Personal
push builds additionally need `apps/android/app/google-services.json`, which is
ignored by Git. Never distribute server service-account credentials or API keys.

## Updates and debug installations

Android requires a matching signing certificate or valid key-rotation lineage.
A debug APK cannot normally be replaced by an independently signed release APK.
Do not uninstall blindly: that removes local drafts, pairing and cache. For a
controlled migration, the owner of both keys can create a signing lineage with
Android's `apksigner rotate`, then set `ANDROID_SIGNING_LINEAGE` when building.
This project supports rotation on API 28+. Back up the lineage with the release key.
The public artifact and a private Firebase build can share a release certificate,
but installing the public artifact removes that build's push configuration.

The maintainer's first phone installation used a debug-to-release lineage to
preserve data. Signing material remains outside Git and release assets.

## Release checklist

- Run `npm run check`, `npm test`, `npm run build`; Android release build/lint.
- Inspect `npm pack --dry-run` and staged files for credentials and personal data.
- Verify APK signature, version, package and non-debuggable manifest.
- Install with `adb install -r`; verify pairing, chat history and app launch.
- Build public APK without Firebase; inspect its resources before upload.
- Publish APK, matching Node tarball and SHA256SUMS under the same version tag.
- Keep real device/API checks distinct from automated tests in release notes.

Signing reference: [Android apksigner](https://developer.android.com/tools/apksigner).
