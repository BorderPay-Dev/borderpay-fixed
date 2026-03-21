/**
 * BorderPay Africa - Currency Exchange/Swap Screen
 * Mobile-optimized with neon green aesthetic
 * 
 * Features:
 * - Live exchange rates via backend
 * - Source/destination wallet selection
 * - Quick swap button to flip currencies
 * - Real-time conversion preview
 * - Fee display
 * - PIN verification
 * - Atomic transactions with double-entry ledger
 * - Balance validation
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  RefreshCw,
  ArrowDownUp,
  DollarSign,
  TrendingUp,
  Lock,
  Check,
  X,
  AlertCircle,
  Info,
  ChevronDown,
  Wallet as WalletIcon,
} from 'lucide-react';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface Wallet {
  id: string;
  currency: string;
  balance: number;
  symbol: string;
}

type Step = 'select-wallets' | 'enter-amount' | 'review' | 'pin' | 'processing' | 'success' | 'error';

interface ExchangeScreenProps {
  onBack: () => void;
  preSelectedWalletId?: string;
}

export function ExchangeScreen({ onBack, preSelectedWalletId }: ExchangeScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [currentStep, setCurrentStep] = useState<Step>('select-wallets');
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  // Exchange data
  const [sourceWallet, setSourceWallet] = useState<Wallet | null>(null);
  const [destinationWallet, setDestinationWallet] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [fee, setFee] = useState(0);
  const [convertedAmount, setConvertedAmount] = useState(0);
  const [loadingRate, setLoadingRate] = useState(false);
  const [quoteReference, setQuoteReference] = useState<string | null>(null);

  // PIN entry
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [pinError, setPinError] = useState('');

  // Transaction result
  const [transactionId, setTransactionId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Wallet selection dropdown
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);

  useEffect(() => {
    loadWallets();
  }, []);

  useEffect(() => {
    if (sourceWallet && destinationWallet && parseFloat(amount) > 0) {
      fetchExchangeRate();
    }
  }, [sourceWallet, destinationWallet, amount]);

  const loadWallets = async () => {
    try {
      // ✅ Use authAPI to get stored user
      const user = authAPI.getStoredUser();
      if (!user) {
        console.error('❌ Exchange: User not authenticated');
        return;
      }

      // ✅ Use backendAPI instead of direct Supabase
      const result = await backendAPI.wallets.getWallets();
      
      if (result.success) {
        console.log('✅ Exchange: Loaded wallets', result.data);
        
        const rawWallets = result.data?.wallets || result.data || [];
        const formattedWallets: Wallet[] = (Array.isArray(rawWallets) ? rawWallets : []).map((w: any) => ({
          id: w.id,
          currency: w.currency,
          balance: parseFloat(w.balance) || 0,
          symbol: getCurrencySymbol(w.currency),
        }));

        setWallets(formattedWallets);

        // Pre-select wallet if provided
        if (preSelectedWalletId) {
          const preSelected = formattedWallets.find((w) => w.id === preSelectedWalletId);
          if (preSelected) {
            setSourceWallet(preSelected);
          }
        }
      } else {
        console.error('❌ Exchange: Failed to load wallets:', result.error);
        toast.error('Unable to load your wallets. Please check your connection and try again.');
      }
    } catch (error) {
      console.error('❌ Exchange: Error loading wallets:', error);
      toast.error('Unable to load your wallets. Please check your internet connection or try again.');
    } finally {
      setLoading(false);
    }
  };

  const getCurrencySymbol = (currency: string): string => {
    const symbols: Record<string, string> = {
      USD: '$', NGN: '₦', KES: 'KSh', GHS: '₵',
      TZS: 'TSh', UGX: 'USh', USDT: '$', USDC: '$',
      XOF: 'FCFA', XAF: 'FCFA',
      PYUSD: '$',
    };
    return symbols[currency] || currency;
  };

  const fetchExchangeRate = async () => {
    if (!sourceWallet || !destinationWallet) return;

    // Don't fetch if same currency
    if (sourceWallet.currency === destinationWallet.currency) {
      toast.error('Cannot exchange same currency');
      return;
    }

    setLoadingRate(true);

    try {
      // Use backendAPI.fx.getQuote for FX quote
      const result = await backendAPI.fx.getQuote(
        sourceWallet.currency,
        destinationWallet.currency,
        parseFloat(amount)
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch exchange rate');
      }

      const data = result.data;
      setExchangeRate(data.rate);
      setConvertedAmount(data.converted_amount);
      setFee(data.fee || 0);
      setQuoteReference(data.quote_reference || null);
      console.log('FX quote received:', { rate: data.rate, quote_reference: data.quote_reference });
    } catch (error: any) {
      console.error('Error fetching exchange rate:', error);
      toast.error(error.message || 'Failed to fetch exchange rate');
    } finally {
      setLoadingRate(false);
    }
  };

  const handleSwapCurrencies = () => {
    const temp = sourceWallet;
    setSourceWallet(destinationWallet);
    setDestinationWallet(temp);
    setAmount('');
    setExchangeRate(null);
    setConvertedAmount(0);
  };

  const handleContinueToAmount = () => {
    if (!sourceWallet) {
      toast.error('Please select source wallet');
      return;
    }
    if (!destinationWallet) {
      toast.error('Please select destination wallet');
      return;
    }
    if (sourceWallet.id === destinationWallet.id) {
      toast.error('Please select different wallets');
      return;
    }
    setCurrentStep('enter-amount');
  };

  const handleContinueToReview = () => {
    const amountNum = parseFloat(amount);

    if (!amountNum || amountNum <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (amountNum > sourceWallet!.balance) {
      toast.error('Insufficient balance');
      return;
    }

    if (!exchangeRate || !convertedAmount) {
      toast.error('Waiting for exchange rate...');
      return;
    }

    setCurrentStep('review');
  };

  const handleContinueToPIN = () => {
    setCurrentStep('pin');
  };

  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) return;
    if (value && !/^\d$/.test(value)) return;

    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    setPinError('');

    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`pin-${index + 1}`);
      nextInput?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (index === 5 && value) {
      setTimeout(() => handleSubmitExchange(newPin.join('')), 100);
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      const prevInput = document.getElementById(`pin-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleSubmitExchange = async (pinValue: string) => {
    if (pinValue.length !== 6) {
      setPinError('Please enter 6-digit PIN');
      return;
    }

    if (!quoteReference) {
      setPinError('Quote expired. Please go back and refresh the rate.');
      return;
    }

    setCurrentStep('processing');

    try {
      // Use backendAPI.fx.convert with quote_reference
      const result = await backendAPI.fx.convert({
        quote_reference: quoteReference,
        source_wallet_id: sourceWallet!.id,
        destination_wallet_id: destinationWallet!.id,
        amount: parseFloat(amount),
        transaction_pin: pinValue,
      });

      if (!result.success) {
        throw new Error(result.error || 'Exchange failed');
      }

      setTransactionId(result.data?.transaction_id || '');
      setCurrentStep('success');

      // Show success toast
      toast.success('Exchange successful!');
    } catch (error: any) {
      console.error('Exchange error:', error);
      setErrorMessage(error.message || 'Exchange failed. Please try again.');
      setCurrentStep('error');
    }
  };

  const handleTryAgain = () => {
    setPin(['', '', '', '', '', '']);
    setPinError('');
    setErrorMessage('');
    setCurrentStep('pin');
  };

  const handleNewExchange = () => {
    setSourceWallet(null);
    setDestinationWallet(null);
    setAmount('');
    setExchangeRate(null);
    setConvertedAmount(0);
    setFee(0);
    setQuoteReference(null);
    setPin(['', '', '', '', '', '']);
    setPinError('');
    setErrorMessage('');
    setTransactionId('');
    setCurrentStep('select-wallets');
  };

  if (loading) {
    return (
      <div className={`min-h-screen ${tc.bg} flex items-center justify-center`}>
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#C7FF00] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className={`${tc.textMuted} text-sm`}>{t('receive.loadingWallets')}</p>
        </div>
      </div>
    );
  }

  // Step 1: Select Wallets
  if (currentStep === 'select-wallets') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        {/* Header */}
        <div className={`sticky top-0 z-20 ${tc.bg} border-b ${tc.border}`}>
          <div className="flex items-center justify-between p-4">
            <button
              onClick={onBack}
              className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold">{t('exchange.title')}</h1>
            <div className="w-9" />
          </div>
        </div>

        <div className="p-4 space-y-6">
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-[#C7FF00] rounded-full" />
            <div className={`flex-1 h-1 ${tc.isLight ? 'bg-gray-200' : 'bg-white/10'} rounded-full`} />
            <div className={`flex-1 h-1 ${tc.isLight ? 'bg-gray-200' : 'bg-white/10'} rounded-full`} />
          </div>

          <div className="text-center mb-6">
            <RefreshCw className="w-12 h-12 text-[#C7FF00] mx-auto mb-3" />
            <p className={`text-sm ${tc.textMuted}`}>{t('exchange.step')} 1 {t('exchange.of')} 3</p>
            <h2 className="text-xl font-bold mt-1">{t('exchange.selectWallets')}</h2>
          </div>

          {/* Source Wallet */}
          <div>
            <label className={`block text-xs font-semibold ${tc.textMuted} mb-2`}>{t('exchange.from')}</label>
            <div className="relative">
              <button
                onClick={() => setShowSourceDropdown(!showSourceDropdown)}
                className={`w-full ${tc.card} border ${
                  sourceWallet ? 'border-[#C7FF00]' : tc.cardBorder
                } rounded-2xl p-4 flex items-center justify-between ${tc.hoverBg} transition-colors`}
              >
                {sourceWallet ? (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#C7FF00]/10 rounded-full flex items-center justify-center">
                      <WalletIcon className="w-5 h-5 text-[#C7FF00]" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold">{sourceWallet.currency}</p>
                      <p className={`text-xs ${tc.textMuted}`}>
                        {t('exchange.availableBalance')}: {sourceWallet.symbol}
                        {sourceWallet.balance.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <span className={tc.textMuted}>{t('exchange.selectWallet')}</span>
                )}
                <ChevronDown className={`w-5 h-5 ${tc.textMuted}`} />
              </button>

              {/* Dropdown */}
              <AnimatePresence>
                {showSourceDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`absolute top-full mt-2 w-full ${tc.bgAlt} border ${tc.border} rounded-2xl shadow-xl overflow-hidden z-10 max-h-60 overflow-y-auto`}
                  >
                    {wallets.map((wallet) => (
                      <button
                        key={wallet.id}
                        onClick={() => {
                          setSourceWallet(wallet);
                          setShowSourceDropdown(false);
                        }}
                        className={`w-full p-4 flex items-center gap-3 ${tc.hoverBg} transition-colors ${
                          sourceWallet?.id === wallet.id ? 'bg-[#C7FF00]/10' : ''
                        }`}
                      >
                        <div className={`w-10 h-10 ${tc.card} rounded-full flex items-center justify-center`}>
                          <WalletIcon className={`w-5 h-5 ${tc.textMuted}`} />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="font-semibold text-sm">{wallet.currency}</p>
                          <p className={`text-xs ${tc.textMuted}`}>
                            {wallet.symbol}
                            {wallet.balance.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Swap Button */}
          {sourceWallet && destinationWallet && (
            <div className="flex justify-center -my-3">
              <button
                onClick={handleSwapCurrencies}
                className="w-12 h-12 bg-[#C7FF00] rounded-full flex items-center justify-center hover:bg-[#B8F000] transition-colors shadow-lg"
              >
                <ArrowDownUp className="w-5 h-5 text-black" />
              </button>
            </div>
          )}

          {/* Destination Wallet */}
          <div>
            <label className={`block text-xs font-semibold ${tc.textMuted} mb-2`}>{t('exchange.to')}</label>
            <div className="relative">
              <button
                onClick={() => setShowDestDropdown(!showDestDropdown)}
                className={`w-full ${tc.card} border ${
                  destinationWallet ? 'border-[#C7FF00]' : tc.cardBorder
                } rounded-2xl p-4 flex items-center justify-between ${tc.hoverBg} transition-colors`}
              >
                {destinationWallet ? (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#C7FF00]/10 rounded-full flex items-center justify-center">
                      <WalletIcon className="w-5 h-5 text-[#C7FF00]" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold">{destinationWallet.currency}</p>
                      <p className={`text-xs ${tc.textMuted}`}>
                        {t('exchange.availableBalance')}: {destinationWallet.symbol}
                        {destinationWallet.balance.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <span className={tc.textMuted}>{t('exchange.selectWallet')}</span>
                )}
                <ChevronDown className={`w-5 h-5 ${tc.textMuted}`} />
              </button>

              {/* Dropdown */}
              <AnimatePresence>
                {showDestDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`absolute top-full mt-2 w-full ${tc.bgAlt} border ${tc.border} rounded-2xl shadow-xl overflow-hidden z-10 max-h-60 overflow-y-auto`}
                  >
                    {wallets
                      .filter((w) => w.id !== sourceWallet?.id)
                      .map((wallet) => (
                        <button
                          key={wallet.id}
                          onClick={() => {
                            setDestinationWallet(wallet);
                            setShowDestDropdown(false);
                          }}
                          className={`w-full p-4 flex items-center gap-3 ${tc.hoverBg} transition-colors ${
                            destinationWallet?.id === wallet.id ? 'bg-[#C7FF00]/10' : ''
                          }`}
                        >
                          <div className={`w-10 h-10 ${tc.card} rounded-full flex items-center justify-center`}>
                            <WalletIcon className={`w-5 h-5 ${tc.textMuted}`} />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="font-semibold text-sm">{wallet.currency}</p>
                            <p className={`text-xs ${tc.textMuted}`}>
                              {wallet.symbol}
                              {wallet.balance.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </p>
                          </div>
                        </button>
                      ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-blue-400 font-semibold mb-1">{t('exchange.instantExchange')}</p>
                <p className={`text-xs ${tc.textMuted}`}>
                  {t('exchange.instantDesc')}
                </p>
              </div>
            </div>
          </div>

          {/* Continue Button */}
          <button
            onClick={handleContinueToAmount}
            disabled={!sourceWallet || !destinationWallet}
            className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#B8F000] transition-colors"
          >
            {t('exchange.continue')}
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Enter Amount
  if (currentStep === 'enter-amount') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        {/* Header */}
        <div className={`sticky top-0 z-20 ${tc.bg} border-b ${tc.border}`}>
          <div className="flex items-center justify-between p-4">
            <button
              onClick={() => setCurrentStep('select-wallets')}
              className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold">{t('exchange.enterAmount')}</h1>
            <div className="w-9" />
          </div>
        </div>

        <div className="p-4 space-y-6">
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-[#C7FF00] rounded-full" />
            <div className="flex-1 h-1 bg-[#C7FF00] rounded-full" />
            <div className="flex-1 h-1 bg-white/10 rounded-full" />
          </div>

          <div className="text-center mb-6">
            <DollarSign className="w-12 h-12 text-[#C7FF00] mx-auto mb-3" />
            <p className={`text-sm ${tc.textMuted}`}>{t('exchange.step')} 2 {t('exchange.of')} 3</p>
            <h2 className="text-xl font-bold mt-1">{t('exchange.howMuch')}</h2>
          </div>

          {/* Exchange Summary Card */}
          <div className={`${tc.isLight ? 'bg-white/60 backdrop-blur-xl border-white/50' : 'bg-white/[0.04] backdrop-blur-xl border-white/[0.06]'} rounded-3xl p-6 border`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#C7FF00]/10 rounded-full flex items-center justify-center">
                  <WalletIcon className="w-5 h-5 text-[#C7FF00]" />
                </div>
                <div>
                  <p className={`text-xs ${tc.textMuted}`}>{t('exchange.from')}</p>
                  <p className="font-bold">{sourceWallet?.currency}</p>
                </div>
              </div>

              <ArrowDownUp className={`w-5 h-5 ${tc.textMuted}`} />

              <div className="flex items-center gap-3">
                <div>
                  <p className={`text-xs ${tc.textMuted} text-right`}>{t('exchange.to')}</p>
                  <p className="font-bold text-right">{destinationWallet?.currency}</p>
                </div>
                <div className="w-10 h-10 bg-blue-500/10 rounded-full flex items-center justify-center">
                  <WalletIcon className="w-5 h-5 text-blue-500" />
                </div>
              </div>
            </div>

            {/* Available Balance */}
            <div className={`${tc.card} rounded-2xl p-3`}>
              <p className={`text-xs ${tc.textMuted}`}>{t('exchange.availableBalance')}</p>
              <p className={`text-lg font-bold ${tc.text}`}>
                {sourceWallet?.symbol}
                {sourceWallet?.balance.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className={`block text-xs font-semibold ${tc.textMuted} mb-2`}>
              {t('exchange.amountToExchange')}
            </label>
            <div className="relative">
              <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold ${tc.textMuted}`}>
                {sourceWallet?.symbol}
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-12 pr-4 text-2xl font-bold text-white placeholder:text-white/20 focus:outline-none focus:border-[#C7FF00] transition-colors"
              />
            </div>

            {/* Quick Amount Buttons */}
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[25, 50, 75, 100].map((percent) => (
                <button
                  key={percent}
                  onClick={() => {
                    const amountToSet = (sourceWallet!.balance * percent) / 100;
                    setAmount(amountToSet.toFixed(2));
                  }}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl py-2 text-xs font-semibold transition-colors"
                >
                  {percent}%
                </button>
              ))}
            </div>
          </div>

          {/* Conversion Preview */}
          {loadingRate && amount && parseFloat(amount) > 0 && (
            <div className="bg-white/5 rounded-2xl p-4">
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-[#C7FF00] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-white/60">Getting exchange rate...</p>
              </div>
            </div>
          )}

          {!loadingRate && exchangeRate && convertedAmount > 0 && (
            <div
              className="bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">Exchange Rate</span>
                <span className="text-sm font-bold">
                  1 {sourceWallet?.currency} = {exchangeRate.toFixed(4)} {destinationWallet?.currency}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">You'll receive</span>
                <span className="text-lg font-bold text-[#C7FF00]">
                  {destinationWallet?.symbol}
                  {convertedAmount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              {fee > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  <span className="text-xs text-white/60">Exchange Fee</span>
                  <span className="text-xs font-semibold">
                    {sourceWallet?.symbol}
                    {fee.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Continue Button */}
          <button
            onClick={handleContinueToReview}
            disabled={
              !amount ||
              parseFloat(amount) <= 0 ||
              parseFloat(amount) > sourceWallet!.balance ||
              loadingRate ||
              !exchangeRate
            }
            className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#B8F000] transition-colors"
          >
            {loadingRate ? t('exchange.gettingRateBtn') : t('exchange.reviewBtn')}
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Review
  if (currentStep === 'review') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        {/* Header */}
        <div className={`sticky top-0 z-20 ${tc.bg} border-b ${tc.border}`}>
          <div className="flex items-center justify-between p-4">
            <button
              onClick={() => setCurrentStep('enter-amount')}
              className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold">{t('exchange.reviewExchange')}</h1>
            <div className="w-9" />
          </div>
        </div>

        <div className="p-4 space-y-6">
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-[#C7FF00] rounded-full" />
            <div className="flex-1 h-1 bg-[#C7FF00] rounded-full" />
            <div className="flex-1 h-1 bg-[#C7FF00] rounded-full" />
          </div>

          <div className="text-center mb-6">
            <TrendingUp className="w-12 h-12 text-[#C7FF00] mx-auto mb-3" />
            <p className={`text-sm ${tc.textMuted}`}>{t('exchange.step')} 3 {t('exchange.of')} 3</p>
            <h2 className="text-xl font-bold mt-1">{t('exchange.confirmDetails')}</h2>
          </div>

          {/* Exchange Summary */}
          <div className={`${tc.isLight ? 'bg-white/60 backdrop-blur-xl border-white/50' : 'bg-white/[0.04] backdrop-blur-xl border-white/[0.06]'} rounded-3xl p-6 border space-y-4`}>
            <div className="text-center py-4">
              <p className={`text-xs ${tc.textMuted} mb-2`}>{t('exchange.youSend')}</p>
              <p className={`text-3xl font-bold ${tc.text} mb-4`}>
                {sourceWallet?.symbol}
                {parseFloat(amount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>

              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 bg-[#C7FF00] rounded-full flex items-center justify-center">
                  <ArrowDownUp className="w-6 h-6 text-black" />
                </div>
              </div>

              <p className={`text-xs ${tc.textMuted} mb-2`}>{t('exchange.youReceive')}</p>
              <p className="text-3xl font-bold text-[#C7FF00]">
                {destinationWallet?.symbol}
                {convertedAmount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>

            <div className={`${tc.card} rounded-2xl p-4 space-y-3`}>
              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textMuted}`}>{t('exchange.from')}</span>
                <span className="text-sm font-bold">{sourceWallet?.currency} {t('receive.wallet')}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textMuted}`}>{t('exchange.to')}</span>
                <span className="text-sm font-bold">{destinationWallet?.currency} {t('receive.wallet')}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textMuted}`}>{t('exchange.exchangeRate')}</span>
                <span className="text-sm font-semibold">
                  1 {sourceWallet?.currency} = {exchangeRate?.toFixed(4)} {destinationWallet?.currency}
                </span>
              </div>

              {fee > 0 && (
                <div className={`flex justify-between items-center pt-2 border-t ${tc.border}`}>
                  <span className={`text-xs ${tc.textMuted}`}>{t('exchange.fee')}</span>
                  <span className="text-sm font-semibold">
                    {sourceWallet?.symbol}
                    {fee.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Security Notice */}
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4">
            <div className="flex gap-3">
              <Lock className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-orange-400 font-semibold mb-1">{t('exchange.pinRequired')}</p>
                <p className={`text-xs ${tc.textMuted}`}>
                  {t('exchange.pinRequiredDesc')}
                </p>
              </div>
            </div>
          </div>

          {/* Continue Button */}
          <button
            onClick={handleContinueToPIN}
            className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-2xl hover:bg-[#B8F000] transition-colors"
          >
            {t('exchange.continueToPIN')}
          </button>
        </div>
      </div>
    );
  }

  // Step 4: PIN Entry
  if (currentStep === 'pin') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} flex flex-col`}>
        {/* Header */}
        <div className={`sticky top-0 z-20 ${tc.bg} border-b ${tc.border}`}>
          <div className="flex items-center justify-between p-4">
            <button
              onClick={() => setCurrentStep('review')}
              className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold">{t('exchange.enterPIN')}</h1>
            <div className="w-9" />
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <Lock className="w-16 h-16 text-[#C7FF00] mb-6" />
          <h2 className="text-2xl font-bold mb-2">{t('exchange.enterYourPIN')}</h2>
          <p className={`text-sm ${tc.textMuted} mb-8 text-center`}>
            {t('exchange.pinDesc')}
          </p>

          {/* PIN Input */}
          <div className="flex gap-3 mb-6">
            {pin.map((digit, index) => (
              <input
                key={index}
                id={`pin-${index}`}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinChange(index, e.target.value)}
                onKeyDown={(e) => handlePinKeyDown(index, e)}
                className="w-12 h-14 bg-white/5 border border-white/10 rounded-xl text-center text-2xl font-bold focus:outline-none focus:border-[#C7FF00] transition-colors"
              />
            ))}
          </div>

          {pinError && (
            <div className="flex items-center gap-2 text-red-500 text-sm mb-4">
              <AlertCircle className="w-4 h-4" />
              <span>{pinError}</span>
            </div>
          )}

          <p className={`text-xs ${tc.isLight ? 'text-gray-400' : 'text-white/40'} text-center max-w-xs`}>
            {t('exchange.pinEncrypted')}
          </p>
        </div>
      </div>
    );
  }

  // Step 5: Processing
  if (currentStep === 'processing') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} flex items-center justify-center p-6`}>
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#C7FF00] border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <h2 className="text-2xl font-bold mb-2">{t('exchange.processing')}</h2>
          <p className={`text-sm ${tc.textMuted}`}>{t('exchange.processingDesc')}</p>
        </div>
      </div>
    );
  }

  // Step 6: Success
  if (currentStep === 'success') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} flex flex-col items-center justify-center p-6`}>
        <div
          className="w-20 h-20 bg-[#C7FF00] rounded-full flex items-center justify-center mb-6"
        >
          <Check className="w-10 h-10 text-black" />
        </div>

        <div
          className="text-center mb-8"
        >
          <h2 className="text-2xl font-bold mb-2">{t('exchange.success')}</h2>
          <p className={`text-sm ${tc.textMuted} mb-4`}>
            {t('exchange.successDesc')}
          </p>

          {/* Summary */}
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 text-left max-w-sm mx-auto space-y-2`}>
            <div className="flex justify-between">
              <span className={`text-xs ${tc.textMuted}`}>{t('exchange.exchanged')}</span>
              <span className="text-sm font-bold">
                {sourceWallet?.symbol}
                {parseFloat(amount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className={`text-xs ${tc.textMuted}`}>{t('exchange.received')}</span>
              <span className="text-sm font-bold text-[#C7FF00]">
                {destinationWallet?.symbol}
                {convertedAmount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            {transactionId && (
              <div className={`flex justify-between pt-2 border-t ${tc.border}`}>
                <span className={`text-xs ${tc.textMuted}`}>{t('exchange.transactionId')}</span>
                <span className="text-xs font-mono">{transactionId.slice(0, 8)}...</span>
              </div>
            )}
          </div>
        </div>

        <div className="w-full max-w-sm space-y-3">
          <button
            onClick={handleNewExchange}
            className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-2xl hover:bg-[#B8F000] transition-colors"
          >
            {t('exchange.makeAnother')}
          </button>

          <button
            onClick={onBack}
            className={`w-full ${tc.card} ${tc.text} font-bold py-4 rounded-2xl ${tc.hoverBg} transition-colors`}
          >
            {t('exchange.backToDashboard')}
          </button>
        </div>
      </div>
    );
  }

  // Step 7: Error
  if (currentStep === 'error') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} flex flex-col items-center justify-center p-6`}>
        <div
          className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center mb-6"
        >
          <X className="w-10 h-10 text-white" />
        </div>

        <div
          className="text-center mb-8"
        >
          <h2 className="text-2xl font-bold mb-2">{t('exchange.failed')}</h2>
          <p className={`text-sm ${tc.textMuted} mb-4`}>{errorMessage}</p>
        </div>

        <div className="w-full max-w-sm space-y-3">
          <button
            onClick={handleTryAgain}
            className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-2xl hover:bg-[#B8F000] transition-colors"
          >
            {t('exchange.tryAgain')}
          </button>

          <button
            onClick={onBack}
            className={`w-full ${tc.card} ${tc.text} font-bold py-4 rounded-2xl ${tc.hoverBg} transition-colors`}
          >
            {t('exchange.backToDashboard')}
          </button>
        </div>
      </div>
    );
  }

  return null;
}