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
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    FirebaseMessaging: {
      presentationOptions: ['alert', 'badge', 'sound'],
    },
  },
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/messaging': { symlink: true },
        },
      },
    },
  },
};

export default config;
