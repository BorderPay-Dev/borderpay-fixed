import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import { isNativeRuntime } from '../native/mobileRuntime';

let initialization: Promise<void> | null = null;

async function initializeNativeAppCheck(): Promise<void> {
  if (!isNativeRuntime()) return;
  if (!initialization) {
    initialization = FirebaseAppCheck.initialize({
      isTokenAutoRefreshEnabled: true,
    });
  }
  await initialization;
}

export async function getNativeAppCheckToken(): Promise<string | undefined> {
  if (!isNativeRuntime()) return undefined;
  try {
    await initializeNativeAppCheck();
    const result = await FirebaseAppCheck.getToken({ forceRefresh: false });
    return result.token || undefined;
  } catch (error) {
    // During the staged rollout the server remains authoritative: it accepts
    // a missing token while enforcement is off and records the request for
    // telemetry. Once enforcement is enabled it rejects the same request.
    console.warn('[security] Native app attestation unavailable', error);
    return undefined;
  }
}
