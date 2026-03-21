/**
 * BorderPay Africa - Theme & Language Context
 * Provides global theme (dark/light/auto) and language (en/fr/es/pt/sw) to entire app.
 * Persists to localStorage under 'borderpay_preferences'.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getTranslation, Language } from './translations';

export type Theme = 'dark' | 'light' | 'auto';

interface ThemeLanguageState {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  language: Language;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
  t: (key: string) => string;
}

const PREFS_KEY = 'borderpay_preferences';

function loadPrefs(): { theme: Theme; language: Language } {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        theme: parsed.theme || 'dark',
        language: parsed.language || 'en',
      };
    }
  } catch (e) {
    console.warn('Failed to load preferences:', e);
  }
  return { theme: 'dark', language: 'en' };
}

function savePrefs(updates: Record<string, unknown>) {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    const existing = stored ? JSON.parse(stored) : {};
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...existing, ...updates }));
  } catch (e) {
    console.warn('Failed to save preferences:', e);
  }
}

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

const ThemeLanguageContext = createContext<ThemeLanguageState>({
  theme: 'dark',
  resolvedTheme: 'dark',
  language: 'en',
  setTheme: function noop() {},
  setLanguage: function noop() {},
  t: function identity(key: string) { return key; },
});

export function ThemeLanguageProvider({ children }: { children: React.ReactNode }) {
  const initial = loadPrefs();
  const [themeVal, setThemeVal] = useState<Theme>(initial.theme);
  const [langVal, setLangVal] = useState<Language>(initial.language);

  const resolvedTheme: 'dark' | 'light' =
    themeVal === 'auto' ? getSystemTheme() : themeVal;

  // Apply theme class to document
  useEffect(function applyThemeClass() {
    const root = document.documentElement;
    if (resolvedTheme === 'light') {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    } else {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
    }
  }, [resolvedTheme]);

  // Listen for system theme changes when in auto mode
  useEffect(function listenSystemTheme() {
    if (themeVal !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = function() {
      setThemeVal('auto');
    };
    mq.addEventListener('change', handler);
    return function cleanup() {
      mq.removeEventListener('change', handler);
    };
  }, [themeVal]);

  const setTheme = useCallback(function handleSetTheme(newTheme: Theme) {
    setThemeVal(newTheme);
    savePrefs({ theme: newTheme });
  }, []);

  const setLanguage = useCallback(function handleSetLanguage(newLang: Language) {
    setLangVal(newLang);
    savePrefs({ language: newLang });
  }, []);

  const translate = useCallback(function handleTranslate(key: string) {
    return getTranslation(langVal, key);
  }, [langVal]);

  const contextValue: ThemeLanguageState = {
    theme: themeVal,
    resolvedTheme: resolvedTheme,
    language: langVal,
    setTheme: setTheme,
    setLanguage: setLanguage,
    t: translate,
  };

  return (
    <ThemeLanguageContext.Provider value={contextValue}>
      {children}
    </ThemeLanguageContext.Provider>
  );
}

export function useThemeLanguage(): ThemeLanguageState {
  return useContext(ThemeLanguageContext);
}

/**
 * Utility: get theme-aware CSS classes.
 */
export function useThemeClasses() {
  const ctx = useThemeLanguage();
  const isLight = ctx.resolvedTheme === 'light';

  return {
    isLight: isLight,
    bg: isLight ? 'bg-white' : 'bg-[#0B0E11]',
    bgAlt: isLight ? 'bg-gray-50/70 backdrop-blur-sm' : 'bg-white/[0.03] backdrop-blur-sm',
    card: isLight ? 'bg-white/70 backdrop-blur-lg' : 'bg-white/[0.05] backdrop-blur-lg',
    cardBorder: isLight ? 'border-white/60' : 'border-white/[0.08]',
    cardSolid: isLight ? 'bg-white/70 backdrop-blur-lg border-white/60' : 'bg-white/[0.05] backdrop-blur-lg border-white/[0.08]',
    // Glass surface — for prominent cards, modals, and panels
    glass: isLight ? 'bg-white/60 backdrop-blur-xl border border-white/50' : 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.06]',
    // Glass input — for text fields and form controls
    glassInput: isLight
      ? 'bg-white/50 backdrop-blur-md border-gray-300/60 text-gray-900 focus:border-[#C7FF00] focus:bg-white/70'
      : 'bg-white/[0.04] backdrop-blur-md border-white/[0.08] text-white focus:border-[#C7FF00] focus:bg-white/[0.07]',
    // Glass modal — for bottom sheets and overlays
    glassModal: isLight
      ? 'bg-white/80 backdrop-blur-2xl border-t border-white/60'
      : 'bg-[#0B0E11]/80 backdrop-blur-2xl border-t border-white/[0.08]',
    // Glass button — secondary/ghost buttons
    glassButton: isLight
      ? 'bg-white/50 backdrop-blur-md border border-gray-200/60 hover:bg-white/70'
      : 'bg-white/[0.06] backdrop-blur-md border border-white/[0.08] hover:bg-white/[0.1]',
    text: isLight ? 'text-gray-900' : 'text-white',
    textSecondary: isLight ? 'text-gray-500' : 'text-gray-400',
    textMuted: isLight ? 'text-gray-400' : 'text-white/60',
    border: isLight ? 'border-gray-200' : 'border-white/10',
    borderLight: isLight ? 'border-gray-100' : 'border-white/5',
    inputBg: isLight ? 'bg-white/50 backdrop-blur-md border-gray-300/60 text-gray-900' : 'bg-white/[0.04] backdrop-blur-md border-white/[0.08] text-white',
    headerBg: isLight ? 'bg-white/60 backdrop-blur-xl' : 'bg-[#0B0E11]/60 backdrop-blur-xl',
    hoverBg: isLight ? 'hover:bg-white/60' : 'hover:bg-white/[0.06]',
    toggleOff: isLight ? 'bg-gray-300' : 'bg-white/20',
    accentBg: isLight ? 'bg-[#C7FF00]/15' : 'bg-[#C7FF00]/20',
  };
}