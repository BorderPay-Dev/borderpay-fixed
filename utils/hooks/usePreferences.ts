/**
 * Shared preferences hook — reads borderpay_preferences from localStorage
 * and provides live state + updater for any component.
 */

import { useState, useEffect, useCallback } from 'react';

const PREFS_KEY = 'borderpay_preferences';

export interface AppPreferences {
  hide_balance: boolean;
  biometric_enabled: boolean;
  pin_enabled: boolean;
  sound_enabled: boolean;
  haptic_enabled: boolean;
  currency_display: 'symbol' | 'code';
}

const DEFAULTS: AppPreferences = {
  hide_balance: false,
  biometric_enabled: false,
  pin_enabled: true,
  sound_enabled: true,
  haptic_enabled: true,
  currency_display: 'symbol',
};

function readPrefs(): AppPreferences {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

/** Custom event name used to sync preferences across components */
const PREFS_EVENT = 'borderpay:prefs-changed';

export function usePreferences() {
  const [prefs, setPrefs] = useState<AppPreferences>(readPrefs);

  // Listen for cross-component preference changes
  useEffect(() => {
    const handler = () => setPrefs(readPrefs());
    window.addEventListener(PREFS_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(PREFS_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const updatePrefs = useCallback((updates: Partial<AppPreferences>) => {
    const current = readPrefs();
    const updated = { ...current, ...updates };
    localStorage.setItem(PREFS_KEY, JSON.stringify(updated));
    setPrefs(updated);
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
  }, []);

  return { prefs, updatePrefs };
}

/** Play a short haptic pulse if haptic_enabled */
export function hapticFeedback() {
  try {
    const prefs = readPrefs();
    if (prefs.haptic_enabled && navigator.vibrate) {
      navigator.vibrate(10);
    }
  } catch { /* ignore */ }
}

/** Play a click sound if sound_enabled */
export function soundFeedback() {
  try {
    const prefs = readPrefs();
    if (prefs.sound_enabled) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 1200;
      gain.gain.value = 0.08;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.stop(ctx.currentTime + 0.08);
    }
  } catch { /* ignore */ }
}
