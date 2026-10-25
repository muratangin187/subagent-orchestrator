#!/usr/bin/env bash
set -euo pipefail
# Build a portable APK by default. Personal Firebase builds require WITH_FIREBASE=true.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Set ANDROID_HOME}"
: "${JAVA_HOME:?Set JAVA_HOME}"
: "${ANDROID_KEYSTORE:?Set ANDROID_KEYSTORE to a private release keystore}"
: "${ANDROID_PASSWORD_FILE:?Set ANDROID_PASSWORD_FILE to an owner-only password file}"
BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-36.0.0}"
OUTPUT="${1:-$ROOT/.local/releases/agent-workspace-0.2.0-alpha.1.apk}"
mkdir -p "$(dirname "$OUTPUT")"
"$ROOT/apps/android/gradlew" -p "$ROOT/apps/android" :app:clean :app:assembleRelease :app:lintRelease "-PwithFirebase=${WITH_FIREBASE:-false}"
args=(sign --ks "$ANDROID_KEYSTORE" --ks-key-alias "${ANDROID_KEY_ALIAS:-release}"
  --ks-pass "file:$ANDROID_PASSWORD_FILE" --min-sdk-version 28 --v1-signing-enabled false
  --v2-signing-enabled false --v4-signing-enabled false)
if [[ -n "${ANDROID_SIGNING_LINEAGE:-}" ]]; then
  args+=(--lineage "$ANDROID_SIGNING_LINEAGE" --rotation-min-sdk-version 28)
fi
"$ANDROID_HOME/build-tools/$BUILD_TOOLS/apksigner" "${args[@]}" --out "$OUTPUT" "$ROOT/apps/android/app/build/outputs/apk/release/app-release-unsigned.apk"
"$ANDROID_HOME/build-tools/$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$OUTPUT"
shasum -a 256 "$OUTPUT"
