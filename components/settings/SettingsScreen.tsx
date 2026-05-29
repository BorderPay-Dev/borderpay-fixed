/**
 * BorderPay Africa - Settings Screen
 * Account settings, security, preferences, and more
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowLeft, 
  User, 
  Shield, 
  Bell, 
  Globe, 
  Lock, 
  CreditCard, 
  HelpCircle, 
  FileText, 
  LogOut,
  ChevronRight,
  Smartphone,
  Key,
  Trash2,
  MapPin,
  BookOpen,
  Coins,
  CheckCircle2,
  Circle,
  Fingerprint,
  Upload,
  Mail,
  Sparkles,
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
  onNavigate: (screen: string) => void;
}

export function SettingsScreen({ userId, onBack, onLogout, onNavigate }: SettingsScreenProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [has2FA, setHas2FA] = useState(false);
  const [hasPIN, setHasPIN] = useState(false);
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // Load security status from backend (persists across login/logout)
  useEffect(() => {
    const loadStatus = async () => {
      try {
        // Load profile from backend — now includes pin_set, two_factor_enabled, email_confirmed
        const profileRes = await backendAPI.user.getProfile();
        if (profileRes.success && profileRes.data?.user) {
          const p = profileRes.data.user;
          setHasPIN(p.pin_set || false);
          setHas2FA(p.two_factor_enabled || false);
        }
      } catch (e) {
        // Fallback to client-side SecurityManager if backend fails
        const secStatus = SecurityStatus.get(userId);
        setHasPIN(secStatus.hasPIN);
        setHas2FA(secStatus.has2FA);
      }
    };
    loadStatus();
  }, []);

  const settingsSections = [
    {
      title: t('settings.account'),
      items: [
        { icon: User, label: t('settings.personalInfo'), screen: 'profile', color: 'text-blue-400' },
        // Plans & pricing — wallet-debit upgrade flow entry point.
        { icon: Sparkles, label: 'Plans & pricing', screen: 'pricing', color: 'text-[#C7FF00]' },
        // Payment Methods option removed per product decision.
        // KYC documents and Proof of Address are deliberately not surfaced
        // from Settings: identity verification is owned end-to-end by our
        // verification partner via the hosted flow, and re-submission lives
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
        { icon: Bell, label: t('settings.notifications'), screen: 'preferences', color: 'text-purple-400' },
        { icon: Globe, label: t('settings.languageRegion'), screen: 'preferences', color: 'text-blue-400' },
      ]
    },
    {
      title: t('cards.title'),
      items: [
        { icon: MapPin, label: t('cards.geoRestrictions'), screen: 'card-restrictions', color: 'text-red-400' },
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
        { icon: LogOut, label: t('settings.logOut'), action: 'logout', color: 'text-red-500' },
      ]
    }
  ];

  const handleSuspendAccount = async () => {
    if (!confirm(t('settings.confirmSuspend'))) {
      return;
    }

    setSuspending(true);
    try {
      const result = await backendAPI.customers.suspendUser(userId, 'User requested suspension');
      if (result.success) {
        toast.success(t('settings.accountSuspended'));
        setTimeout(() => onLogout(), 2000);
      } else {
        toast.error(result.error || t('settings.suspendFailed'));
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
        toast.error(r.error || t('settings.2faDisableFailed'));
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

        {/* Plans & billing entry — pulled out of the list as a Revolut-style
            tile so it's the first thing the user sees on Settings. */}
        <button
          onClick={() => onNavigate('pricing')}
          className={`w-full mb-6 rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-center gap-3 ${tc.hoverBg} text-left transition-colors`}
        >
          <div className="w-10 h-10 rounded-full bg-[#C7FF00] flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-black" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>Plans & billing</p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5`}>
              View tiers, upgrade from your USD balance, see invoices
            </p>
          </div>
          <ChevronRight size={18} className={tc.textMuted} />
        </button>

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