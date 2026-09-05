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
  const result = await FirebaseAppCheck.getToken({ forceRefresh: false });
  return result.token || undefined;
}
