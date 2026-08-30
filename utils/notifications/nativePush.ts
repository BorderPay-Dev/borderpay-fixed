import type { PluginListenerHandle } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { supabase } from '../supabase/client';
import { isNativeRuntime, nativePlatform } from '../native/mobileRuntime';

const DEVICE_KEY = 'borderpay_push_device_id_v1';
const TOKEN_KEY = 'borderpay_push_token_v1';

function deviceId(): string {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

async function persistToken(token: string): Promise<void> {
  const platform = nativePlatform();
  if (platform !== 'ios' && platform !== 'android') return;
  const { error } = await supabase.rpc('register_push_device', {
    p_token: token,
    p_platform: platform,
    p_device_id: deviceId(),
  });
  if (error) throw error;
  localStorage.setItem(TOKEN_KEY, token);
}

function notificationRoute(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  return String((data as Record<string, unknown>).route || '');
}

export async function initializeNativePush(onOpenTransactions: () => void): Promise<() => void> {
  if (!isNativeRuntime()) return () => undefined;

  const supported = await FirebaseMessaging.isSupported();
  if (!supported.isSupported) return () => undefined;

  let permission = await FirebaseMessaging.checkPermissions();
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await FirebaseMessaging.requestPermissions();
  }
  if (permission.receive !== 'granted') return () => undefined;

  if (nativePlatform() === 'android') {
    await FirebaseMessaging.createChannel({
      id: 'transaction_updates',
      name: 'Transaction updates',
      description: 'Status changes for BorderPay transactions',
      importance: 4,
      visibility: 0,
      vibration: true,
    });
  }

  const handles: PluginListenerHandle[] = [];
  const tokenResult = await FirebaseMessaging.getToken();
  await persistToken(tokenResult.token);

  handles.push(await FirebaseMessaging.addListener('tokenReceived', ({ token }) => {
    void persistToken(token).catch(() => undefined);
  }));
  handles.push(await FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) => {
    if (notificationRoute(notification.data) === 'transactions') onOpenTransactions();
  }));

  return () => {
    for (const handle of handles) void handle.remove();
  };
}

export async function unregisterNativePush(): Promise<void> {
  if (!isNativeRuntime()) return;
  try {
    const id = localStorage.getItem(DEVICE_KEY);
    if (id) await supabase.rpc('unregister_push_device', { p_device_id: id });
  } finally {
    try { await FirebaseMessaging.deleteToken(); } catch { /* best effort */ }
    localStorage.removeItem(TOKEN_KEY);
  }
}
