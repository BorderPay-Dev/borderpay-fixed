/**
 * BorderPay Africa - Settings Screen
 * Account settings, security, preferences, and more
 */

import React, { useState, useEffect, useCallback } from 'react';
import { friendlyError } from '../../utils/errors/friendlyError';
import { 
  ArrowLeft, 
  User, 
  Shield, 
  Accessibility, 
  Lock, 
  HelpCircle, 
  FileText, 
  LogOut,
  ChevronRight,
  Smartphone,
  Key,
  Trash2,
  MapPin,
  Fingerprint,
  Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { SecurityStatus, PINManager, TOTPManager, BiometricManager } from '../../utils/security/SecurityManager';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface SettingsScreenProps {
  userId: string;
  onBack: () => void;
  onLogout: () => void;
  onLock?: () => void;
  onNavigate: (screen: string) => void;
}

export function SettingsScreen({ userId, onBack, onLogout, onLock, onNavigate }: SettingsScreenProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [has2FA, setHas2FA] = useState(false);
  const [hasPIN, setHasPIN] = useState(false);
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const storedUser = authAPI.getStoredUser();
  const isBusinessAccount = storedUser?.account_type === 'business';
  const settingsSecurityCacheKey = `borderpay_settings_security_v1:${userId}`;
  const settingsSecurityRefreshTsKey = `borderpay_settings_security_refreshed_at:${userId}`;

  // Avoid mount-time prefetch fan-out; row-level pointer/hover prefetch below
  // keeps taps snappy without flooding route/chunk requests on entry.

  // Load security status from backend (persists across login/logout)
  useEffect(() => {
    // Fast paint: hydrate from local cache immediately.
    try {
      const raw = localStorage.getItem(settingsSecurityCacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (typeof cached?.hasPIN === 'boolean') setHasPIN(cached.hasPIN);
        if (typeof cached?.has2FA === 'boolean') setHas2FA(cached.has2FA);
      }
    } catch { /* noop */ }

    const loadStatus = async () => {
      try {
        const last = Number(localStorage.getItem(settingsSecurityRefreshTsKey) || '0');
        if (Number.isFinite(last) && Date.now() - last < 60_000) return;
      } catch { /* noop */ }
      try {
        // 2FA truth lives in `user_security` (not always denormalised onto
        // user_profiles). Read both in parallel and OR with TOTPManager so the
        // toggle never flickers ON-then-OFF for a user who actually has 2FA.
        const totpOn = TOTPManager.isEnabled(userId);
        const secRes = await backendAPI.auth.getSecurityStatus(userId);
        let hasPin = totpOn ? false : false;
        let has2fa = totpOn;
        if (secRes.success) {
          const s: any = secRes.data;
          hasPin = !!s?.pin_set || hasPin;
          has2fa = !!s?.two_factor_enabled || has2fa;
        }
        setHasPIN(hasPin);
        setHas2FA(has2fa);
        try { localStorage.setItem(settingsSecurityCacheKey, JSON.stringify({ hasPIN: hasPin, has2FA: has2fa, ts: Date.now() })); } catch { /* noop */ }
        try { localStorage.setItem(settingsSecurityRefreshTsKey, String(Date.now())); } catch { /* noop */ }
      } catch (e) {
        // Fallback to client-side SecurityManager if backend fails
        const secStatus = SecurityStatus.get(userId);
        setHasPIN(secStatus.hasPIN);
        setHas2FA(secStatus.has2FA);
        try { localStorage.setItem(settingsSecurityCacheKey, JSON.stringify({ hasPIN: secStatus.hasPIN, has2FA: secStatus.has2FA, ts: Date.now() })); } catch { /* noop */ }
        try { localStorage.setItem(settingsSecurityRefreshTsKey, String(Date.now())); } catch { /* noop */ }
      }
    };
    loadStatus();
  }, [settingsSecurityCacheKey, settingsSecurityRefreshTsKey, userId]);

  const settingsSections = [
    {
      title: t('settings.account'),
      items: [
        { icon: User, label: isBusinessAccount ? 'Business information' : t('settings.personalInfo'), screen: 'profile', color: 'text-blue-400' },
        // Plans & pricing removed: there are no plans/prices in-app (Wise model).
        // Activation ("Upgrade to Global Wallet") is surfaced on the dashboard
        // and the Send/Receive popup, and disappears once the user is activated.
        // Payment Methods option removed per product decision.
        // KYC documents and Proof of Address are deliberately not surfaced
        // from Settings: identity verification is owned end-to-end by the
        // hosted verification flow, and re-submission lives
        // inside that flow (Identity & KYC entry in the side drawer).
      ]
    },
    {
      title: t('settings.security'),
      items: [
        { icon: Lock, label: t('settings.changePin'), screen: 'change-pin', color: 'text-yellow-400' },
        { icon: Smartphone, label: t('settings.twoFactor'), screen: 'two-factor-setup', color: 'text-green-400' },
        { icon: Fingerprint, label: 'Biometric Login', screen: 'biometric-setup', color: 'text-[#C7FF00]' },
        { icon: Shield, label: t('settings.disable2fa'), action: 'disable-2fa', color: 'text-orange-400' },
        { icon: Key, label: t('settings.changePassword'), screen: 'change-password', color: 'text-orange-400' },
      ]
    },
    {
      title: t('settings.preferences'),
      items: [
        { icon: Accessibility, label: 'Accessibility', screen: 'preferences', color: 'text-purple-400' },
      ]
    },
    {
      title: 'Country availability',
      items: [
        { icon: MapPin, label: 'Restricted countries', screen: 'country-eligibility', color: 'text-red-400' },
      ]
    },
    {
      title: t('settings.support'),
      items: [
        { icon: HelpCircle, label: 'Help Center', screen: 'help-center', color: 'text-blue-400' },
        { icon: Mail, label: 'Email Support', action: 'email-support', color: 'text-green-400' },
      ]
    },
    {
      title: t('settings.legal'),
      items: [
        { icon: FileText, label: t('settings.termsOfService'), screen: 'terms-of-service', color: 'text-gray-400' },
        { icon: Shield, label: t('settings.privacyPolicy'), screen: 'privacy-policy', color: 'text-gray-400' },
      ]
    },
    {
      title: t('settings.accountManagement'),
      items: [
        { icon: Trash2, label: t('settings.suspendAccount'), action: 'suspend', color: 'text-red-400' },
        // "Lock app" sits beside Log out so a user wanting a quick biometric
        // return doesn't full-logout by habit. Only shown when onLock is wired.
        ...(onLock ? [{ icon: Lock, label: t('settings.lockApp') || 'Lock app', action: 'lock', color: 'text-gray-300' }] : []),
        { icon: LogOut, label: t('settings.logOut'), action: 'logout', color: 'text-red-500' },
      ]
    },
  ];

  const handleSuspendAccount = async () => {
    // Balance gate: a user can only self-suspend an EMPTY account. Any positive
    // balance (even $0.10) blocks self-suspension — they must withdraw first.
    // (Only BorderPay can suspend/ban an account that still holds funds.)
    setSuspending(true);
    let hasFunds = true; // fail-closed: if we can't confirm $0, don't suspend
    try {
      const r: any = await backendAPI.wallets.getWallets();
      const wallets: any[] = r?.data?.wallets ?? (Array.isArray(r?.data) ? r.data : []);
      hasFunds = wallets.some((w) => Number(w.balance || 0) >= 0.01);
    } catch {
      hasFunds = true;
    }
    if (hasFunds) {
      setSuspending(false);
      toast.error('Your balance must be $0 to suspend. Withdraw all your funds first, then try again.');
      return;
    }
    setSuspending(false);

    if (!confirm(
      'Suspend your account?\n\n' +
      'Your balance is $0. Suspending pauses access to your account and features. ' +
      'To reactivate, you’ll need to contact support. Do you want to continue?'
    )) {
      return;
    }

    setSuspending(true);
    try {
      const result = await backendAPI.customers.suspendUser(userId, 'User requested suspension');
      if (result.success) {
        toast.success(t('settings.accountSuspended'));
        setTimeout(() => onLogout(), 2000);
      } else {
        toast.error(friendlyError(result.error, t('settings.suspendFailed')));
      }
    } catch (error) {
      toast.error(t('settings.suspendFailed'));
    } finally {
      setSuspending(false);
    }
  };


  const handleDisable2FA = async () => {
    const password = prompt(t('settings.enterPasswordFor2fa'));
    if (!password) return;

    setSuspending(true);
    try {
      // Server-side disable: TOTPManager.disable now rounds-trips to
      // disable-2fa with the user's password. Local cache is updated only
      // on success so we don't lie about state if the server refuses.
      const r = await TOTPManager.disable(userId, password);
      if (r.success) {
        toast.success(t('settings.2faDisabled'));
        setHas2FA(false);
      } else {
        toast.error(friendlyError(r.error, t('settings.2faDisableFailed')));
      }
    } catch (error) {
      toast.error(t('settings.2faDisableFailed'));
    } finally {
      setSuspending(false);
    }
  };

  const handleItemClick = (item: any) => {
    // KYC gate bypassed for testing — all features accessible

    if (item.action === 'logout') {
      if (confirm(t('settings.confirmLogout'))) {
        onLogout();
      }
    } else if (item.action === 'lock') {
      onLock?.();
    } else if (item.action === 'suspend') {
      handleSuspendAccount();
    } else if (item.action === 'disable-2fa') {
      handleDisable2FA();
    } else if (item.action === 'email-support') {
      window.open('mailto:support@borderpayafrica.com', '_blank');
    } else if (item.screen) {
      onNavigate(item.screen);
    }
  };

  return (
    // AppShell owns the top chrome (avatar / plan badge / bell / menu).
    // Settings renders body-only. The inline section eyebrow replaces the
    // old sticky header.
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-5 pt-5 pb-10">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {t('settings.title')}
        </p>

        {/* Sections */}
        <div className="space-y-7">
          {settingsSections.map((section, index) => (
            <div key={index}>
              <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
                {section.title}
              </h2>
              <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
                {section.items.map((item, itemIndex) => {
                  const Icon = item.icon;
                  const isDanger = item.color === 'text-red-400' || item.color === 'text-red-500';
                  return (
                    <button
                      key={itemIndex}
                      onPointerDown={() => { if (item.screen) (window as any).__borderpay_prefetch?.(item.screen); }}
                      onMouseEnter={() => { if (item.screen) (window as any).__borderpay_prefetch?.(item.screen); }}
                      onClick={() => handleItemClick(item)}
                      disabled={suspending}
                      className={`w-full flex items-center gap-3 px-4 py-3 ${tc.hoverBg} transition-colors ${
                        itemIndex !== section.items.length - 1 ? `border-b ${tc.borderLight}` : ''
                      } ${suspending ? 'opacity-50' : ''}`}
                    >
                      <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0`}>
                        <Icon size={16} className={item.color} />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <span className={`text-sm font-medium ${isDanger ? item.color : tc.text}`}>
                          {item.label}
                        </span>
                      </div>
                      {!isDanger && <ChevronRight size={16} className={tc.textMuted} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* App Version */}
        <div className="text-center pt-8">
          <p className={`text-[10px] ${tc.textMuted}`}>{t('settings.version')}</p>
        </div>
      </div>
    </div>
  );
}
