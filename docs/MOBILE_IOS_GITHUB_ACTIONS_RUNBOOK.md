# iOS TestFlight Build With GitHub Actions

This repo can build the Capacitor iOS app on a GitHub-hosted macOS runner using:

`.github/workflows/ios-testflight.yml`

## Required Apple Setup

1. Apple Developer app identifier exists for:
   `com.borderpayafrica.app`
2. App Store Connect app record exists for the same bundle id.
3. App Store Connect API key must be a Team key with App Manager or Admin access.

If Codemagic rejected the Issuer ID, check that the key was created under:

`App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys`

Do not use an Individual API Key for this workflow.

## GitHub Secrets

Open:

`GitHub repo > Settings > Secrets and variables > Actions > New repository secret`

Add these secrets:

```txt
APPLE_TEAM_ID
APP_STORE_CONNECT_ISSUER_ID
APP_STORE_CONNECT_KEY_IDENTIFIER
APP_STORE_CONNECT_PRIVATE_KEY
```

### APPLE_TEAM_ID

Find it in:

`developer.apple.com > Membership details`

It is usually a 10-character Team ID.

### APP_STORE_CONNECT_ISSUER_ID

Find it in:

`App Store Connect > Users and Access > Integrations > App Store Connect API`

Use the Issuer ID shown on the Team Keys page.

### APP_STORE_CONNECT_KEY_IDENTIFIER

This is the Key ID for the API key you generated.

### APP_STORE_CONNECT_PRIVATE_KEY

Paste the full `.p8` key content as the secret value, including:

```txt
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

Do not commit the `.p8` file.

## Run The Build

1. Go to GitHub.
2. Open the repo.
3. Click `Actions`.
4. Select `iOS TestFlight`.
5. Click `Run workflow`.
6. Set:
   - `app_version`: `1.0.1`
   - `build_number`: `37` (increase for every later upload)
   - `upload_to_testflight`: checked
7. Run.

The workflow will:

1. Install Node 24.
2. Run `npm ci`.
3. Run `npm run type-check`.
4. Run `npm run build`.
5. Run `npx cap sync ios`.
6. Archive the iOS app with automatic signing.
7. Export a signed `.ipa`.
8. Upload the `.ipa` artifact to GitHub Actions.
9. Upload the `.ipa` to TestFlight when enabled.

## Expected Failure Points

- `No profiles for ... were found`: the API key cannot manage signing, the Bundle ID is wrong, or `APPLE_TEAM_ID` is wrong.
- `authenticationKeyIssuerID` error: Issuer ID/key pair mismatch, or the key is not a Team API key.
- `No suitable application records were found`: `APP_STORE_APP_ID` is not used by this workflow, but the App Store Connect app record must still exist for `com.borderpayafrica.app`.
- `Invalid private key`: the `.p8` secret is incomplete or pasted with missing header/footer.

## Notes

- This workflow replaces Codemagic for iOS builds.
- Keep `codemagic.yaml` only as a fallback until we confirm GitHub Actions works.
- GitHub-hosted macOS minutes are limited and can cost money depending on the GitHub plan.
