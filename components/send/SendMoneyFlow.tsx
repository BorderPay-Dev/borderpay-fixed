/**
 * BorderPay Africa - Send Money Flow (Local Payments Africa + US Payments)
 * 4 transfer methods:
 *   1. Bank Transfer — NGN/KES/GHS/UGX/XAF/XOF/TZS via banking provider
 *   2. Mobile Money — MOBILEMONEY scheme
 *   3. BorderPay Pay — Internal P2P
 *   4. US Payment (ACH/Wire) — USD to registered counterparties via banking API
 *
 * Flow: Choose Method → Enter Details → Amount → Review → PIN → Success
 * i18n + theme-aware, neon green (#C7FF00) + black aesthetic
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Building2, Smartphone, Users, Search,
  CheckCircle, AlertCircle, Lock, Loader2, ChevronDown,
  Send, Info, ArrowRight, Copy, XCircle, DollarSign, Zap, Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { PINManager, BiometricManager } from '../../utils/security/SecurityManager';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';
import { USPaymentDetails } from './USPaymentDetails';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TransferMethod = 'bank' | 'mobile_money' | 'borderpay' | 'us_ach_wire';
type Step = 'method' | 'details' | 'amount' | 'review' | 'pin' | 'processing' | 'success' | 'error';

interface Institution {
  code: string;
  name: string;
  type?: string;
}

interface Wallet {
  id: string;
  currency: string;
  balance: number;
  symbol?: string;
}

interface SendMoneyFlowProps {
  userId: string;
  onBack: () => void;
  onComplete: () => void;
  onNavigate?: (screen: string) => void;
}

// ---------------------------------------------------------------------------
// Currency config
// ---------------------------------------------------------------------------

const SUPPORTED_CURRENCIES = [
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬', country: 'NG' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪', country: 'KE' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', flag: '🇬🇭', country: 'GH' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', flag: '🇺🇬', country: 'UG' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', flag: '🇹🇿', country: 'TZ' },
  { code: 'XAF', name: 'CFA (Central)', symbol: 'FCFA', flag: '🇨🇲', country: 'CM' },
  { code: 'XOF', name: 'CFA (West)', symbol: 'FCFA', flag: '🇧🇯', country: 'BJ' },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦', KES: 'KSh', GHS: '₵', UGX: 'USh',
  XAF: 'FCFA', XOF: 'FCFA', TZS: 'TSh', USD: '$',
  USDT: '$', USDC: '$', PYUSD: '$',
};

function getCurrencySymbol(code: string) {
  return CURRENCY_SYMBOLS[code] || code;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendMoneyFlow({ userId, onBack, onComplete, onNavigate }: SendMoneyFlowProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // Step & method
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<TransferMethod>('bank');

  // Currency & wallet
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState('NGN');
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Bank / MoMo details
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedBank, setSelectedBank] = useState<Institution | null>(null);
  const [bankSearch, setBankSearch] = useState('');
  const [showBankList, setShowBankList] = useState(false);
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  // BorderPay P2P
  const [recipientIdentifier, setRecipientIdentifier] = useState('');

  // US Payments (ACH/Wire) state
  const [usCounterparties, setUsCounterparties] = useState<any[]>([]);
  const [selectedCounterparty, setSelectedCounterparty] = useState<any>(null);
  const [loadingCounterparties, setLoadingCounterparties] = useState(false);
  const [showCounterpartyList, setShowCounterpartyList] = useState(false);
  const [paymentRail, setPaymentRail] = useState<'ACH' | 'ACH-ACCELERATED' | 'FEDWIRE'>('ACH');
  const [usMemo, setUsMemo] = useState('');
  const [showNewCounterparty, setShowNewCounterparty] = useState(false);
  // New counterparty form fields
  const [cpFirstName, setCpFirstName] = useState('');
  const [cpLastName, setCpLastName] = useState('');
  const [cpIsCorporate, setCpIsCorporate] = useState(false);
  const [cpBusinessName, setCpBusinessName] = useState('');
  const [cpAccountNumber, setCpAccountNumber] = useState('');
  const [cpRoutingNumber, setCpRoutingNumber] = useState('');
  const [cpInstitutionName, setCpInstitutionName] = useState('');
  const [cpAccountType, setCpAccountType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [cpStreet, setCpStreet] = useState('');
  const [cpCity, setCpCity] = useState('');
  const [cpState, setCpState] = useState('');
  const [cpPostalCode, setCpPostalCode] = useState('');
  const [creatingCounterparty, setCreatingCounterparty] = useState(false);

  // Amount & reason
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  // PIN & result
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingInstitutions, setLoadingInstitutions] = useState(false);
  const [transactionId, setTransactionId] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [newBalance, setNewBalance] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // Load wallets on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const res = await backendAPI.wallets.getWallets();
        if (res.success && res.data) {
          const list = (res.data.wallets || res.data || []).map((w: any) => ({
            id: w.id,
            currency: w.currency,
            balance: parseFloat(w.balance) || 0,
            symbol: getCurrencySymbol(w.currency),
          }));
          setWallets(list);
        }
      } catch (e) {
        console.error('Failed to load wallets:', e);
      }
    })();
  }, [userId]);

  // Select wallet when currency changes
  useEffect(() => {
    const w = wallets.find(w => w.currency === selectedCurrency);
    setSelectedWallet(w || null);
  }, [selectedCurrency, wallets]);

  // ---------------------------------------------------------------------------
  // Load institutions when method/currency changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (method === 'borderpay' || method === 'us_ach_wire') return;
    loadInstitutions();
  }, [method, selectedCurrency]);

  const loadInstitutions = async () => {
    setLoadingInstitutions(true);
    setInstitutions([]);
    setSelectedBank(null);
    try {
      const type = method === 'mobile_money' ? 'MOBILE_MONEY' : undefined;
      const res = await backendAPI.localPayments.getInstitutions(selectedCurrency, type);
      if (res.success && res.data?.institutions) {
        setInstitutions(res.data.institutions);
      }
    } catch (e) {
      console.error('Failed to load institutions:', e);
    } finally {
      setLoadingInstitutions(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Account resolution (debounced)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setResolvedName('');
    setResolveError('');

    if (!selectedBank || accountNumber.length < 6) return;

    const timer = setTimeout(() => resolveAccount(), 800);
    return () => clearTimeout(timer);
  }, [selectedBank, accountNumber]);

  const resolveAccount = async () => {
    if (!selectedBank || !accountNumber) return;
    setResolving(true);
    setResolvedName('');
    setResolveError('');
    try {
      const res = await backendAPI.localPayments.resolveAccount(
        selectedBank.code, accountNumber, selectedCurrency
      );
      if (res.success && res.data?.account_name) {
        setResolvedName(res.data.account_name);
      } else {
        setResolveError(res.error || t('send.accountResolveFailed'));
      }
    } catch {
      setResolveError(t('send.accountResolveFailed'));
    } finally {
      setResolving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------
  const goBack = () => {
    switch (step) {
      case 'method': onBack(); break;
      case 'details': setStep('method'); break;
      case 'amount': setStep('details'); break;
      case 'review': setStep('amount'); break;
      case 'pin': setStep('review'); break;
      case 'error': setStep('review'); break;
      default: onBack();
    }
  };

  const canProceedDetails = () => {
    if (method === 'borderpay') return recipientIdentifier.trim().length > 0;
    if (method === 'us_ach_wire') return !!selectedCounterparty;
    return !!selectedBank && accountNumber.length >= 6;
  };

  const canProceedAmount = () => {
    const num = parseFloat(amount);
    if (method === 'us_ach_wire') {
      return num > 0 && selectedWallet && num <= selectedWallet.balance && usMemo.trim().length > 0 && reason.trim().length > 0;
    }
    return num > 0 && selectedWallet && num <= selectedWallet.balance;
  };

  // ---------------------------------------------------------------------------
  // Process transaction
  // ---------------------------------------------------------------------------
  const processTransaction = async (verifiedPin: string) => {
    setStep('processing');
    setErrorMessage('');

    try {
      let result: any;

      if (method === 'us_ach_wire') {
        result = await backendAPI.usPayments.transfer({
          counterparty_id: selectedCounterparty.id || selectedCounterparty.maplerad_id,
          amount: parseFloat(amount),
          payment_rail: paymentRail,
          memo: usMemo || 'invoice #1',
          reason: reason || 'payment for goods and services',
          transaction_pin: verifiedPin,
        });
      } else if (method === 'borderpay') {
        result = await backendAPI.localPayments.borderPayTransfer({
          recipient_identifier: recipientIdentifier.trim(),
          amount: parseFloat(amount),
          currency: selectedCurrency,
          reason: reason || undefined,
          transaction_pin: verifiedPin,
        });
      } else {
        const meta = method === 'mobile_money' ? { scheme: 'MOBILEMONEY' } : undefined;
        result = await backendAPI.localPayments.transfer({
          bank_code: selectedBank!.code,
          account_number: accountNumber,
          amount: parseFloat(amount),
          currency: selectedCurrency,
          reason: reason || 'Transfer',
          transaction_pin: verifiedPin,
          wallet_id: selectedWallet?.id,
          meta,
        });
      }

      if (result.success) {
        setTransactionId(result.data?.transaction_id || '');
        setTransactionRef(result.data?.reference || '');
        setNewBalance(result.data?.new_balance ?? null);
        setStep('success');
        toast.success(t('send.txSuccessful'));
      } else {
        setErrorMessage(result.error || t('send.txFailed'));
        setStep('error');
        toast.error(result.error || t('send.txFailed'));
      }
    } catch (error: any) {
      setErrorMessage(error.message || t('send.txFailed'));
      setStep('error');
      toast.error(error.message || t('send.txFailed'));
    }
  };

  const handlePinComplete = async (value: string) => {
    setPin(value);
    if (value.length === 6) {
      // Verify PIN locally first before sending to backend
      const hasPIN = PINManager.hasPIN(userId);
      if (hasPIN) {
        const isValid = await PINManager.verifyPIN(userId, value);
        if (!isValid) {
          toast.error(t('send.incorrectPin') || 'Incorrect PIN');
          setPin('');
          return;
        }
      }
      processTransaction(value);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtered institutions
  // ---------------------------------------------------------------------------
  const filteredBanks = institutions.filter(b =>
    b.name.toLowerCase().includes(bankSearch.toLowerCase()) ||
    b.code.toLowerCase().includes(bankSearch.toLowerCase())
  );

  // ---------------------------------------------------------------------------
  // Step title
  // ---------------------------------------------------------------------------
  const getStepTitle = () => {
    switch (step) {
      case 'method': return t('send.title');
      case 'details': return method === 'bank' ? t('send.bankDetails') : method === 'mobile_money' ? t('send.momoDetails') : method === 'us_ach_wire' ? t('send.usPaymentDetails') : t('send.borderPayDetails');
      case 'amount': return t('send.amount');
      case 'review': return t('send.reviewTransfer');
      case 'pin': return t('send.verifyTransaction');
      case 'processing': return t('send.processingTx');
      case 'success': return t('send.txSuccessful');
      case 'error': return t('send.txFailed');
      default: return t('send.title');
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-5 py-4 pt-safe">
          {step !== 'success' && step !== 'processing' ? (
            <button
              onClick={goBack}
              className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
            >
              <ArrowLeft size={20} className={tc.text} />
            </button>
          ) : (
            <div className="w-10" />
          )}
          <h1 className={`text-base font-bold ${tc.text}`}>{getStepTitle()}</h1>
          <div className="w-10" />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 1: Choose Transfer Method                                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'method' && (
          <motion.div
            key="method"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="px-5 py-6"
          >
            <p className={`text-sm ${tc.textSecondary} mb-5`}>{t('send.chooseMethod')}</p>

            <div className="space-y-3">
              {/* Bank Transfer */}
              <button
                onClick={() => { setMethod('bank'); setSelectedCurrency('NGN'); setStep('details'); }}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 ${tc.hoverBg} transition-all active:scale-[0.98]`}
              >
                <div className="w-12 h-12 rounded-full bg-[#C7FF00]/15 flex items-center justify-center flex-shrink-0">
                  <Building2 size={22} className="text-[#C7FF00]" />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-semibold ${tc.text}`}>{t('send.bankTransfer')}</p>
                  <p className={`text-xs ${tc.textMuted} mt-0.5`}>{t('send.bankTransferDesc')}</p>
                </div>
                <ArrowRight size={18} className={tc.textMuted} />
              </button>

              {/* Mobile Money */}
              <button
                onClick={() => { setMethod('mobile_money'); setSelectedCurrency('NGN'); setStep('details'); }}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 ${tc.hoverBg} transition-all active:scale-[0.98]`}
              >
                <div className="w-12 h-12 rounded-full bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Smartphone size={22} className="text-purple-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-semibold ${tc.text}`}>{t('send.mobileMoney')}</p>
                  <p className={`text-xs ${tc.textMuted} mt-0.5`}>{t('send.mobileMoneyDesc')}</p>
                </div>
                <ArrowRight size={18} className={tc.textMuted} />
              </button>

              {/* BorderPay Pay */}
              <button
                onClick={() => { setMethod('borderpay'); setStep('details'); }}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 ${tc.hoverBg} transition-all active:scale-[0.98]`}
              >
                <div className="w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <Users size={22} className="text-blue-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-semibold ${tc.text}`}>{t('send.borderPayPay')}</p>
                  <p className={`text-xs ${tc.textMuted} mt-0.5`}>{t('send.borderPayPayDesc')}</p>
                </div>
                <ArrowRight size={18} className={tc.textMuted} />
              </button>

              {/* US Payment (ACH/Wire) */}
              <button
                onClick={() => { setMethod('us_ach_wire'); setSelectedCurrency('USD'); setStep('details'); }}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 ${tc.hoverBg} transition-all active:scale-[0.98]`}
              >
                <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={22} className="text-red-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-semibold ${tc.text}`}>{t('send.usAchWire')}</p>
                  <p className={`text-xs ${tc.textMuted} mt-0.5`}>{t('send.usAchWireDesc')}</p>
                </div>
                <ArrowRight size={18} className={tc.textMuted} />
              </button>
            </div>

            {/* Info */}
            <div className={`mt-6 flex items-start gap-2 px-4 py-3 ${tc.card} rounded-xl border ${tc.borderLight}`}>
              <Info size={16} className="text-[#C7FF00] mt-0.5 flex-shrink-0" />
              <p className={`text-xs ${tc.textMuted}`}>{t('send.localPaymentsInfo')}</p>
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 2: Enter Details                                              */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'details' && (
          <motion.div
            key="details"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            {/* Currency Picker (Africa only — not for P2P or US) */}
            {method !== 'borderpay' && method !== 'us_ach_wire' && (
              <div className="mb-5">
                <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.selectCurrency')}</label>
                <button
                  onClick={() => setShowCurrencyPicker(!showCurrencyPicker)}
                  className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between ${tc.hoverBg} transition-colors`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{SUPPORTED_CURRENCIES.find(c => c.code === selectedCurrency)?.flag}</span>
                    <div>
                      <p className={`text-sm font-semibold ${tc.text}`}>{selectedCurrency}</p>
                      <p className={`text-xs ${tc.textMuted}`}>{SUPPORTED_CURRENCIES.find(c => c.code === selectedCurrency)?.name}</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`${tc.textMuted} transition-transform ${showCurrencyPicker ? 'rotate-180' : ''}`} />
                </button>

                {showCurrencyPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mt-2 ${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden shadow-xl max-h-64 overflow-y-auto`}
                  >
                    {SUPPORTED_CURRENCIES.map(cur => (
                      <button
                        key={cur.code}
                        onClick={() => {
                          setSelectedCurrency(cur.code);
                          setShowCurrencyPicker(false);
                          setSelectedBank(null);
                          setAccountNumber('');
                          setResolvedName('');
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 ${tc.hoverBg} transition-colors text-left ${
                          selectedCurrency === cur.code ? 'bg-[#C7FF00]/10' : ''
                        }`}
                      >
                        <span className="text-lg">{cur.flag}</span>
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${tc.text}`}>{cur.code}</p>
                          <p className={`text-xs ${tc.textMuted}`}>{cur.name}</p>
                        </div>
                        {selectedCurrency === cur.code && (
                          <CheckCircle size={16} className="text-[#C7FF00]" />
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            {/* Bank / MoMo Selection (Africa only) */}
            {method !== 'borderpay' && method !== 'us_ach_wire' && (
              <>
                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>
                    {method === 'bank' ? t('send.selectBank') : t('send.selectProvider')}
                  </label>

                  <button
                    onClick={() => setShowBankList(!showBankList)}
                    className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between ${tc.hoverBg} transition-colors`}
                  >
                    <span className={`text-sm ${selectedBank ? `font-semibold ${tc.text}` : tc.textMuted}`}>
                      {selectedBank ? selectedBank.name : (method === 'bank' ? t('send.chooseBankPlaceholder') : t('send.chooseProviderPlaceholder'))}
                    </span>
                    {loadingInstitutions ? (
                      <Loader2 size={16} className="text-[#C7FF00] animate-spin" />
                    ) : (
                      <ChevronDown size={18} className={`${tc.textMuted} transition-transform ${showBankList ? 'rotate-180' : ''}`} />
                    )}
                  </button>

                  {showBankList && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`mt-2 ${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden shadow-xl`}
                    >
                      {/* Search */}
                      <div className={`px-3 py-2 border-b ${tc.borderLight}`}>
                        <div className="relative">
                          <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${tc.textMuted}`} />
                          <input
                            type="text"
                            value={bankSearch}
                            onChange={e => setBankSearch(e.target.value)}
                            placeholder={t('send.searchBanks')}
                            className={`w-full ${tc.inputBg} rounded-xl pl-9 pr-3 py-2.5 text-sm placeholder:${tc.textMuted} focus:outline-none`}
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="max-h-56 overflow-y-auto">
                        {filteredBanks.length === 0 ? (
                          <p className={`text-sm ${tc.textMuted} text-center py-6`}>{loadingInstitutions ? t('common.loading') : t('send.noBanksFound')}</p>
                        ) : (
                          filteredBanks.map(bank => (
                            <button
                              key={bank.code}
                              onClick={() => {
                                setSelectedBank(bank);
                                setShowBankList(false);
                                setBankSearch('');
                                setResolvedName('');
                                setResolveError('');
                              }}
                              className={`w-full text-left px-4 py-3 ${tc.hoverBg} transition-colors border-b ${tc.borderLight} last:border-0 ${
                                selectedBank?.code === bank.code ? 'bg-[#C7FF00]/10' : ''
                              }`}
                            >
                              <p className={`text-sm font-medium ${tc.text}`}>{bank.name}</p>
                              <p className={`text-xs ${tc.textMuted}`}>{bank.code}</p>
                            </button>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Account Number */}
                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>
                    {method === 'bank' ? t('send.accountNumber') : t('send.phoneNumber')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={accountNumber}
                    onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder={method === 'bank' ? '0123456789' : '+2348012345678'}
                    className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  />
                </div>

                {/* Account Resolution Result */}
                {resolving && (
                  <div className="flex items-center gap-2 mb-4 px-1">
                    <Loader2 size={14} className="text-[#C7FF00] animate-spin" />
                    <span className={`text-xs ${tc.textMuted}`}>{t('send.verifyingAccount')}</span>
                  </div>
                )}
                {resolvedName && !resolving && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl"
                  >
                    <CheckCircle size={16} className="text-green-400" />
                    <span className="text-sm text-green-400 font-medium">{resolvedName}</span>
                  </motion.div>
                )}
                {resolveError && !resolving && (
                  <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <AlertCircle size={16} className="text-red-400" />
                    <span className="text-xs text-red-400">{resolveError}</span>
                  </div>
                )}
              </>
            )}

            {/* BorderPay P2P */}
            {method === 'borderpay' && (
              <>
                {/* Currency for P2P */}
                <div className="mb-5">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.selectCurrency')}</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { code: 'NGN', flag: '🇳🇬' },
                      { code: 'USD', flag: '🇺🇸' },
                      { code: 'KES', flag: '🇰🇪' },
                      { code: 'GHS', flag: '🇬🇭' },
                      { code: 'UGX', flag: '🇺🇬' },
                      { code: 'TZS', flag: '🇹🇿' },
                      { code: 'XAF', flag: '🇨🇲' },
                      { code: 'XOF', flag: '🇧🇯' },
                    ].map(cur => (
                      <button
                        key={cur.code}
                        onClick={() => setSelectedCurrency(cur.code)}
                        className={`px-3 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                          selectedCurrency === cur.code
                            ? 'bg-[#C7FF00] text-black'
                            : `${tc.card} border ${tc.borderLight} ${tc.text} ${tc.hoverBg}`
                        }`}
                      >
                        <span>{cur.flag}</span>
                        <span>{cur.code}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.recipientIdentifier')}</label>
                  <input
                    type="text"
                    value={recipientIdentifier}
                    onChange={e => setRecipientIdentifier(e.target.value)}
                    placeholder={t('send.recipientIdentifierPlaceholder')}
                    className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  />
                </div>
              </>
            )}

            {/* US Payment (ACH/Wire) Details */}
            {method === 'us_ach_wire' && (
              <USPaymentDetails
                tc={tc}
                t={t}
                usCounterparties={usCounterparties}
                selectedCounterparty={selectedCounterparty}
                setSelectedCounterparty={setSelectedCounterparty}
                loadingCounterparties={loadingCounterparties}
                setLoadingCounterparties={setLoadingCounterparties}
                showCounterpartyList={showCounterpartyList}
                setShowCounterpartyList={setShowCounterpartyList}
                showNewCounterparty={showNewCounterparty}
                setShowNewCounterparty={setShowNewCounterparty}
                paymentRail={paymentRail}
                setPaymentRail={setPaymentRail}
                setUsCounterparties={setUsCounterparties}
                setSelectedCurrency={setSelectedCurrency}
                selectedWallet={selectedWallet}
                cpFirstName={cpFirstName} setCpFirstName={setCpFirstName}
                cpLastName={cpLastName} setCpLastName={setCpLastName}
                cpIsCorporate={cpIsCorporate} setCpIsCorporate={setCpIsCorporate}
                cpBusinessName={cpBusinessName} setCpBusinessName={setCpBusinessName}
                cpAccountNumber={cpAccountNumber} setCpAccountNumber={setCpAccountNumber}
                cpRoutingNumber={cpRoutingNumber} setCpRoutingNumber={setCpRoutingNumber}
                cpInstitutionName={cpInstitutionName} setCpInstitutionName={setCpInstitutionName}
                cpAccountType={cpAccountType} setCpAccountType={setCpAccountType}
                cpStreet={cpStreet} setCpStreet={setCpStreet}
                cpCity={cpCity} setCpCity={setCpCity}
                cpState={cpState} setCpState={setCpState}
                cpPostalCode={cpPostalCode} setCpPostalCode={setCpPostalCode}
                creatingCounterparty={creatingCounterparty}
                setCreatingCounterparty={setCreatingCounterparty}
                wallets={wallets}
                onNavigateToFullForm={onNavigate ? () => onNavigate('create-counterparty') : undefined}
              />
            )}

            {/* Continue Button */}
            <button
              onClick={() => setStep('amount')}
              disabled={!canProceedDetails()}
              className="w-full mt-4 bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t('send.continue')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 3: Enter Amount                                               */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'amount' && (
          <motion.div
            key="amount"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            {/* Recipient summary */}
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-6`}>
              <p className={`text-xs ${tc.textMuted} mb-1`}>{t('send.sendingTo')}</p>
              {method === 'us_ach_wire' ? (
                <>
                  <p className={`text-sm font-semibold ${tc.text}`}>{selectedCounterparty?.account_name || selectedCounterparty?.business_name || `${selectedCounterparty?.first_name} ${selectedCounterparty?.last_name}`}</p>
                  <p className={`text-xs ${tc.textMuted}`}>{selectedCounterparty?.institution_name} • ****{selectedCounterparty?.account_number_last4}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      paymentRail === 'FEDWIRE' ? 'bg-orange-500/15 text-orange-400' :
                      paymentRail === 'ACH-ACCELERATED' ? 'bg-yellow-500/15 text-yellow-400' :
                      'bg-blue-500/15 text-blue-400'
                    }`}>{paymentRail}</span>
                  </div>
                </>
              ) : method === 'borderpay' ? (
                <p className={`text-sm font-semibold ${tc.text}`}>{recipientIdentifier}</p>
              ) : (
                <>
                  <p className={`text-sm font-semibold ${tc.text}`}>{resolvedName || accountNumber}</p>
                  <p className={`text-xs ${tc.textMuted}`}>{selectedBank?.name} • {accountNumber}</p>
                </>
              )}
            </div>

            {/* Amount input */}
            <div className="mb-5">
              <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.amount')}</label>
              <div className="relative">
                <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold ${tc.text}`}>
                  {getCurrencySymbol(selectedCurrency)}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl pl-14 pr-4 py-5 text-2xl font-bold focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  placeholder="0.00"
                />
              </div>
              {selectedWallet && (
                <div className="flex items-center justify-between mt-2 px-1">
                  <p className={`text-xs ${tc.textMuted}`}>
                    {t('send.available')}: {getCurrencySymbol(selectedCurrency)}{selectedWallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                  <button
                    onClick={() => setAmount(selectedWallet.balance.toString())}
                    className="text-xs text-[#C7FF00] font-semibold"
                  >
                    {t('send.sendMax')}
                  </button>
                </div>
              )}
              {!selectedWallet && (
                <p className="text-xs text-red-400 mt-2 px-1">{t('send.noWalletForCurrency')}</p>
              )}
            </div>

            {/* Memo (US Payments only) */}
            {method === 'us_ach_wire' && (
              <div className="mb-4">
                <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.usMemo')}</label>
                <input
                  type="text"
                  value={usMemo}
                  onChange={e => setUsMemo(e.target.value)}
                  placeholder={t('send.usMemoPlaceholder')}
                  className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                />
              </div>
            )}

            {/* Reason */}
            <div className="mb-6">
              <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.reason')}</label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={method === 'us_ach_wire' ? t('send.usReasonPlaceholder') : t('send.reasonPlaceholder')}
                className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
              />
            </div>

            <button
              onClick={() => setStep('review')}
              disabled={!canProceedAmount()}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t('send.reviewTransfer')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 4: Review                                                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'review' && (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5 mb-6`}>
              {/* Amount */}
              <div className="text-center mb-5">
                <p className={`text-xs ${tc.textMuted} mb-1`}>{t('send.youAreSending')}</p>
                <p className="text-3xl font-bold text-[#C7FF00]">
                  {getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className={`text-xs ${tc.textMuted} mt-1`}>{selectedCurrency}</p>
              </div>

              <div className={`h-px ${tc.border} mb-4`} />

              {/* Details */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.method')}</span>
                  <span className={`text-sm font-medium ${tc.text}`}>
                    {method === 'bank' ? t('send.bankTransfer') : method === 'mobile_money' ? t('send.mobileMoney') : method === 'us_ach_wire' ? t('send.usAchWire') : t('send.borderPayPay')}
                  </span>
                </div>

                {method !== 'borderpay' && method !== 'us_ach_wire' && (
                  <>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{method === 'bank' ? t('send.bankName') : t('send.provider')}</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{selectedBank?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{t('send.accountNumber')}</span>
                      <span className={`text-sm font-mono ${tc.text}`}>{accountNumber}</span>
                    </div>
                    {resolvedName && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>{t('send.accountName')}</span>
                        <span className={`text-sm font-medium ${tc.text}`}>{resolvedName}</span>
                      </div>
                    )}
                  </>
                )}

                {method === 'us_ach_wire' && (
                  <>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{t('send.usCounterparty')}</span>
                      <span className={`text-sm font-medium ${tc.text} text-right max-w-[180px]`}>{selectedCounterparty?.account_name || `${selectedCounterparty?.first_name} ${selectedCounterparty?.last_name}`}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{t('send.usInstitution')}</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{selectedCounterparty?.institution_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{t('send.usAccountLast4')}</span>
                      <span className={`text-sm font-mono ${tc.text}`}>****{selectedCounterparty?.account_number_last4}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{t('send.usPaymentRail')}</span>
                      <span className={`text-sm font-semibold ${
                        paymentRail === 'FEDWIRE' ? 'text-orange-400' :
                        paymentRail === 'ACH-ACCELERATED' ? 'text-yellow-400' :
                        'text-blue-400'
                      }`}>{paymentRail}</span>
                    </div>
                    {usMemo && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>{t('send.usMemo')}</span>
                        <span className={`text-sm ${tc.text}`}>{usMemo}</span>
                      </div>
                    )}
                  </>
                )}

                {method === 'borderpay' && (
                  <div className="flex justify-between">
                    <span className={`text-xs ${tc.textMuted}`}>{t('send.recipient')}</span>
                    <span className={`text-sm font-medium ${tc.text}`}>{recipientIdentifier}</span>
                  </div>
                )}

                {reason && (
                  <div className="flex justify-between">
                    <span className={`text-xs ${tc.textMuted}`}>{t('send.reason')}</span>
                    <span className={`text-sm ${tc.text}`}>{reason}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.currency')}</span>
                  <span className={`text-sm font-medium ${tc.text}`}>{selectedCurrency}</span>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl mb-6">
              <AlertCircle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-yellow-400">{t('send.reviewWarning')}</p>
            </div>

            <button
              onClick={() => setStep('pin')}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
            >
              {t('send.confirmAndPay')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 5: PIN Verification                                           */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {step === 'pin' && (
          <motion.div
            key="pin"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-5 py-8"
          >
            <div className="text-center mb-8">
              <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-10 h-10 text-[#C7FF00]" />
              </div>
              <h2 className={`text-lg font-bold mb-2 ${tc.text}`}>{t('send.enterPinToConfirm')}</h2>
              <p className={`text-sm ${tc.textSecondary}`}>
                {getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} → {method === 'us_ach_wire' ? (selectedCounterparty?.account_name || `${selectedCounterparty?.first_name} ${selectedCounterparty?.last_name}`) : method === 'borderpay' ? recipientIdentifier : resolvedName || accountNumber}
              </p>
            </div>

            <div className="flex justify-center mb-8">
              <InputOTP
                maxLength={6}
                value={pin}
                onChange={handlePinComplete}
                inputMode="numeric"
                pattern="[0-9]*"
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Biometric option */}
            {BiometricManager.isEnrolled(userId) && (
              <div className="px-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-gray-500 uppercase tracking-widest">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                <button
                  onClick={async () => {
                    const result = await BiometricManager.verify(userId);
                    if (result.success) {
                      processTransaction('__biometric__');
                    } else {
                      toast.error(result.error || 'Biometric verification failed');
                    }
                  }}
                  className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white hover:bg-white/[0.07] transition-all active:scale-[0.98]"
                >
                  <Shield size={20} className="text-[#C7FF00]" />
                  <span className="text-sm font-semibold">Use Biometric</span>
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 6: Processing                                                 */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-5 py-16 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-[#C7FF00]/10 flex items-center justify-center mx-auto mb-6">
              <Loader2 size={32} className="text-[#C7FF00] animate-spin" />
            </div>
            <p className={`text-base font-semibold ${tc.text} mb-2`}>{t('send.processingTx')}</p>
            <p className={`text-sm ${tc.textMuted}`}>{t('send.pleaseWait')}</p>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 7: Success                                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-5 py-10 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut', delay: 0.2 }}
              className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle className="w-12 h-12 text-green-500" />
            </motion.div>

            <h2 className={`text-xl font-bold mb-2 ${tc.text}`}>{t('send.txSuccessful')}</h2>
            <p className="text-2xl font-bold text-[#C7FF00] mb-1">
              {getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <p className={`text-sm ${tc.textMuted} mb-6`}>
              → {method === 'us_ach_wire' ? (selectedCounterparty?.account_name || `${selectedCounterparty?.first_name} ${selectedCounterparty?.last_name}`) : method === 'borderpay' ? recipientIdentifier : resolvedName || accountNumber}
            </p>

            {/* Transaction details */}
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-6 text-left`}>
              {transactionRef && (
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.reference')}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-mono ${tc.text}`}>{transactionRef}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(transactionRef);
                        toast.success(t('common.copied'));
                      }}
                    >
                      <Copy size={12} className={tc.textMuted} />
                    </button>
                  </div>
                </div>
              )}
              {transactionId && (
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.transactionId')}</span>
                  <span className={`text-xs font-mono ${tc.text} truncate ml-4 max-w-[180px]`}>{transactionId}</span>
                </div>
              )}
              {newBalance !== null && (
                <div className="flex justify-between items-center">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.newBalance')}</span>
                  <span className={`text-sm font-semibold ${tc.text}`}>
                    {getCurrencySymbol(selectedCurrency)}{newBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={onComplete}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
            >
              {t('common.done')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 8: Error                                                      */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-5 py-10 text-center"
          >
            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-12 h-12 text-red-500" />
            </div>
            <h2 className={`text-xl font-bold mb-2 ${tc.text}`}>{t('send.txFailed')}</h2>
            <p className={`text-sm ${tc.textMuted} mb-8 max-w-xs mx-auto`}>{errorMessage}</p>

            <div className="space-y-3">
              <button
                onClick={() => { setPin(''); setStep('pin'); }}
                className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
              >
                {t('send.tryAgain')}
              </button>
              <button
                onClick={onBack}
                className={`w-full ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} ${tc.hoverBg} transition-all active:scale-[0.98]`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}