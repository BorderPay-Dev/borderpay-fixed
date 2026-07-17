type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

function capacitor(): CapacitorGlobal | null {
  try {
    return (globalThis as any).Capacitor || null;
  } catch {
    return null;
  }
}

export function isNativeRuntime(): boolean {
  const cap = capacitor();
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
  } catch {
    return false;
  }
  return false;
}

export function nativePlatform(): 'ios' | 'android' | 'web' | 'unknown' {
  const cap = capacitor();
  if (!cap || typeof cap.getPlatform !== 'function') return 'web';
  try {
    const platform = cap.getPlatform();
    return platform === 'ios' || platform === 'android' || platform === 'web' ? platform : 'unknown';
  } catch {
    return 'unknown';
  }
}
