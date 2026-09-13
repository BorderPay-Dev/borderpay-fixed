import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import { isNativeRuntime } from '../native/mobileRuntime';

let initialization: Promise<void> | null = null;

async function initializeNativeAppCheck(): Promise<void> {
  if (!isNativeRuntime()) return;
  if (!initialization) {
    initialization = FirebaseAppCheck.initialize({ isTokenAutoRefreshEnabled: true });
  }
  await initialization;
}

export async function getNativeAppCheckToken(): Promise<string | undefined> {
  if (!isNativeRuntime()) return undefined;
  await initializeNativeAppCheck();
  const cached = await FirebaseAppCheck.getToken({ forceRefresh: false });
  if (cached.token) return cached.token;

  // A newly installed app can return an empty cached token while platform
  // attestation is still being established. Retry once with a forced refresh
  // so signup does not fall through to the browser-CAPTCHA path.
  const refreshed = await FirebaseAppCheck.getToken({ forceRefresh: true });
  return refreshed.token || undefined;
}
