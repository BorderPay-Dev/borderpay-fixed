/**
 * BorderPay Africa - User Preferences Screen
 * Theme + Language + Privacy settings
 * Wired to ThemeLanguageContext for live theme/language switching
 */

import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, 
  Palette, 
  Globe, 
  Eye, 
  Fingerprint, 
  Lock, 
  Volume2, 
  Vibrate,
  Check
} from 'lucide-react';
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { LANGUAGE_LABELS, Language } from '../../utils/i18n/translations';

interface PreferencesScreenProps {
  onBack: () => void;
}

const PREFS_STORAGE_KEY = 'borderpay_preferences';

interface LocalPrefs {
  hide_balance: boolean;
  biometric_enabled: boolean;
  pin_enabled: boolean;
  sound_enabled: boolean;
  haptic_enabled: boolean;
  currency_display: 'symbol' | 'code';
}

const DEFAULT_LOCAL: LocalPrefs = {
  hide_balance: false,
  biometric_enabled: false,
  pin_enabled: true,
  sound_enabled: true,
  haptic_enabled: true,
  currency_display: 'symbol',
};

export function PreferencesScreen({ onBack }: PreferencesScreenProps) {
  const { theme, language, setTheme, setLanguage, t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [local, setLocal] = useState<LocalPrefs>(DEFAULT_LOCAL);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PREFS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setLocal(prev => ({ ...prev, ...parsed }));
      }
    } catch (_e) { /* ignore */ }
  }, []);

  const updateLocal = (updates: Partial<LocalPrefs>) => {
    const updated = { ...local, ...updates };
    setLocal(updated);
    try {
      const stored = localStorage.getItem(PREFS_STORAGE_KEY);
      const existing = stored ? JSON.parse(stored) : {};
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...existing, ...updates }));
    } catch (_e) { /* ignore */ }
    toast.success(t('prefs.updated'));
  };

  const handleThemeChange = (newTheme: 'dark' | 'light' | 'auto') => {
    setTheme(newTheme);
    toast.success(t('prefs.updated'));
  };

  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    toast.success(t('prefs.updated'));
  };

  const resetToDefaults = () => {
    if (!confirm('Reset all preferences to defaults?')) return;
    setTheme('dark');
    setLanguage('en');
    setLocal(DEFAULT_LOCAL);
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ theme: 'dark', language: 'en', ...DEFAULT_LOCAL }));
    toast.success(t('prefs.updated'));
  };

  const themes = [
    { value: 'dark' as const, labelKey: 'prefs.dark', icon: '🌙' },
  ];

  const languages: { value: Language; flag: string }[] = [
    { value: 'en', flag: '🇬🇧' },
    { value: 'fr', flag: '🇫🇷' },
    { value: 'pt', flag: '🇵🇹' },
  ];

  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-[#C7FF00]' : tc.toggleOff}`}
    >
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
        tc.isLight ? 'bg-white shadow' : 'bg-white'
      } ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );

  return (
    <div className={`min-h-screen pb-safe ${tc.bg}`}>
      {/* Header */}
      <div className={`${tc.bgAlt} border-b ${tc.border} px-4 py-4 pt-safe sticky top-0 z-10`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}>
            <ChevronLeft className={`w-6 h-6 ${tc.text}`} />
          </button>
          <div>
            <h1 className={`${tc.text} text-xl font-bold`}>{t('prefs.title')}</h1>
            <p className={`${tc.textMuted} text-xs`}>{t('prefs.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Appearance */}
        <div className={`${tc.cardSolid} border rounded-2xl p-4`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
              <Palette className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className={`${tc.text} font-semibold text-sm`}>{t('prefs.appearance')}</h2>
              <p className={`${tc.textMuted} text-xs`}>{t('prefs.themeSettings')}</p>
            </div>
          </div>
          <div>
            <label className={`${tc.textSecondary} text-xs mb-2 block`}>{t('prefs.theme')}</label>
            <div className="grid grid-cols-3 gap-2">
              {themes.map((th) => (
                <button
                  key={th.value}
                  onClick={() => handleThemeChange(th.value)}
                  className={`p-3 rounded-xl border transition-all ${
                    theme === th.value
                      ? 'bg-[#C7FF00]/20 border-[#C7FF00]'
                      : `${tc.card} ${tc.cardBorder} ${tc.hoverBg}`
                  }`}
                >
                  <div className="text-2xl mb-1">{th.icon}</div>
                  <div className={`text-xs font-medium ${
                    theme === th.value ? 'text-[#C7FF00]' : tc.textMuted
                  }`}>
                    {t(th.labelKey)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Language & Region */}
        <div className={`${tc.cardSolid} border rounded-2xl p-4`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
              <Globe className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className={`${tc.text} font-semibold text-sm`}>{t('prefs.languageRegion')}</h2>
              <p className={`${tc.textMuted} text-xs`}>{t('prefs.localization')}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className={`${tc.textSecondary} text-xs mb-2 block`}>{t('prefs.language')}</label>
              <div className="space-y-2">
                {languages.map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => handleLanguageChange(lang.value)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                      language === lang.value
                        ? 'bg-[#C7FF00]/20 border-[#C7FF00]'
                        : `${tc.card} ${tc.cardBorder} ${tc.hoverBg}`
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{lang.flag}</span>
                      <span className={`text-sm font-medium ${
                        language === lang.value ? 'text-[#C7FF00]' : tc.text
                      }`}>
                        {LANGUAGE_LABELS[lang.value]}
                      </span>
                    </div>
                    {language === lang.value && (
                      <Check className="w-4 h-4 text-[#C7FF00]" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`${tc.textSecondary} text-xs mb-2 block`}>{t('prefs.currencyDisplay')}</label>
              <div className="grid grid-cols-2 gap-2">
                {(['symbol', 'code'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updateLocal({ currency_display: mode })}
                    className={`p-3 rounded-xl border transition-all ${
                      local.currency_display === mode
                        ? 'bg-[#C7FF00]/20 border-[#C7FF00]'
                        : `${tc.card} ${tc.cardBorder} ${tc.hoverBg}`
                    }`}
                  >
                    <div className="text-lg mb-1">{mode === 'symbol' ? '$' : 'USD'}</div>
                    <div className={`text-xs font-medium ${
                      local.currency_display === mode ? 'text-[#C7FF00]' : tc.textMuted
                    }`}>
                      {t(`prefs.${mode}`)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Privacy & Security */}
        <div className={`${tc.cardSolid} border rounded-2xl p-4`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
              <Lock className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h2 className={`${tc.text} font-semibold text-sm`}>{t('prefs.privacySecurity')}</h2>
              <p className={`${tc.textMuted} text-xs`}>{t('prefs.appSecurity')}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Eye className={`w-4 h-4 ${tc.textMuted}`} />
                <div>
                  <div className={`${tc.text} text-sm`}>{t('prefs.hideBalance')}</div>
                  <div className={`${tc.textMuted} text-xs`}>{t('prefs.hideBalanceDesc')}</div>
                </div>
              </div>
              <Toggle on={local.hide_balance} onToggle={() => updateLocal({ hide_balance: !local.hide_balance })} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Fingerprint className={`w-4 h-4 ${tc.textMuted}`} />
                <div>
                  <div className={`${tc.text} text-sm`}>{t('prefs.biometricLock')}</div>
                  <div className={`${tc.textMuted} text-xs`}>{t('prefs.biometricDesc')}</div>
                </div>
              </div>
              <Toggle on={local.biometric_enabled} onToggle={() => updateLocal({ biometric_enabled: !local.biometric_enabled })} />
            </div>
          </div>
        </div>

        {/* Accessibility */}
        <div className={`${tc.cardSolid} border rounded-2xl p-4`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
              <Volume2 className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h2 className={`${tc.text} font-semibold text-sm`}>{t('prefs.accessibility')}</h2>
              <p className={`${tc.textMuted} text-xs`}>{t('prefs.soundHaptics')}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Volume2 className={`w-4 h-4 ${tc.textMuted}`} />
                <div>
                  <div className={`${tc.text} text-sm`}>{t('prefs.soundEffects')}</div>
                  <div className={`${tc.textMuted} text-xs`}>{t('prefs.soundDesc')}</div>
                </div>
              </div>
              <Toggle on={local.sound_enabled} onToggle={() => updateLocal({ sound_enabled: !local.sound_enabled })} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Vibrate className={`w-4 h-4 ${tc.textMuted}`} />
                <div>
                  <div className={`${tc.text} text-sm`}>{t('prefs.hapticFeedback')}</div>
                  <div className={`${tc.textMuted} text-xs`}>{t('prefs.hapticDesc')}</div>
                </div>
              </div>
              <Toggle on={local.haptic_enabled} onToggle={() => updateLocal({ haptic_enabled: !local.haptic_enabled })} />
            </div>
          </div>
        </div>

        {/* Reset */}
        <button
          onClick={resetToDefaults}
          className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-500 font-medium hover:bg-red-500/20 transition-colors"
        >
          {t('prefs.resetDefaults')}
        </button>
      </div>
    </div>
  );
}