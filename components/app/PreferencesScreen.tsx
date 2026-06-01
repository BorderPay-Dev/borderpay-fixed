/**
 * BorderPay Africa - User Preferences Screen
 * Theme + Language + Privacy settings
 * Wired to ThemeLanguageContext for live theme/language switching
 */

import React, { useState } from 'react';
import {
  ChevronLeft,
  Palette,
  Eye,
  Fingerprint,
  Lock,
  Volume2,
  Vibrate,
} from 'lucide-react';
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { usePreferences, hapticFeedback, soundFeedback } from '../../utils/hooks/usePreferences';
import { BiometricManager } from '../../utils/security/SecurityManager';

interface PreferencesScreenProps {
  onBack: () => void;
}

export function PreferencesScreen({ onBack }: PreferencesScreenProps) {
  const { theme, setTheme, t } = useThemeLanguage();
  const tc = useThemeClasses();
  const { prefs, updatePrefs } = usePreferences();
  const [biometricLoading, setBiometricLoading] = useState(false);

  const handleToggle = (key: keyof typeof prefs, value: boolean) => {
    updatePrefs({ [key]: value });
    hapticFeedback();
    soundFeedback();
    toast.success(t('prefs.updated'));
  };

  const handleBiometricToggle = async () => {
    setBiometricLoading(true);
    try {
      const userId = localStorage.getItem('borderpay_biometric_user_id') || '';
      if (!userId) {
        toast.error('Please sign in first to enable biometric lock.');
        return;
      }

      if (prefs.biometric_enabled) {
        // Disable — delete the server credential first; only reflect "disabled"
        // if it actually succeeded, otherwise the orphan row blocks re-enroll.
        const r = await BiometricManager.disable(userId);
        if (r.success) {
          updatePrefs({ biometric_enabled: false });
          hapticFeedback();
          toast.success('Biometric lock disabled');
        } else {
          toast.error(r.error || 'Could not disable biometric. Please try again.');
        }
      } else {
        // Enable — enroll WebAuthn
        const supported = await BiometricManager.isSupported();
        if (!supported) {
          toast.error('Biometric authentication is not supported on this device.');
          return;
        }
        const user = localStorage.getItem('borderpay_user');
        const userName = user ? JSON.parse(user).full_name || 'User' : 'User';
        const result = await BiometricManager.enroll(userId, userName);
        if (result.success) {
          updatePrefs({ biometric_enabled: true });
          hapticFeedback();
          toast.success('Biometric lock enabled');
        } else {
          toast.error(result.error || 'Biometric enrollment failed');
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Biometric setup failed');
    } finally {
      setBiometricLoading(false);
    }
  };

  const handleThemeChange = (newTheme: 'dark' | 'light' | 'auto') => {
    setTheme(newTheme);
    hapticFeedback();
    toast.success(t('prefs.updated'));
  };

  const resetToDefaults = () => {
    if (!confirm('Reset all preferences to defaults?')) return;
    setTheme('dark');
    updatePrefs({
      hide_balance: false,
      biometric_enabled: false,
      pin_enabled: true,
      sound_enabled: true,
      haptic_enabled: true,
      currency_display: 'symbol',
    });
    toast.success(t('prefs.updated'));
  };

  const themes = [
    { value: 'dark' as const, labelKey: 'prefs.dark', icon: '🌙' },
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
    <div className={`min-h-screen ${tc.bg}`}>
      {/* AppShell owns top chrome; preferences renders body-only. */}
      <div className="max-w-2xl mx-auto px-5 pt-5">
        <div className="mb-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className={`-ml-2 p-2 rounded-full ${tc.hoverBg} transition-colors`}
          >
            <ChevronLeft className={`w-5 h-5 ${tc.text}`} />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-6">
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
              <Toggle on={prefs.hide_balance} onToggle={() => handleToggle('hide_balance', !prefs.hide_balance)} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Fingerprint className={`w-4 h-4 ${tc.textMuted}`} />
                <div>
                  <div className={`${tc.text} text-sm`}>{t('prefs.biometricLock')}</div>
                  <div className={`${tc.textMuted} text-xs`}>{t('prefs.biometricDesc')}</div>
                </div>
              </div>
              <Toggle on={prefs.biometric_enabled} onToggle={handleBiometricToggle} />
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
              <Toggle on={prefs.sound_enabled} onToggle={() => handleToggle('sound_enabled', !prefs.sound_enabled)} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Vibrate className={`w-4 h-4 ${tc.textMuted}`} />
                <div>
                  <div className={`${tc.text} text-sm`}>{t('prefs.hapticFeedback')}</div>
                  <div className={`${tc.textMuted} text-xs`}>{t('prefs.hapticDesc')}</div>
                </div>
              </div>
              <Toggle on={prefs.haptic_enabled} onToggle={() => handleToggle('haptic_enabled', !prefs.haptic_enabled)} />
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
