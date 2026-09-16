import { Capacitor } from '@capacitor/core';
import { claimReviewAttempt, recordReviewVisit } from './reviewPolicy';

export const REVIEW_STORE_URLS = {
  ios: 'https://apps.apple.com/app/id6791659887?action=write-review',
  android: 'https://play.google.com/store/apps/details?id=com.borderpayafrica.app',
};

export function recordNativeReviewVisit(userId: string): void {
  if (!Capacitor.isNativePlatform() || document.visibilityState !== 'visible') return;
  try { recordReviewVisit(localStorage, userId); } catch { /* Storage is optional. */ }
}

export async function requestReviewAfterPayment(userId: string, eligible: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('InAppReview')
    || document.visibilityState !== 'visible') return;
  try {
    if (!claimReviewAttempt(localStorage, userId, eligible)) return;
    const { InAppReview } = await import('@capacitor-community/in-app-review');
    await InAppReview.requestReview();
  } catch { /* Review availability must never affect payment completion/navigation. */ }
}

export function canOpenReviewStore(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AppLauncher')
    && ['ios', 'android'].includes(Capacitor.getPlatform());
}

export async function openReviewStore(): Promise<void> {
  const url = REVIEW_STORE_URLS[Capacitor.getPlatform() as keyof typeof REVIEW_STORE_URLS];
  if (!url || !canOpenReviewStore()) throw new Error('Store unavailable');
  const { AppLauncher } = await import('@capacitor/app-launcher');
  const result = await AppLauncher.openUrl({ url });
  if (!result.completed) throw new Error('Store unavailable');
}
