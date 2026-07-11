# Mobile Release Checklist

## Completed In Repository

- Capacitor configured with `com.borderpayafrica.app`.
- iOS project generated under `ios/`.
- Android project generated under `android/`.
- Production web bundle copied into both native projects.
- App name set to BorderPay Africa.
- Native version set to `2.0.0`.
- Native build number/version code set to `1`.
- Android cleartext traffic disabled.
- Android app backup disabled.
- Existing BorderPay icon assets copied into native launcher/splash resources.
- Store submission notes prepared for App Store Connect and Play Console.

## Required Before TestFlight

- Install full Xcode.
- Run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- Open `ios/App/App.xcodeproj`.
- Select the BorderPay Apple Developer team.
- Confirm bundle ID `com.borderpayafrica.app`.
- Archive a Release build.
- Upload to App Store Connect.
- Add reviewer demo credentials.
- Submit to TestFlight internal testing before App Review.

## Required Before Play Internal Testing

- Install a Java runtime.
- Install Android Studio and Android SDK.
- Run `cd android && ./gradlew bundleRelease`.
- Configure Play App Signing.
- Upload the generated `.aab` to Play Console internal testing.
- Complete Data safety and Financial features declarations.

## Smoke Tests Before Store Submission

Run on iOS and Android:

- Install fresh app.
- Login.
- Logout.
- Forgot password / reset PIN.
- Individual dashboard loads without verification banners for approved users.
- Business dashboard loads without subscription or paid-plan gates.
- Wallet screen loads active VA and Bridge wallets.
- Add wallet / Add account screen opens and does not show placeholder rails.
- VA detail opens for active VA only.
- Send crypto payout preview works.
- Africa payout UI hides USDC for supported corridors.
- Receive screen opens.
- Add money / Africa collection screen opens for supported corridors only.
- Transactions screen loads without duplicate rows.
- Notifications screen loads without duplicate rows.
- KYC/KYB restart links work for users stuck in pending setup.

## Release Rule

Do not submit public production release until internal testing confirms money movement, dashboard balances, notifications, transactions, and business parity on both platforms.
