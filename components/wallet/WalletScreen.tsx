/**
 * BorderPay Africa - Wallet Screen
 * Shows wallet activation prompt or wallet list
 * i18n + theme-aware, uses authAPI.getToken()
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  Wallet,
  DollarSign,
  Globe,
  Zap,
  CreditCard,
  Sparkles,
  ArrowRight,
  Loader2,
  Send,
  ArrowDownToLine,
  RefreshCw,
  Eye,
  ChevronRight,
  Coins,
} from 'lucide-react';
import { authAPI } from '../../utils/supabase/client';
import { projectId } from '../../utils/supabase/info';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';
import { ErrorState } from '../common/ErrorState';
import { ENV_CONFIG, isFullEnrollment } from '../../utils/config/environment';

interface WalletScreenProps {
  userId: string;
  onBack: () => void;
  isVerified: boolean;
  walletsActivated: boolean;
  onWalletsActivated?: () => void;
  onNavigate?: (screen: string) => void;
}

export function WalletScreen({
  userId,
  onBack,
  isVerified,
  walletsActivated,
  onWalletsActivated,
  onNavigate,
}: WalletScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [loading, setLoading] = useState(false);
  const [wallets, setWallets] = useState<any[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<any | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Sandbox: treat wallets as always activated
  const effectiveWalletsActivated = walletsActivated;
  // Sandbox: treat user as verified for UI display
  const effectiveIsVerified = isVerified;

  useEffect(() => {
    if (effectiveWalletsActivated) {
      loadWallets();
    }
  }, [effectiveWalletsActivated]);

  const loadWallets = async () => {
    setLoadError(false);
    try {
      const result = await backendAPI.wallets.getWallets();
      if (result.success && result.data) {
        const walletsData = result.data.wallets || [];
        setWallets(Array.isArray(walletsData) ? walletsData : []);
      } else {
        console.error('Error loading wallets:', result.error);
        setLoadError(true);
      }
    } catch (error) {
      console.error('Error loading wallets:', error);
      setLoadError(true);
    }
  };

  const handleActivateWallets = async () => {
    // Sandbox: instant activation bypass
    if (false) {
      toast.success('Wallets activated (Beta Mode)!');
      await loadWallets();
      if (onWalletsActivated) onWalletsActivated();
      return;
    }

    setLoading(true);

    try {
      const token = authAPI.getToken();

      if (!token) {
        toast.error('Session expired. Please log in again.');
        setLoading(false);
        return;
      }

      const result = await backendAPI.wallets.activateWallets();

      if (!result.success) {
        throw new Error(result.error || 'Failed to activate wallets');
      }

      toast.success('Wallets activated successfully!');
      await loadWallets();

      if (onWalletsActivated) {
        onWalletsActivated();
      }
    } catch (error: any) {
      console.error('Wallet activation error:', error);
      toast.error(error.message || 'Failed to activate wallets');
    } finally {
      setLoading(false);
    }
  };

  // KYC Tier 0 gate: user is NOT verified (and not in sandbox)
  if (!effectiveIsVerified) {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        <div className={`p-4 border-b ${tc.border}`}>
          <button
            onClick={onBack}
            className={`p-2 ${tc.hoverBg} rounded-xl transition-colors`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center justify-center min-h-[80vh] px-4">
          <div className="max-w-md text-center">
            <div className="w-20 h-20 bg-[#C7FF00]/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <Wallet className="w-10 h-10 text-[#C7FF00]" />
            </div>
            
            <h2 className="text-2xl font-bold mb-3">Identity Verification Required</h2>
            <p className={`${tc.textSecondary} mb-3`}>
              Complete identity verification to continue
            </p>
            <p className={`text-xs ${tc.textMuted} mb-8 max-w-xs mx-auto`}>
              Wallet creation is only available after Full Enrollment (Tier 2) KYC verification.
            </p>

            <Button
              onClick={() => onNavigate?.('kyc')}
              className="w-full bg-[#C7FF00] text-black hover:bg-[#B8F000] h-12 font-semibold mb-3"
            >
              Verify Identity
            </Button>

            <Button
              variant="outline"
              onClick={onBack}
              className="w-full h-12"
            >
              {t('wallet.goBackDashboard')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Verified but wallets not activated — show activation prompt (LIVE only)
  if (!effectiveWalletsActivated) {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        <div className={`p-4 border-b ${tc.border}`}>
          <button
            onClick={onBack}
            className={`p-2 ${tc.hoverBg} rounded-xl transition-colors`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Hero Section */}
          <div className="text-center mb-8">
            <div className="w-24 h-24 bg-gradient-to-br from-[#C7FF00] to-[#00ff9d] rounded-3xl flex items-center justify-center mx-auto mb-6 relative">
              <Wallet className="w-12 h-12 text-black" />
              <div className="absolute -top-2 -right-2 w-8 h-8 bg-[#C7FF00] rounded-full flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
            </div>

            <h1 className="text-3xl font-bold mb-3">
              {t('wallet.activateMultiWallet')}
            </h1>
            <p className={`${tc.textSecondary} text-base`}>
              {t('wallet.activationFee')} <span className="text-[#C7FF00] font-semibold">$10</span>
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 gap-4 mb-8">
            <FeatureCard
              icon={<DollarSign className="w-6 h-6" />}
              title={t('wallet.currencyWallets')}
              description={t('wallet.currencyWalletsDesc')}
              tc={tc}
            />
            <FeatureCard
              icon={<CreditCard className="w-6 h-6" />}
              title={t('wallet.usBankAccount')}
              description={t('wallet.usBankAccountDesc')}
              tc={tc}
            />
            <FeatureCard
              icon={<Globe className="w-6 h-6" />}
              title={t('wallet.globalTransfers')}
              description={t('wallet.globalTransfersDesc')}
              tc={tc}
            />
            <FeatureCard
              icon={<Zap className="w-6 h-6" />}
              title={t('wallet.instantConversions')}
              description={t('wallet.instantConversionsDesc')}
              tc={tc}
            />
          </div>

          {/* Activation Button */}
          <Button
            onClick={handleActivateWallets}
            disabled={loading}
            className="w-full bg-[#C7FF00] text-black hover:bg-[#B8F000] h-14 text-base font-semibold rounded-xl"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('wallet.activating')}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {t('wallet.activateFor')}
                <ArrowRight className="w-5 h-5" />
              </span>
            )}
          </Button>

          <p className={`text-xs ${tc.textSecondary} text-center mt-4`}>
            {t('wallet.termsAgree')}
          </p>
        </div>
      </div>
    );
  }

  // Wallets activated - show wallet list
  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-24`}>
      <div className={`p-4 border-b ${tc.border} flex items-center gap-4`}>
        <button
          onClick={onBack}
          className={`p-2 ${tc.hoverBg} rounded-xl transition-colors`}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">{t('wallet.title')}</h1>
      </div>

      <div className="px-4 py-6">
        {loadError ? (
          <ErrorState
            variant="server"
            message="Could not load your wallets. Please try again."
            onRetry={loadWallets}
            compact
          />
        ) : wallets.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Wallet className={`w-12 h-12 ${tc.textMuted} mx-auto mb-4`} />
            {(
              <p className={tc.textSecondary}>{t('wallet.noWallets')}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {wallets.map((wallet) => (
              <WalletCard
                key={wallet.id}
                wallet={wallet}
                tc={tc}
                t={t}
                isSelected={selectedWallet?.id === wallet.id}
                onSelect={() => setSelectedWallet(selectedWallet?.id === wallet.id ? null : wallet)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}

        {/* Stablecoin Deposit CTA */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate?.('stablecoin-deposit')}
          className="w-full mt-6 bg-gradient-to-r from-[#9945FF]/15 to-[#14F195]/15 border border-[#9945FF]/30 rounded-2xl p-4 hover:border-[#14F195]/50 transition-all"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9945FF]/20 to-[#14F195]/20 flex items-center justify-center flex-shrink-0">
              <Coins className="w-6 h-6 text-[#14F195]" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-sm">{t('stablecoin.title')}</p>
              <p className={`text-xs ${tc.textSecondary}`}>{t('stablecoin.subtitle')}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-[#14F195]" />
          </div>
        </motion.button>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description, tc }: { icon: React.ReactNode; title: string; description: string; tc: any }) {
  return (
    <div
      className={`${tc.cardSolid} border rounded-xl p-4 flex gap-4`}
    >
      <div className="w-12 h-12 bg-[#C7FF00]/10 rounded-xl flex items-center justify-center flex-shrink-0 text-[#C7FF00]">
        {icon}
      </div>
      <div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className={`text-sm ${tc.textSecondary}`}>{description}</p>
      </div>
    </div>
  );
}

function WalletCard({ wallet, tc, t, isSelected, onSelect, onNavigate }: {
  wallet: any; tc: any; t: (key: string) => string;
  isSelected: boolean; onSelect: () => void; onNavigate?: (screen: string) => void;
}) {
  const currencyConfig: Record<string, { symbol: string; color: string; flag: string }> = {
    USD: { symbol: '$', color: '#10B981', flag: '\u{1F1FA}\u{1F1F8}' },
    TZS: { symbol: 'TSh', color: '#3B82F6', flag: '\u{1F1F9}\u{1F1FF}' },
    XOF: { symbol: 'FCFA', color: '#8B5CF6', flag: '\u{1F1E7}\u{1F1EF}' },
    NGN: { symbol: '\u20A6', color: '#F59E0B', flag: '\u{1F1F3}\u{1F1EC}' },
    KES: { symbol: 'KSh', color: '#EC4899', flag: '\u{1F1F0}\u{1F1EA}' },
    GHS: { symbol: '\u20B5', color: '#06B6D4', flag: '\u{1F1EC}\u{1F1ED}' },
    UGX: { symbol: 'USh', color: '#EF4444', flag: '\u{1F1FA}\u{1F1EC}' },
    XAF: { symbol: 'FCFA', color: '#A855F7', flag: '\u{1F1E8}\u{1F1F2}' },
    USDT: { symbol: '\u20AE', color: '#26A17B', flag: '\u20AE' },
    USDC: { symbol: '$', color: '#2775CA', flag: '\u{1F4B5}' },
    PYUSD: { symbol: '$', color: '#0074D9', flag: '\u{1F4B3}' },
  };

  const config = currencyConfig[wallet.currency] || { symbol: wallet.currency, color: '#666', flag: '\u{1F4B0}' };
  const balance = parseFloat(wallet.balance) || 0;
  const isStablecoin = ['USDT', 'USDC', 'PYUSD'].includes(wallet.currency);
  const currencyLabel = isStablecoin ? `${wallet.currency} (Solana)` : wallet.currency;

  return (
    <motion.div whileTap={{ scale: 0.99 }}>
      {/* Main Row */}
      <button
        onClick={onSelect}
        className={`w-full ${tc.cardSolid} border rounded-xl p-4 flex items-center justify-between transition-all ${
          isSelected ? 'border-[#C7FF00]/50 ring-1 ring-[#C7FF00]/20' : ''
        }`}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
            style={{ backgroundColor: `${config.color}20` }}
          >
            {config.flag}
          </div>
          <div className="text-left">
            <div className="font-semibold">{currencyLabel}</div>
            <div className={`text-xs ${tc.textSecondary}`}>{t('wallet.available')}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-semibold">
              {config.symbol}{balance.toFixed(2)}
            </div>
            <div className={`text-xs ${tc.textSecondary}`}>
              {wallet.status === 'active' ? t('wallet.active') : wallet.status}
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 ${tc.textMuted} transition-transform ${isSelected ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {/* Quick Actions - shown when selected */}
      {isSelected && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-2 grid grid-cols-3 gap-2 px-1"
        >
          <button
            onClick={() => onNavigate?.('send-money')}
            className="flex flex-col items-center gap-1.5 py-3 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl hover:bg-[#C7FF00]/20 transition-colors"
          >
            <Send className="w-5 h-5 text-[#C7FF00]" />
            <span className="text-[10px] font-semibold text-[#C7FF00]">{t('action.send')}</span>
          </button>
          <button
            onClick={() => onNavigate?.('receive-money')}
            className="flex flex-col items-center gap-1.5 py-3 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl hover:bg-[#C7FF00]/20 transition-colors"
          >
            <ArrowDownToLine className="w-5 h-5 text-[#C7FF00]" />
            <span className="text-[10px] font-semibold text-[#C7FF00]">{t('action.receive') || 'Receive'}</span>
          </button>
          <button
            onClick={() => onNavigate?.('exchange')}
            className="flex flex-col items-center gap-1.5 py-3 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl hover:bg-[#C7FF00]/20 transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-[#C7FF00]" />
            <span className="text-[10px] font-semibold text-[#C7FF00]">{t('action.exchange') || 'Exchange'}</span>
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}