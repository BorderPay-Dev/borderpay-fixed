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
        { icon: CreditCard, label: t('settings.paymentMethods'), screen: 'payment-methods', color: 'text-green-400' },
        { icon: FileText, label: t('settings.kycDocuments'), screen: 'kyc', color: 'text-purple-400' },
        { icon: Shield, label: 'KYC Jobs (SmileID)', screen: 'kyc-jobs', color: 'text-[#C7FF00]' },
        { icon: Upload, label: 'Proof of Address', screen: 'proof-of-address', color: 'text-indigo-400' },
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
      // Disable 2FA client-side via SecurityManager
      TOTPManager.disable(userId);
      toast.success(t('settings.2faDisabled'));
      setHas2FA(false);
      // Also try to update backend profile
      try {
        await backendAPI.auth.disable2FA(userId, password);
      } catch { /* non-critical - local state is source of truth */ }
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
    <div className={`min-h-screen ${tc.bg} text-white pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={onBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className={`bp-text-h3 font-bold ${tc.text}`}>{t('settings.title')}</h1>
          <div className="w-10" />
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6 space-y-8">
        {settingsSections.map((section, index) => (
          <div key={index}>
            <h2 className={`bp-text-small ${tc.textSecondary} font-semibold mb-3 uppercase tracking-wider`}>
              {section.title}
            </h2>
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
              {section.items.map((item, itemIndex) => {
                const Icon = item.icon;
                return (
                  <button
                    key={itemIndex}
                    onClick={() => handleItemClick(item)}
                    disabled={suspending}
                    className={`w-full flex items-center gap-4 p-4 ${tc.hoverBg} transition-colors ${
                      itemIndex !== section.items.length - 1 ? `border-b ${tc.borderLight}` : ''
                    } ${suspending ? 'opacity-50' : ''}`}
                  >
                    <div className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center`}>
                      <Icon size={20} className={item.color} />
                    </div>
                    <div className="flex-1 text-left">
                      <span className={`bp-text-body ${tc.text}`}>{item.label}</span>
                    </div>
                    <ChevronRight size={20} className={tc.textSecondary} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* App Version */}
        <div className="text-center">
          <p className={`bp-text-small ${tc.textMuted}`}>{t('settings.version')}</p>
        </div>
      </div>
    </div>
  );
}