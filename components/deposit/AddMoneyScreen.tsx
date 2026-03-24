/**
 * BorderPay Africa - Add Money / Deposit Screen
 * Multiple funding methods: Bank Transfer, Card, Mobile Money, Crypto
 * i18n + theme-aware
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Building2, CreditCard, Smartphone, Bitcoin, Copy, CheckCircle, QrCode, Shield } from 'lucide-react';
import { isFullEnrollment } from '../../utils/config/environment';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { QRCodeSVG } from 'qrcode.react';
import { friendlyError } from '../../utils/errors/friendlyError';

interface AddMoneyScreenProps {
  userId: string;
  onBack: () => void;
}

interface Wallet {
  id: string;
  currency: string;
  balance: number;
  symbol: string;
}

interface VirtualAccount {
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
}

type FundingMethod = 'bank' | 'card' | 'mobile' | 'crypto';

export function AddMoneyScreen({ userId, onBack }: AddMoneyScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // KYC gate
  const [kycStatus, setKycStatus] = useState<string>('pending');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) {
        const user = JSON.parse(stored);
        setKycStatus(user.kyc_status || 'pending');
      }
    } catch {}
  }, []);

  const [selectedMethod, setSelectedMethod] = useState<FundingMethod | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [virtualAccount, setVirtualAccount] = useState<VirtualAccount | null>(null);
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [amount, setAmount] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [mobileProvider, setMobileProvider] = useState('');

  useEffect(() => {
    loadWallets();
  }, []);

  const loadWallets = async () => {
    try {
      const result = await backendAPI.wallets.getWallets();
      if (result.success && result.data) {
        const walletsList = result.data.wallets || result.data;
        setWallets(walletsList);
        if (walletsList.length > 0) {
          setSelectedWallet(walletsList[0]);
        }
      }
    } catch (_) {
      // Silent — shows empty wallet state
    }
  };

  const loadVirtualAccount = async (currency: string) => {
    setLoading(true);
    try {
      const result = await backendAPI.wallets.createVirtualAccount(userId, currency);
      if (result.success && result.data) {
        setVirtualAccount(result.data.account || result.data);
      } else {
        toast.error(friendlyError(result.error, t('addMoney.failedLoadDetails')));
      }
    } catch (error) {
      toast.error(t('addMoney.failedLoadDetails'));
    } finally {
      setLoading(false);
    }
  };

  const loadCryptoAddress = async (currency: string) => {
    setLoading(true);
    try {
      const result = await backendAPI.address.generateAddress(userId, currency, 'SOLANA');
      if (result.success && result.data) {
        setCryptoAddress(result.data.address);
      } else {
        toast.error(friendlyError(result.error, t('addMoney.failedGenAddress')));
      }
    } catch (error) {
      toast.error(t('addMoney.failedGenAddress'));
    } finally {
      setLoading(false);
    }
  };

  const handleMethodSelect = async (method: FundingMethod) => {
    setSelectedMethod(method);
    if (method === 'bank' && selectedWallet) {
      await loadVirtualAccount(selectedWallet.currency);
    } else if (method === 'crypto' && selectedWallet) {
      await loadCryptoAddress(selectedWallet.currency);
    }
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(`${field} copied to clipboard`);
    setTimeout(() => setCopiedField(''), 3000);
  };

  const handleMobileMoneyCollect = async () => {
    if (!amount || !phoneNumber || !mobileProvider) {
      toast.error('Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      const result = await backendAPI.mobileMoney.collect({
        userId,
        amount: parseFloat(amount),
        phoneNumber,
        provider: mobileProvider,
      });

      if (result.success) {
        toast.success('Mobile money request sent! Check your phone to approve.');
      } else {
        toast.error(friendlyError(result.error, 'Failed to initiate mobile money collection'));
      }
    } catch (error) {
      toast.error('Failed to initiate collection');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe relative`}>
      {!isFullEnrollment(kycStatus) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0B0E11]/95 backdrop-blur-sm px-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-yellow-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Verification Required</h2>
            <p className="text-sm text-gray-400 mb-6">Complete identity verification to access this feature.</p>
            <button
              onClick={onBack}
              className="w-full h-12 rounded-2xl bg-[#C7FF00] text-[#0B0E11] font-bold text-sm"
            >
              Go Back
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={() => selectedMethod ? setSelectedMethod(null) : onBack()}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="bp-text-h3 font-bold">{t('addMoney.title')}</h1>
          <div className="w-10" />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Method Selection */}
        {!selectedMethod && (
          <motion.div
            key="methods"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-6 py-6"
          >
            {/* Wallet Selector */}
            {wallets.length > 1 && (
              <div className="mb-6">
                <label className={`bp-text-small ${tc.textSecondary} mb-2 block`}>{t('addMoney.selectWallet')}</label>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {wallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      onClick={() => setSelectedWallet(wallet)}
                      className={`px-4 py-2 rounded-full bp-text-small font-semibold whitespace-nowrap transition-all ${
                        selectedWallet?.id === wallet.id
                          ? 'bg-[#C7FF00] text-black'
                          : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                      }`}
                    >
                      {wallet.currency}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Funding Methods */}
            <div className="space-y-3">
              <button
                onClick={() => handleMethodSelect('bank')}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 ${tc.hoverBg} transition-colors`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-[#C7FF00]/20 flex items-center justify-center">
                    <Building2 size={24} className="text-[#C7FF00]" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="bp-text-body font-semibold">{t('addMoney.bankTransfer')}</p>
                    <p className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.bankTransferDesc')}</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleMethodSelect('card')}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 ${tc.hoverBg} transition-colors`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <CreditCard size={24} className="text-blue-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="bp-text-body font-semibold">{t('addMoney.debitCard')}</p>
                    <p className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.debitCardDesc')}</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleMethodSelect('mobile')}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 ${tc.hoverBg} transition-colors`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Smartphone size={24} className="text-purple-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="bp-text-body font-semibold">{t('addMoney.mobileMoney')}</p>
                    <p className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.mobileMoneyProviders')}</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleMethodSelect('crypto')}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 ${tc.hoverBg} transition-colors`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <Bitcoin size={24} className="text-orange-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="bp-text-body font-semibold">{t('addMoney.crypto')}</p>
                    <p className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.cryptoDesc')}</p>
                  </div>
                </div>
              </button>
            </div>
          </motion.div>
        )}

        {/* Bank Transfer Details */}
        {selectedMethod === 'bank' && (
          <motion.div
            key="bank"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-6 py-6"
          >
            {virtualAccount ? (
              <>
                <div className="bg-gradient-to-br from-[#C7FF00]/20 to-[#C7FF00]/5 border border-[#C7FF00]/30 rounded-3xl p-6 mb-6">
                  <p className="bp-text-small text-[#C7FF00] mb-4 font-semibold">
                    {t('addMoney.transferToAccount')}
                  </p>

                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.bankName')}</span>
                        <button
                          onClick={() => handleCopy(virtualAccount.bank_name, 'Bank name')}
                          className="text-[#C7FF00] hover:text-[#B8F000] transition-colors"
                        >
                          {copiedField === 'Bank name' ? <CheckCircle size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <p className="bp-text-body font-bold">{virtualAccount.bank_name}</p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.accountNumber')}</span>
                        <button
                          onClick={() => handleCopy(virtualAccount.account_number, 'Account number')}
                          className="text-[#C7FF00] hover:text-[#B8F000] transition-colors"
                        >
                          {copiedField === 'Account number' ? <CheckCircle size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <p className="bp-text-h2 font-bold">{virtualAccount.account_number}</p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.accountName')}</span>
                        <button
                          onClick={() => handleCopy(virtualAccount.account_name, 'Account name')}
                          className="text-[#C7FF00] hover:text-[#B8F000] transition-colors"
                        >
                          {copiedField === 'Account name' ? <CheckCircle size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <p className="bp-text-body font-bold">{virtualAccount.account_name}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                  <p className="bp-text-small text-blue-300">
                    {t('addMoney.fundsReflect')}
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <p className={`bp-text-body ${tc.textSecondary}`}>{t('addMoney.failedLoadDetails')}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Mobile Money */}
        {selectedMethod === 'mobile' && (
          <motion.div
            key="mobile"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-6 py-6"
          >
            <div className="space-y-4">
              <div>
                <label className={`bp-text-small ${tc.textSecondary} mb-2 block`}>{t('addMoney.amount')}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 bp-text-body">
                    {selectedWallet?.symbol || '$'}
                  </span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={`w-full ${tc.inputBg} rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:border-[#C7FF00]/50`}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className={`bp-text-small ${tc.textSecondary} mb-2 block`}>{t('addMoney.phoneNumber')}</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className={`w-full ${tc.inputBg} rounded-2xl px-4 py-4 focus:outline-none focus:border-[#C7FF00]/50`}
                  placeholder="+233 XX XXX XXXX"
                />
              </div>

              <div>
                <label className={`bp-text-small ${tc.textSecondary} mb-2 block`}>{t('addMoney.provider')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {['MTN', 'Airtel', 'Vodafone'].map((provider) => (
                    <button
                      key={provider}
                      onClick={() => setMobileProvider(provider)}
                      className={`py-3 rounded-xl bp-text-small font-semibold transition-all ${
                        mobileProvider === provider
                          ? 'bg-[#C7FF00] text-black'
                          : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                      }`}
                    >
                      {provider}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleMobileMoneyCollect}
                disabled={loading || !amount || !phoneNumber || !mobileProvider}
                className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-6"
              >
                {loading ? t('addMoney.processing') : t('addMoney.continue')}
              </button>
            </div>
          </motion.div>
        )}

        {/* Crypto */}
        {selectedMethod === 'crypto' && (
          <motion.div
            key="crypto"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-6 py-6"
          >
            {cryptoAddress ? (
              <>
                {/* Stablecoin Badges */}
                <div className="flex justify-center gap-2 mb-4">
                  <div className="px-3 py-1 bg-[#26A17B]/20 border border-[#26A17B]/40 rounded-full">
                    <span className="bp-text-tiny text-[#26A17B] font-bold">USDT</span>
                  </div>
                  <div className="px-3 py-1 bg-[#2775CA]/20 border border-[#2775CA]/40 rounded-full">
                    <span className="bp-text-tiny text-[#2775CA] font-bold">USDC</span>
                  </div>
                  <div className="px-3 py-1 bg-[#0074D9]/20 border border-[#0074D9]/40 rounded-full">
                    <span className="bp-text-tiny text-[#0074D9] font-bold">PYUSD</span>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-3xl flex justify-center mb-6">
                  <QRCodeSVG value={cryptoAddress} size={200} level="H" />
                </div>

                <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-4`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`bp-text-small ${tc.textSecondary}`}>{t('addMoney.solanaAddress')}</span>
                    <button
                      onClick={() => handleCopy(cryptoAddress, 'Address')}
                      className="text-[#C7FF00] hover:text-[#B8F000] transition-colors"
                    >
                      {copiedField === 'Address' ? <CheckCircle size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                  <p className="bp-text-small font-mono break-all">{cryptoAddress}</p>
                </div>

                {/* Network Info */}
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-purple-300 font-bold bp-text-small">i</span>
                    </div>
                    <div className="flex-1">
                      <p className="bp-text-small text-purple-300 font-semibold mb-1">
                        {t('addMoney.solanaInfo')}
                      </p>
                      <p className="bp-text-tiny text-purple-300/80">
                        {t('addMoney.solanaInfoDesc')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Warning */}
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-orange-300 text-xl flex-shrink-0">!</span>
                    <p className="bp-text-small text-orange-300">
                      {t('addMoney.solanaWarning')}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <p className={`bp-text-body ${tc.textSecondary}`}>{t('addMoney.failedGenAddress')}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Card */}
        {selectedMethod === 'card' && (
          <motion.div
            key="card"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-6 py-6 text-center"
          >
            <CreditCard size={48} className={`${tc.textMuted} mx-auto mb-4`} />
            <p className={`bp-text-body ${tc.textSecondary} mb-2`}>{t('addMoney.cardPayments')}</p>
            <p className={`bp-text-small ${tc.textMuted}`}>{t('addMoney.cardIntegration')}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}