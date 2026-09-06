import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.borderpayafrica.app',
  appName: 'BorderPay',
  webDir: 'dist',
  bundledWebRuntime: false,
  backgroundColor: '#0B0E11',
  server: {
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'never',
    // Firebase Messaging aborts during CAPBridgeViewController startup when
    // GoogleService-Info.plist is absent. iOS push is deliberately excluded
    // until the signed Firebase configuration is supplied and release-gated.
    includePlugins: [
      '@aparajita/capacitor-biometric-auth',
      '@capacitor-firebase/app-check',
      '@capacitor/filesystem',
      '@capacitor/share',
    ],
  },
  android: {
    allowMixedContent: false,
  },
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/app-check': { symlink: true },
        },
      },
    },
  },
};

export default config;
