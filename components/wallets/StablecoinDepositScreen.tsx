/**
 * BorderPay Africa - Stablecoin Deposit Address Generator
 * Generate crypto deposit address via backend API
 * - coin: USDC | USDT | PYUSD (user selects)
 * - chain: solana (default, handled by backend)
 * - customer_id: from auth (handled by backend)
 * 
 * Frontend only collects: coin selection
 * Everything else is backend-handled.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Copy, CheckCircle, Shield, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { QRCodeSVG } from 'qrcode.react';

interface StablecoinDepositScreenProps {
  onBack: () => void;
  onConfirm?: (data: {
    txType: 'deposit' | 'send' | 'receive' | 'swap';
    currency: 'USDC' | 'USDT' | 'PYUSD';
    amount?: number;
    network?: string;
    address?: string;
    txHash?: string;
  }) => void;
}

type StablecoinType = 'USDC' | 'USDT' | 'PYUSD';

interface CoinConfig {
  code: StablecoinType;
  name: string;
  descKey: string;
  color: string;
  bgColor: string;
  icon: string;
}

const COINS: CoinConfig[] = [
  { code: 'USDC', name: 'USD Coin', descKey: 'stablecoin.usdcDesc', color: '#2775CA', bgColor: '#2775CA20', icon: '$' },
  { code: 'USDT', name: 'Tether', descKey: 'stablecoin.usdtDesc', color: '#26A17B', bgColor: '#26A17B20', icon: '₮' },
  { code: 'PYUSD', name: 'PayPal USD', descKey: 'stablecoin.pyusdDesc', color: '#0074D9', bgColor: '#0074D920', icon: '$' },
];

export function StablecoinDepositScreen({ onBack, onConfirm }: StablecoinDepositScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  const [selectedCoin, setSelectedCoin] = useState<StablecoinType | null>(null);
  const [generatedAddress, setGeneratedAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<'select' | 'address'>('select');

  const handleGenerateAddress = async (coin: StablecoinType) => {
    setSelectedCoin(coin);
    setLoading(true);

    try {
      const user = authAPI.getStoredUser();
      const userId = user?.id || '';

      const result = await backendAPI.address.generateAddress(userId, coin, 'SOLANA');

      if (result.success && result.data?.address) {
        setGeneratedAddress(result.data.address);
        setStep('address');
      } else {
        console.error('Generate address error:', result.error);
        toast.error(result.error || t('addMoney.failedGenAddress'));
      }
    } catch (error) {
      console.error('Generate address failed:', error);
      toast.error(t('addMoney.failedGenAddress'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!generatedAddress) return;
    navigator.clipboard.writeText(generatedAddress);
    setCopied(true);
    toast.success(t('stablecoin.addressCopied'));
    setTimeout(() => setCopied(false), 3000);
  };

  const handleBack = () => {
    if (step === 'address') {
      setStep('select');
      setGeneratedAddress('');
      setSelectedCoin(null);
      setCopied(false);
    } else {
      onBack();
    }
  };

  const activeCoin = COINS.find(c => c.code === selectedCoin);

  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={handleBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="bp-text-h3 font-bold">{t('stablecoin.title')}</h1>
          <div className="w-10" />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Select Coin */}
        {step === 'select' && !loading && (
          <motion.div
            key="select"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-6 py-6"
          >
            {/* Solana Network Badge */}
            <div className="flex justify-center mb-6">
              <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#9945FF]/20 to-[#14F195]/20 border border-[#9945FF]/30 rounded-full">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195]" />
                <span className="text-sm font-semibold" style={{ color: '#14F195' }}>{t('stablecoin.solana')}</span>
              </div>
            </div>

            <p className={`text-center bp-text-body ${tc.textSecondary} mb-8`}>
              {t('stablecoin.subtitle')}
            </p>

            {/* Coin Selection */}
            <div className="space-y-3 mb-8">
              {COINS.map((coin) => (
                <motion.button
                  key={coin.code}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleGenerateAddress(coin.code)}
                  className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 hover:border-[#C7FF00]/40 transition-all text-left`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: coin.bgColor }}
                    >
                      <span className="text-2xl font-black" style={{ color: coin.color }}>
                        {coin.icon}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-base">{coin.code}</span>
                        <span className={`bp-text-small ${tc.textSecondary}`}>{coin.name}</span>
                      </div>
                      <p className={`bp-text-small ${tc.textMuted}`}>{t(coin.descKey)}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-[#C7FF00] font-bold text-sm">+</span>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>

            {/* Info Footer */}
            <div className="space-y-3">
              <div className={`flex items-center gap-3 p-3 ${tc.card} border ${tc.cardBorder} rounded-xl`}>
                <Zap size={18} className="text-[#14F195] flex-shrink-0" />
                <span className={`bp-text-small ${tc.textSecondary}`}>{t('stablecoin.lowFees')}</span>
              </div>
              <div className={`flex items-center gap-3 p-3 ${tc.card} border ${tc.cardBorder} rounded-xl`}>
                <Shield size={18} className="text-[#C7FF00] flex-shrink-0" />
                <span className={`bp-text-small ${tc.textSecondary}`}>{t('stablecoin.warning')}</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Loading State */}
        {loading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-24 px-6"
          >
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#9945FF]/20 to-[#14F195]/20 flex items-center justify-center">
                <LoadingSpinner />
              </div>
            </div>
            <p className="font-bold text-lg mb-1">{t('stablecoin.generating')}</p>
            <p className={`bp-text-small ${tc.textSecondary} text-center`}>
              {selectedCoin} on Solana
            </p>
          </motion.div>
        )}

        {/* Step 2: Display Address */}
        {step === 'address' && !loading && generatedAddress && activeCoin && (
          <motion.div
            key="address"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-6 py-6"
          >
            {/* Coin + Network Badge */}
            <div className="flex justify-center gap-2 mb-6">
              <div
                className="flex items-center gap-2 px-4 py-2 rounded-full border"
                style={{ backgroundColor: activeCoin.bgColor, borderColor: `${activeCoin.color}40` }}
              >
                <span className="font-bold text-sm" style={{ color: activeCoin.color }}>{activeCoin.code}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#9945FF]/20 to-[#14F195]/20 border border-[#9945FF]/30 rounded-full">
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195]" />
                <span className="text-sm font-semibold" style={{ color: '#14F195' }}>Solana</span>
              </div>
            </div>

            {/* QR Code */}
            <div className="bg-white p-6 rounded-3xl flex flex-col items-center mb-6 mx-auto max-w-[280px]">
              <QRCodeSVG value={generatedAddress} size={200} level="H" />
              <p className="text-gray-500 text-[10px] mt-3 font-medium">{t('stablecoin.scanToDeposit')}</p>
            </div>

            {/* Address Display */}
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-4`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`bp-text-small ${tc.textSecondary}`}>{t('stablecoin.yourAddress')}</span>
              </div>
              <p className="bp-text-small font-mono break-all leading-relaxed mb-3">{generatedAddress}</p>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleCopy}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${
                  copied
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-[#C7FF00] text-black'
                }`}
              >
                {copied ? (
                  <>
                    <CheckCircle size={18} />
                    {t('stablecoin.addressCopied')}
                  </>
                ) : (
                  <>
                    <Copy size={18} />
                    {t('stablecoin.copyAddress')}
                  </>
                )}
              </motion.button>
            </div>

            {/* Details */}
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-4`}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`bp-text-small ${tc.textSecondary}`}>{t('stablecoin.network')}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195]" />
                    <span className="bp-text-small font-semibold">Solana</span>
                  </div>
                </div>
                <div className={`border-t ${tc.borderLight}`} />
                <div className="flex items-center justify-between">
                  <span className={`bp-text-small ${tc.textSecondary}`}>{t('stablecoin.coin')}</span>
                  <span className="bp-text-small font-semibold" style={{ color: activeCoin.color }}>
                    {activeCoin.code}
                  </span>
                </div>
                <div className={`border-t ${tc.borderLight}`} />
                <div className="flex items-center justify-between">
                  <span className={`bp-text-small ${tc.textSecondary}`}>{t('stablecoin.lowFees')}</span>
                  <Zap size={14} className="text-[#14F195]" />
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <span className="text-orange-300 text-xl flex-shrink-0">!</span>
                <p className="bp-text-small text-orange-300">
                  {t('stablecoin.warning')}
                </p>
              </div>
            </div>

            {/* Confirm Deposit — logs to Postgres and shows confirmation */}
            {onConfirm && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => onConfirm({
                  txType: 'deposit',
                  currency: activeCoin!.code,
                  network: 'SOLANA',
                  address: generatedAddress,
                })}
                className="w-full py-3.5 bg-[#C7FF00] text-[#0B0E11] rounded-full font-extrabold text-sm flex items-center justify-center gap-2 mb-3"
              >
                <CheckCircle size={16} />
                Confirm Deposit
              </motion.button>
            )}

            {/* Generate New */}
            <button
              onClick={handleBack}
              className={`w-full py-3 ${tc.card} border ${tc.cardBorder} rounded-xl bp-text-small font-semibold ${tc.textSecondary} hover:border-[#C7FF00]/40 transition-all`}
            >
              {t('stablecoin.newAddress')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}