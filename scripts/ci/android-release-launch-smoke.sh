#!/usr/bin/env bash
set -euo pipefail

package_name="${PACKAGE_NAME:-com.borderpayafrica.app}"
apk_path="android/app/build/outputs/apk/release/app-release.apk"
log_path="${RUNNER_TEMP:-/tmp}/borderpay-android-launch.log"

test -s "$apk_path"
adb install -r "$apk_path"
adb logcat -c
adb shell am force-stop "$package_name"
adb shell am start -W -n "$package_name/.MainActivity"
sleep 12
adb logcat -d -v threadtime > "$log_path"

pid="$(adb shell pidof "$package_name" | tr -d '\r')"
if [[ -z "$pid" ]]; then
  echo "Android release process exited during cold-launch smoke test." >&2
  grep -E -A 40 -B 10 "FATAL EXCEPTION|Process: ${package_name}|AndroidRuntime" "$log_path" >&2 || true
  exit 1
fi

if grep -E -q "FATAL EXCEPTION.*|Process: ${package_name}.*has died" "$log_path"; then
  echo "Android release emitted a fatal startup error." >&2
  grep -E -A 40 -B 10 "FATAL EXCEPTION|Process: ${package_name}|AndroidRuntime" "$log_path" >&2 || true
  exit 1
fi

echo "Android release cold launch passed (pid ${pid})."
