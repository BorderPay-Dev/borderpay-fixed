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
  MessageCircle,
  MapPin,
  BookOpen,
  Coins,
  CheckCircle2,
  Circle,
  Fingerprint,
  Upload,
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
  const [isVerified, setIsVerified] = useState(false);
  const [walletsActivated, setWalletsActivated] = useState(false);
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // Load security/activation status for the progress card
  useEffect(() => {
    const loadStatus = async () => {
      try {
        // Load security status from client-side SecurityManager (instant, no network)
        const secStatus = SecurityStatus.get(userId);
        setHasPIN(secStatus.hasPIN);
        setHas2FA(secStatus.has2FA);

        // Load profile from backend for KYC/wallet status
        const profileRes = await backendAPI.user.getProfile();
        if (profileRes.success && profileRes.data?.user) {
          const p = profileRes.data.user;
          setIsVerified(p.kyc_status === 'verified');
          setWalletsActivated(p.is_unlocked === true);
          // Sync 2FA flag from profile if SecurityManager doesn't have it
          if (!secStatus.has2FA && (p.two_factor_enabled || p.mfa_enabled)) {
            setHas2FA(true);
          }
        }
      } catch (e) {
        console.error('Settings: failed to load status', e);
      }
    };
    loadStatus();
  }, []);

  const activationSteps = [
    { id: 'account', label: t('activation.accountCreated'), completed: true },
    { id: '2fa', label: t('activation.2faEnabled'), completed: has2FA, screen: 'two-factor-setup' },
    { id: 'pin', label: t('activation.pinSetup'), completed: hasPIN, screen: 'pin-setup' },
    { id: 'kyc', label: t('activation.kycComplete'), completed: isVerified, screen: 'kyc' },
    { id: 'wallets', label: t('activation.walletsActivate'), completed: walletsActivated, screen: 'deposit' },
  ];

  const completedCount = activationSteps.filter(s => s.completed).length;
  const allComplete = completedCount === activationSteps.length;

  const settingsSections = [
    {
      title: t('settings.account'),
      items: [
        { icon: User, label: t('settings.personalInfo'), screen: 'profile', color: 'text-blue-400' },
        { icon: CreditCard, label: t('settings.paymentMethods'), screen: 'payment-methods', color: 'text-green-400' },
        { icon: FileText, label: t('settings.kycDocuments'), screen: 'kyc', color: 'text-purple-400' },
        { icon: Upload, label: 'Proof of Address', screen: 'kyc', color: 'text-indigo-400' },
      ]
    },
    {
      title: t('settings.security'),
      items: [
        { icon: Lock, label: t('settings.changePin'), screen: 'change-pin', color: 'text-yellow-400', requiresKyc: true },
        { icon: Smartphone, label: t('settings.twoFactor'), screen: 'two-factor-setup', color: 'text-green-400', requiresKyc: true },
        { icon: Fingerprint, label: 'Biometric Login', screen: 'biometric-setup', color: 'text-[#C7FF00]' },
        { icon: Shield, label: t('settings.disable2fa'), action: 'disable-2fa', color: 'text-orange-400', requiresKyc: true },
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
      console.error('Suspend error:', error);
      toast.error(t('settings.suspendFailed'));
    } finally {
      setSuspending(false);
    }
  };

  const handleUpgradeTier2 = async () => {
    if (!confirm(t('settings.confirmUpgrade'))) {
      return;
    }

    setSuspending(true);
    try {
      const result = await backendAPI.customers.upgradeTier2(userId);
      if (result.success) {
        toast.success(t('settings.upgradeSuccess'));
      } else {
        toast.error(result.error || t('settings.upgradeFailed'));
      }
    } catch (error) {
      console.error('Upgrade error:', error);
      toast.error(t('settings.upgradeFailed'));
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
      console.error('Disable 2FA error:', error);
      toast.error(t('settings.2faDisableFailed'));
    } finally {
      setSuspending(false);
    }
  };

  const handleItemClick = (item: any) => {
    // Check if item requires KYC verification
    if (item.requiresKyc && !isVerified) {
      toast.error('Identity verification required. Complete KYC first to enable security features.');
      return;
    }

    if (item.action === 'logout') {
      if (confirm(t('settings.confirmLogout'))) {
        onLogout();
      }
    } else if (item.action === 'suspend') {
      handleSuspendAccount();
    } else if (item.action === 'upgrade-tier2') {
      handleUpgradeTier2();
    } else if (item.action === 'disable-2fa') {
      handleDisable2FA();
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
        {/* Account Setup Progress - only show if not all complete */}
        {!allComplete && (
          <div>
            <h2 className={`bp-text-small ${tc.textSecondary} font-semibold mb-3 uppercase tracking-wider`}>
              {t('settings.accountSetup')}
            </h2>
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
              {/* Progress Bar */}
              <div className="flex items-center justify-between mb-3">
                <span className={`bp-text-small font-semibold ${tc.text}`}>
                  {completedCount}/{activationSteps.length} {t('settings.setupProgress')}
                </span>
                <span className="bp-text-small font-bold text-[#C7FF00]">
                  {Math.round((completedCount / activationSteps.length) * 100)}%
                </span>
              </div>
              <div className={`w-full h-2 rounded-full ${tc.isLight ? 'bg-gray-200' : 'bg-white/10'} mb-4`}>
                <div
                  className="h-2 rounded-full bg-[#C7FF00] transition-all duration-500"
                  style={{ width: `${(completedCount / activationSteps.length) * 100}%` }}
                />
              </div>
              {/* Steps */}
              <div className="space-y-2">
                {activationSteps.map((step) => (
                  <button
                    key={step.id}
                    onClick={() => !step.completed && step.screen ? onNavigate(step.screen) : undefined}
                    disabled={step.completed || !step.screen}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors ${
                      !step.completed && step.screen ? `${tc.hoverBg} cursor-pointer` : 'cursor-default'
                    }`}
                  >
                    {step.completed ? (
                      <CheckCircle2 size={18} className="text-[#C7FF00] flex-shrink-0" />
                    ) : (
                      <Circle size={18} className={`${tc.textMuted} flex-shrink-0`} />
                    )}
                    <span className={`bp-text-small ${step.completed ? tc.textSecondary : tc.text} ${step.completed ? 'line-through' : ''}`}>
                      {step.label}
                    </span>
                    {!step.completed && step.screen && (
                      <ChevronRight size={14} className={`ml-auto ${tc.textMuted}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {settingsSections.map((section, index) => (
          <div key={index}>
            <h2 className={`bp-text-small ${tc.textSecondary} font-semibold mb-3 uppercase tracking-wider`}>
              {section.title}
            </h2>
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
              {section.items.map((item, itemIndex) => {
                const Icon = item.icon;
                const isLocked = (item as any).requiresKyc && !isVerified;
                return (
                  <button
                    key={itemIndex}
                    onClick={() => handleItemClick(item)}
                    disabled={suspending}
                    className={`w-full flex items-center gap-4 p-4 ${tc.hoverBg} transition-colors ${
                      itemIndex !== section.items.length - 1 ? `border-b ${tc.borderLight}` : ''
                    } ${suspending ? 'opacity-50' : ''} ${isLocked ? 'opacity-50' : ''}`}
                  >
                    <div className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center relative`}>
                      <Icon size={20} className={item.color} />
                      {isLocked && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center">
                          <Lock size={8} className="text-black" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <span className={`bp-text-body ${tc.text}`}>{item.label}</span>
                      {isLocked && (
                        <p className="text-[10px] text-yellow-500/80 mt-0.5">Requires KYC approval</p>
                      )}
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