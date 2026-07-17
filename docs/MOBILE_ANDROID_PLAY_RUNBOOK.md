# BorderPay Android Play Store Runbook

## Package

- App package: `com.borderpayafrica.app`
- Build artifact: Android App Bundle (`.aab`)
- Default Play track: `internal`

## Google Play Console

1. Create a Google Play Console app.
2. Set the package name to `com.borderpayafrica.app`.
3. Enroll the app in Play App Signing.
4. Create an internal testing track.
5. Create a Google Cloud service account for Play uploads.
6. In Play Console, grant that service account access to this app with release/upload permissions.
7. Download the service account JSON.

## GitHub Secrets

Add these repository secrets:

- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

`ANDROID_UPLOAD_KEYSTORE_BASE64` must be the base64-encoded upload keystore file:

```bash
base64 -i upload-keystore.jks | pbcopy
```

`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` must be the full JSON content downloaded from Google Cloud.

## Build Only

Run GitHub Actions workflow `Android Play` with:

- `app_version`: `1.0`
- `upload_to_play`: `false`

This produces a signed `.aab` artifact for manual upload.

## Upload To Internal Testing

Run GitHub Actions workflow `Android Play` with:

- `app_version`: `1.0`
- `upload_to_play`: `true`

The workflow builds a signed `.aab` and uploads it to Google Play internal testing as a draft release.

## Notes

- The upload keystore must be kept permanently. Do not rotate it casually.
- Increase version code by using a new GitHub Actions run. The workflow uses the GitHub run number as Android `versionCode`.
- If Google Play says the package does not exist, create the app in Play Console first and complete package registration.
