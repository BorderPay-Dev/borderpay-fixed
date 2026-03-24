/**
 * BorderPay Africa - Inactivity Auto-Logout Timer
 * 
 * Tracks user activity (clicks, taps, key presses, scrolls, mouse moves).
 * After 30 minutes of inactivity, automatically logs the user out.
 * Shows a warning modal at 25 minutes (5 min before logout).
 * 
 * Usage:
 *   const { showWarning, remainingSeconds, dismissWarning } = useInactivityTimer({
 *     onLogout: handleLogout,
 *     timeoutMs: 30 * 60 * 1000,
 *     warningMs: 5 * 60 * 1000,
 *   });
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { sessionAPI } from '../api/sessionAPI';

interface InactivityTimerOptions {
  /** Called when timeout expires — should sign user out */
  onLogout: () => void;
  /** Total inactivity timeout in ms (default: 30 min) */
  timeoutMs?: number;
  /** How long before timeout to show warning in ms (default: 5 min) */
  warningMs?: number;
  /** Whether the timer is active (set false when user is not authenticated) */
  enabled?: boolean;
}

interface InactivityTimerState {
  /** True when the warning modal should be shown */
  showWarning: boolean;
  /** Seconds remaining until auto-logout (only valid when showWarning is true) */
  remainingSeconds: number;
  /** Dismiss warning and reset the timer (user chose "Stay signed in") */
  dismissWarning: () => void;
}

const THIRTY_MINUTES = 30 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const ACTIVITY_THROTTLE = 30_000; // Report activity to backend at most every 30s

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
  'pointerdown',
];

export function useInactivityTimer({
  onLogout,
  timeoutMs = THIRTY_MINUTES,
  warningMs = FIVE_MINUTES,
  enabled = true,
}: InactivityTimerOptions): InactivityTimerState {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  // Refs to avoid stale closures
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastReportedRef = useRef(0);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  /** Clear all running timers */
  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  /** Schedule warning + logout timers from "now" */
  const resetTimers = useCallback(() => {
    clearAllTimers();
    lastActivityRef.current = Date.now();
    setShowWarning(false);

    // If warningMs is 0, skip the warning phase — just schedule a hard logout
    if (warningMs <= 0) {
      logoutTimerRef.current = setTimeout(() => {
        clearAllTimers();
        onLogoutRef.current();
      }, timeoutMs);
      return;
    }

    // Schedule warning
    const warningDelay = timeoutMs - warningMs;
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setRemainingSeconds(Math.ceil(warningMs / 1000));

      // Start countdown
      countdownRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            // Time's up — logout
            clearAllTimers();
            onLogoutRef.current();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, warningDelay);

    // Hard logout timer (belt-and-suspenders)
    logoutTimerRef.current = setTimeout(() => {
      clearAllTimers();
      setShowWarning(false);
      onLogoutRef.current();
    }, timeoutMs);
  }, [timeoutMs, warningMs, clearAllTimers]);

  /** Record activity: reset timers + throttle backend ping */
  const handleActivity = useCallback(() => {
    if (!enabled) return;

    lastActivityRef.current = Date.now();

    // If warning is showing, user is active → dismiss it and reset
    setShowWarning((wasWarning) => {
      if (wasWarning) {
        resetTimers();
      }
      return false;
    });

    // Reset timers only if NOT in warning state (handled above)
    // To avoid resetting on every pixel of mousemove, throttle the timer reset
    // But we always want to postpone the hard logout
    resetTimers();

    // Throttled backend activity report
    const now = Date.now();
    if (now - lastReportedRef.current > ACTIVITY_THROTTLE) {
      lastReportedRef.current = now;
      sessionAPI.updateActivity().catch(() => {
        // Silent — non-critical
      });
    }
  }, [enabled, resetTimers]);

  /** User clicked "Stay signed in" */
  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    resetTimers();

    // Ping backend to extend server-side session
    sessionAPI.updateActivity().catch(() => {});
  }, [resetTimers]);

  // Attach / detach event listeners
  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      setShowWarning(false);
      return;
    }

    // Initial timer start
    resetTimers();

    // Throttle DOM event handler to avoid excessive resetTimers calls
    let rafId: number | null = null;
    const throttledHandler = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        handleActivity();
        rafId = null;
      });
    };

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, throttledHandler, { passive: true })
    );

    // Also store last activity in localStorage so other tabs can see
    const syncKey = 'borderpay_last_activity';
    const storageHandler = (e: StorageEvent) => {
      if (e.key === syncKey) {
        // Another tab was active → reset our timers
        resetTimers();
      }
    };
    window.addEventListener('storage', storageHandler);

    // Periodically write last activity to localStorage for cross-tab sync
    const crossTabInterval = setInterval(() => {
      localStorage.setItem(syncKey, String(lastActivityRef.current));
    }, 10_000);

    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, throttledHandler)
      );
      window.removeEventListener('storage', storageHandler);
      clearInterval(crossTabInterval);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [enabled, resetTimers, handleActivity, clearAllTimers]);

  return { showWarning, remainingSeconds, dismissWarning };
}